// Split a text layer into letters in place, rotate them, and restore the original.
// The original is kept, so Restore is exact:
// - 'inside': hidden and locked inside the letter group (page, frames, groups).
// - 'placeholder': in auto layout the original stays in the flow at opacity 0 and keeps its space;
//   the letter group sits on top of it, absolutely positioned. Nothing else in the layout moves.
// - 'legacy': a group made by Crack Font 1 (letters 24 px below an untouched original). It can be
//   rotated and shuffled; Restore just removes the letters.
import { angleFor, invert, multiply, needsLayer, newSeeds, rotateAround, type Matrix } from './rotate'

export const DATA_KEY = 'crack-font-v2'
const V1_KEY = 'crack-font-v1'
export const MAX_LETTERS = 200
const STRUT = '​' // zero-width space: gives a letter the line box of the whole line

/** Letter centre in the original text's own coordinate frame. */
export type LetterData = { id: string; seed: number; cx: number; cy: number }
export type CrackData = {
  version: 2; originalId: string; left: number; right: number; letters: LetterData[]
  mode?: 'inside' | 'placeholder' | 'legacy'; opacity?: number; sourceId?: string
}
/** `original` is null only for legacy groups, which have no original of their own. */
export type Crack = { group: GroupNode; data: CrackData; original: TextNode | null }

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

/** Figma rotation of a node in degrees (positive = counter-clockwise). */
function rotationOf(node: SceneNode): number {
  const m = node.relativeTransform
  return Math.atan2(m[0][1], m[0][0]) * 180 / Math.PI
}

/** A Crack Font 1 group → v2 data in 'legacy' mode. Current angles become the seeds. */
function fromV1(group: GroupNode): CrackData | null {
  let v1: { version?: number; sourceId?: string; glyphs?: { id: string; dx: number; dy: number }[] }
  try { v1 = JSON.parse(group.getPluginData(V1_KEY)) } catch (_) { return null }
  if (!v1 || v1.version !== 1 || !Array.isArray(v1.glyphs) || !v1.glyphs.length ||
      !v1.glyphs.every(g => g && typeof g.id === 'string' && Number.isFinite(g.dx) && Number.isFinite(g.dy))) return null
  const byId = new Map(group.children.map(c => [c.id, c]))
  const angles = v1.glyphs.map(g => { const n = byId.get(g.id); return n ? rotationOf(n) : 0 })
  const max = Math.max(...angles.map(Math.abs))
  const limit = max < 0.25 ? 3 : Math.min(45, Math.max(0.5, Math.round(max * 2) / 2))
  const seeds = max < 0.25 ? newSeeds(angles.length) : angles.map(a => Math.max(-1, Math.min(1, a / limit)))
  return {
    version: 2, originalId: '', left: limit, right: limit, mode: 'legacy', sourceId: v1.sourceId,
    letters: v1.glyphs.map((g, i) => ({ id: g.id, seed: seeds[i], cx: g.dx, cy: g.dy })),
  }
}

export type Inspection = { crack: Crack } | { error: string } | null

/**
 * A Crack Font group (or one of its letters) → the group with its data and original.
 * The original is looked up next to/inside the group first, then anywhere in the document, so a
 * group dragged out of its auto layout frame still finds its placeholder.
 * Duplicated groups (new layer IDs) are matched by layer order. A group whose original was
 * deleted is reported as an error instead of being treated as plain layers.
 */
export async function inspect(node: SceneNode): Promise<Inspection> {
  const group = node.type === 'GROUP' ? node : node.parent?.type === 'GROUP' ? node.parent : null
  if (!group) return null
  let data = readData(group)
  if (!data) {
    const legacy = fromV1(group)
    return legacy ? { crack: { group, data: legacy, original: null } } : null
  }
  if (data.mode === 'legacy') return { crack: { group, data, original: null } }
  const siblings = data.mode === 'placeholder' ? group.parent?.children ?? [] : group.children
  let original = siblings.find(c => c.id === data!.originalId) ?? null
  // A duplicated group carries its own hidden copy of the original: prefer it over the first group's.
  if (!original && data.mode !== 'placeholder') original = group.children.find(c => c.type === 'TEXT' && !c.visible) ?? null
  if (!original) {
    const found = await figma.getNodeByIdAsync(data.originalId)
    if (found && found.type === 'TEXT' && !found.removed) original = found
  }
  if (!original || original.type !== 'TEXT') return { error: 'This group\'s original text was deleted, so it can\'t be changed or restored.' }
  const ids = new Set(group.children.map(c => c.id))
  if (!data.letters.some(l => ids.has(l.id))) {
    const letters = group.children.filter(c => c !== original)
    if (letters.length === data.letters.length) {
      data = { ...data, originalId: original.id, letters: data.letters.map((l, i) => ({ ...l, id: letters[i].id })) }
    }
  }
  return { crack: { group, data, original } }
}

/** Throws when the group or one of its parents is locked or hidden. */
export function assertCrackEditable(crack: Crack): void {
  assertEditable(crack.group)
}

// ---------- validation ----------

function assertEditable(node: SceneNode): void {
  let n: BaseNode | null = node
  while (n && n.type !== 'PAGE' && n.type !== 'DOCUMENT') {
    if ('locked' in n && n.locked) fail('Unlock the layer and its parents first.')
    if ('visible' in n && !n.visible) fail('Select a visible layer.')
    n = n.parent
  }
}

