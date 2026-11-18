// Split a text layer into letters in place, rotate them, and restore the original.
// The original stays hidden and locked inside the letter group, so Restore is exact.
import { angleFor, invert, multiply, needsLayer, newSeeds, rotateAround, translate, type Matrix } from './rotate'

export const DATA_KEY = 'crack-font-v2'
export const MAX_LETTERS = 200
const STRUT = '​' // zero-width space: gives a letter the line box of the whole line

/** Letter centre in the original text's own coordinate frame. */
export type LetterData = { id: string; seed: number; cx: number; cy: number }
export type CrackData = { version: 2; originalId: string; left: number; right: number; letters: LetterData[] }
export type Crack = { group: GroupNode; data: CrackData; original: TextNode }

export class UserError extends Error {}
function fail(message: string): never { throw new UserError(message) }

// ---------- reading ----------

export function readData(group: GroupNode): CrackData | null {
  const raw = group.getPluginData(DATA_KEY)
  if (!raw) return null
  try {
    const d = JSON.parse(raw) as CrackData
    if (d && d.version === 2 && typeof d.originalId === 'string' && Array.isArray(d.letters) &&
        Number.isFinite(d.left) && Number.isFinite(d.right) &&
        d.letters.every(l => l && typeof l.id === 'string' && [l.seed, l.cx, l.cy].every(Number.isFinite))) return d
  } catch (_) { /* not ours */ }
  return null
}

/** A Crack Font group (or one of its letters) → the group with its data and hidden original. */
export function findCrack(node: SceneNode): Crack | null {
  const group = node.type === 'GROUP' ? node : node.parent?.type === 'GROUP' ? node.parent : null
  if (!group) return null
  const data = readData(group)
  if (!data) return null
  const original = group.children.find(c => c.id === data.originalId)
  if (!original || original.type !== 'TEXT') return null
  return { group, data, original }
}

// ---------- validation ----------

function assertEditable(node: SceneNode): void {
  let n: BaseNode | null = node
  while (n && n.type !== 'PAGE' && n.type !== 'DOCUMENT') {
    if ('locked' in n && n.locked) fail('Unlock the selected layer and its parents first.')
    if ('visible' in n && !n.visible) fail('Select a visible layer.')
    n = n.parent
  }
}

export function validateSource(node: TextNode): void {
  assertEditable(node)
  if (node.parent?.type !== 'PAGE') fail('Only top-level text is supported for now. Move the text out of frames and groups first.')
  const text = node.characters
  if (!text.trim()) fail('Select text with at least one visible letter.')
  if (text.length > MAX_LETTERS) fail(`Use at most ${MAX_LETTERS} characters, including spaces.`)
  // Conservative: no UTF-16 slicing of emoji, combining marks or shaping scripts.
  if (!/^[\x20-\x7eÀ-ÿ]+$/.test(text)) {
    fail('Use a single line of Latin letters. Line breaks, emoji, combining accents and other scripts are not supported.')
  }
  if (node.textAutoResize !== 'WIDTH_AND_HEIGHT') fail('Set the text to Auto width first. Wrapped or fixed-size text is not supported.')
  if (node.hasMissingFont) fail('Resolve missing fonts first.')
}

export async function loadFonts(node: TextNode): Promise<void> {
  const fonts = new Map<string, FontName>()
  for (const f of node.getRangeAllFontNames(0, node.characters.length)) fonts.set(JSON.stringify(f), f)
  for (const f of fonts.values()) {
    try { await figma.loadFontAsync(f) }
    catch (_) { fail(`Could not load ${f.family} ${f.style}. Nothing was changed.`) }
  }
}

// ---------- geometry ----------

/** Child transforms of a group are relative to the nearest non-group ancestor, not the group. */
function containerTransform(node: BaseNode): Matrix {
  let p = node.parent
  while (p && (p.type === 'GROUP' || p.type === 'BOOLEAN_OPERATION')) p = p.parent
  return p && 'absoluteTransform' in p ? (p as FrameNode).absoluteTransform as Matrix : [[1, 0, 0], [0, 1, 0]]
}

type LineStyle = { key: string; fontName: FontName; fontSize: number; lineHeight: LineHeight }

/** Distinct line styles, only when they produce different line heights (mixed sizes or fonts). */
function lineStyles(source: TextNode): LineStyle[] {
  const segments = source.getStyledTextSegments(['fontName', 'fontSize', 'lineHeight'])
  if (segments.length < 2) return []
  const styles = new Map<string, LineStyle>()
  for (const s of segments) {
    const key = JSON.stringify([s.fontName, s.fontSize, s.lineHeight])
    styles.set(key, { key, fontName: s.fontName, fontSize: s.fontSize, lineHeight: s.lineHeight })
  }
  return [...styles.values()]
}

function styleKey(node: TextNode, i: number): string {
  return JSON.stringify([node.getRangeFontName(i, i + 1), node.getRangeFontSize(i, i + 1), node.getRangeLineHeight(i, i + 1)])
}

/** One zero-width character per other line style, so the letter keeps the original baseline. */
function addStruts(letter: TextNode, styles: LineStyle[], own: string): void {
  for (const s of styles) {
    if (s.key === own) continue
    letter.insertCharacters(0, STRUT, 'AFTER')
    letter.setRangeFontName(0, 1, s.fontName)
    letter.setRangeFontSize(0, 1, s.fontSize)
    letter.setRangeLineHeight(0, 1, s.lineHeight)
  }
}

// ---------- split ----------

export async function split(source: TextNode, left: number, right: number): Promise<Crack> {
  validateSource(source)
  const before = source.characters
  await loadFonts(source)
  if (source.removed || source.characters !== before) fail('The text changed while fonts were loading. Please try again.')
  validateSource(source)

  const text = source.characters, n = text.length
  const parent = source.parent as BaseNode & ChildrenMixin
  const index = parent.children.indexOf(source)
  const base = source.relativeTransform as Matrix
  const created: SceneNode[] = []
  let group: GroupNode | null = null
  try {
    // Width of every prefix, from one copy that loses a character at a time (keeps kerning).
    const prefix: number[] = new Array(n + 1).fill(0)
    const probe = source.clone()
    created.push(probe)
    prefix[n] = probe.width
    for (let k = n - 1; k >= 1; k--) { probe.deleteCharacters(k, k + 1); prefix[k] = probe.width }
    probe.remove()
    created.pop()

    const styles = lineStyles(source)
    const height = source.height
    const letters: TextNode[] = []
    const data: LetterData[] = []
    for (let i = 0; i < n; i++) {
      const space = text[i].trim() === ''
      if (!needsLayer(text[i], source.getRangeTextDecoration(i, i + 1) !== 'NONE')) continue
      const letter = source.clone()
      created.push(letter)
      // Slice a clone instead of building new text: keeps every range style of the letter.
      if (i + 1 < n) letter.deleteCharacters(i + 1, n)
      if (i > 0) letter.deleteCharacters(0, i)
      // A trailing space has no width of its own; a zero-width character after it gives it one.
      if (space) letter.insertCharacters(1, STRUT, 'BEFORE')
      const width = letter.width
      if (styles.length && Math.abs(letter.height - height) > 0.01) addStruts(letter, styles, styleKey(source, i))
      // The letter ends where its prefix ends, so kerning with the previous letter is kept.
      const x = space ? prefix[i] : prefix[i + 1] - width
      letter.relativeTransform = multiply(base, translate(x, 0))
      letter.name = space ? 'Space' : text[i]
      letters.push(letter)
      data.push({ id: letter.id, seed: 0, cx: x + letter.width / 2, cy: letter.height / 2 })
    }
    if (!letters.length) fail('Select text with at least one visible letter.')

    group = figma.group([...letters, source], parent, index)
    group.name = `Crack Font – ${text.length > 40 ? text.slice(0, 40) + '…' : text}`
    source.visible = false
    source.locked = true
    const seeds = newSeeds(data.length)
    data.forEach((l, i) => { l.seed = seeds[i] })
    const crack: Crack = { group, original: source, data: { version: 2, originalId: source.id, left, right, letters: data } }
    rotate(crack)
    return crack
  } catch (error) {
    // Put the original back exactly where it was and remove everything we made.
    if (!source.removed) {
      if (source.parent !== parent) parent.insertChild(Math.min(index, parent.children.length), source)
      source.locked = false
      source.visible = true
    }
    for (const node of created) if (!node.removed) node.remove()
    if (group && !group.removed) group.remove()
    throw error
  }
}

// ---------- rotate ----------

/** Applies data.left / data.right / seeds to every letter that still exists and saves the data. */
export function rotate({ group, data, original }: Crack): void {
  const toLocal = multiply(invert(containerTransform(group)), original.absoluteTransform as Matrix)
  const byId = new Map(group.children.map(c => [c.id, c]))
  for (const l of data.letters) {
    const node = byId.get(l.id)
    if (!node || node.type !== 'TEXT') continue // deleted letters are simply skipped
    const deg = angleFor(l.seed, data.left, data.right)
    node.relativeTransform = multiply(toLocal, rotateAround(l.cx, l.cy, node.width, node.height, deg))
  }
  group.setPluginData(DATA_KEY, JSON.stringify(data))
}

export function shuffle(crack: Crack): void {
  const seeds = newSeeds(crack.data.letters.length)
  crack.data.letters.forEach((l, i) => { l.seed = seeds[i] })
  rotate(crack)
}

// ---------- restore ----------

/** Puts the original text back where the group is and removes the letters. */
export function restore({ group, original }: Crack): TextNode {
  assertEditable(group)
  const parent = group.parent as BaseNode & ChildrenMixin
  original.locked = false
  original.visible = true
  parent.insertChild(parent.children.indexOf(group), original)
  group.remove()
  return original
}