export function validateSource(node: TextNode): void {
  assertEditable(node)
  for (let n: BaseNode | null = node.parent; n && n.type !== 'PAGE'; n = n.parent) {
    if (n.type === 'INSTANCE') fail('Text in an instance can\'t be split. Detach it or edit the main component.')
  }
  const text = node.characters
  if (!text.trim()) fail('Select text with at least one visible letter.')
  if (text.length > MAX_LETTERS) fail(`Use at most ${MAX_LETTERS} characters, including spaces.`)
  // Conservative: no UTF-16 slicing of emoji, combining marks or shaping scripts.
  if (!/^[\x20-\x7eÀ-ÿ]+$/.test(text)) {
    fail('Use one line of Latin letters. Emoji and other scripts aren\'t supported.')
  }
  if (node.textAutoResize !== 'WIDTH_AND_HEIGHT') fail('Set the text to Auto width first. Wrapped text isn\'t supported.')
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

/** Text that auto layout positions: replacing it would make the rest of the layout move. */
function inFlow(node: TextNode): boolean {
  const parent = node.parent
  return !!parent && 'layoutMode' in parent && parent.layoutMode !== 'NONE' && node.layoutPositioning !== 'ABSOLUTE'
}

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
  const before = { characters: source.characters, opacity: source.opacity }
  await loadFonts(source)
  if (source.removed || source.characters !== before.characters) fail('The text changed while fonts were loading. Please try again.')
  validateSource(source)

  const text = source.characters, n = text.length
  const parent = source.parent as BaseNode & ChildrenMixin
  const index = parent.children.indexOf(source)
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
      // (Clones land on the page; rotate() below puts every letter in place.)
      const x = space ? prefix[i] : prefix[i + 1] - width
      letter.name = space ? 'Space' : text[i]
      letters.push(letter)
      data.push({ id: letter.id, seed: 0, cx: x + letter.width / 2, cy: letter.height / 2 })
    }
    if (!letters.length) fail('Select text with at least one visible letter.')

    const placeholder = inFlow(source)
    const opacity = source.opacity
    if (placeholder) {
      group = figma.group(letters, parent, index + 1)
      group.layoutPositioning = 'ABSOLUTE'
      source.opacity = 0
    } else {
      group = figma.group([...letters, source], parent, index)
      source.visible = false
    }
    source.locked = true
    group.name = `Crack Font – ${text.length > 40 ? text.slice(0, 40) + '…' : text}`
    const seeds = newSeeds(data.length)
    data.forEach((l, i) => { l.seed = seeds[i] })
    const crack: Crack = { group, original: source, data: { version: 2, originalId: source.id, left, right, letters: data, mode: placeholder ? 'placeholder' : 'inside', opacity } }
    rotate(crack)
    return crack
  } catch (error) {
    // Put the original back exactly where it was and remove everything we made.
    if (!source.removed) {
      if (source.parent !== parent) parent.insertChild(Math.min(index, parent.children.length), source)
      source.locked = false
      source.visible = true
      source.opacity = before.opacity
    }
    for (const node of created) if (!node.removed) node.remove()
    if (group && !group.removed) group.remove()
    throw error
  }
}

// ---------- rotate ----------

/**
 * The coordinate frame the letter centres are stored in: the original text, or for legacy groups
 * the current centre of the first letter that still exists (letters turn around their centres,
 * so it only moves when the whole group moves).
 */
function letterFrame({ group, data, original }: Crack, byId: Map<string, SceneNode>): Matrix | null {
  if (original) return original.absoluteTransform as Matrix
  for (const l of data.letters) {
    const n = byId.get(l.id)
    if (!n) continue
    const t = n.absoluteTransform
    const x = t[0][0] * n.width / 2 + t[0][1] * n.height / 2 + t[0][2]
    const y = t[1][0] * n.width / 2 + t[1][1] * n.height / 2 + t[1][2]
    return [[1, 0, x - l.cx], [0, 1, y - l.cy]]
  }
  return null
}

/** Applies data.left / data.right / seeds to every letter that still exists and saves the data. */
export function rotate(crack: Crack): void {
  const { group, data } = crack
  const byId = new Map(group.children.map(c => [c.id, c] as [string, SceneNode]))
  const frame = letterFrame(crack, byId)
  if (!frame) fail('All letters of this group were deleted.')
  const toLocal = multiply(invert(containerTransform(group)), frame)
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

/**
 * Puts the original text back (where the group is, or in its layout slot) and removes the letters.
 * Legacy groups never touched their original: the letters are removed and the original returned if found.
 */
export function restore({ group, original, data }: Crack): TextNode | null {
  assertEditable(group)
  if (!original) {
    const source = group.parent && 'children' in group.parent ? group.parent.children.find(c => c.id === data.sourceId) : undefined
    group.remove()
    return source && source.type === 'TEXT' ? source : null
  }
  original.locked = false
  if (data.mode === 'placeholder') {
    original.opacity = data.opacity ?? 1
  } else {
    const parent = group.parent as BaseNode & ChildrenMixin
    original.visible = true
    parent.insertChild(parent.children.indexOf(group), original)
  }
  group.remove()
  return original
}
