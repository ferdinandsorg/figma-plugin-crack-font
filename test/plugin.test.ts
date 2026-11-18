// Runs the built dist/code.js in a VM against a small Figma mock.
// The mock follows Figma's rules that matter here: children of groups are positioned relative to
// the nearest non-group ancestor, group bounds ignore hidden children, trailing spaces have no width.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'

type M = [[number, number, number], [number, number, number]]
const code = readFileSync(resolve(__dirname, '../dist/code.js'), 'utf8')
const manifest = JSON.parse(readFileSync(resolve(__dirname, '../manifest.json'), 'utf8'))
const I = (x = 0, y = 0): M => [[1, 0, x], [0, 1, y]]
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v))
const mul = (a: M, b: M): M => [
  [a[0][0] * b[0][0] + a[0][1] * b[1][0], a[0][0] * b[0][1] + a[0][1] * b[1][1], a[0][0] * b[0][2] + a[0][1] * b[1][2] + a[0][2]],
  [a[1][0] * b[0][0] + a[1][1] * b[1][0], a[1][0] * b[0][1] + a[1][1] * b[1][1], a[1][0] * b[0][2] + a[1][1] * b[1][2] + a[1][2]],
]
const ZW = '​'
type Style = { fontName: { family: string; style: string }; fontSize: number; lineHeight: { unit: string }; textDecoration: string; fill: number }

function harness(text = 'AVA b', opts: { styles?: (i: number) => Partial<Style>; failFont?: string; failOn?: string } = {}) {
  let nextId = 0, mutations = 0
  const fontLoads: { family: string; mutations: number }[] = []
  const messages: any[] = []
  const draws: number[] = []
  const handlers: Record<string, () => void> = {}
  const touch = (kind: string) => { mutations++; if (opts.failOn === kind) { opts.failOn = undefined; throw new Error(`Injected ${kind} failure`) } }

  class Node {
    id = String(++nextId); parent: Node | null = null; children: Node[] = []
    locked = false; visible = true; removed = false; name = ''; data: Record<string, string> = {}
    _rel: M = I()
    constructor(public type: string) {}
    get container(): Node | null { let p = this.parent; while (p && p.type === 'GROUP') p = p.parent; return p }
    get absoluteTransform(): M {
      if (this.type === 'GROUP') { const b = this.bounds(); return I(b.x, b.y) }
      const c = this.container
      return mul(c && c.type !== 'PAGE' ? c.absoluteTransform : I(), this._rel)
    }
    get relativeTransform(): M { return copy(this._rel) }
    set relativeTransform(t: M) { touch('transform'); this._rel = copy(t) }
    get x() { return this._rel[0][2] }
    get y() { return this._rel[1][2] }
    get width(): number { return this.type === 'GROUP' ? this.bounds().w : 0 }
    get height(): number { return this.type === 'GROUP' ? this.bounds().h : 0 }
    bounds() {
      const pts = this.children.filter(c => c.visible).flatMap(c => {
        const t = c.absoluteTransform
        return [[0, 0], [c.width, 0], [0, c.height], [c.width, c.height]].map(([x, y]) => [t[0][0] * x + t[0][1] * y + t[0][2], t[1][0] * x + t[1][1] * y + t[1][2]])
      })
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1])
      return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
    }
    insertChild(index: number, node: Node) {
      touch('insert')
      const abs = node.type === 'GROUP' ? null : node.absoluteTransform
      if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1)
      node.parent = this; this.children.splice(index, 0, node)
      if (abs) { const c = node.container; const inv = c && c.type !== 'PAGE' ? c.absoluteTransform : I(); node._rel = [[abs[0][0], abs[0][1], abs[0][2] - inv[0][2]], [abs[1][0], abs[1][1], abs[1][2] - inv[1][2]]] }
    }
    appendChild(node: Node) { this.insertChild(this.children.length, node) }
    getPluginData(k: string) { return this.data[k] || '' }
    setPluginData(k: string, v: string) { touch('data'); this.data[k] = v }
    remove() {
      touch('remove')
      for (const c of [...this.children]) c.remove()
      if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1)
      this.parent = null; this.removed = true
    }
  }

  const baseStyle = (i: number): Style => ({ fontName: { family: 'Sans', style: 'Bold' }, fontSize: 20, lineHeight: { unit: 'AUTO' }, textDecoration: 'NONE', fill: i, ...(opts.styles?.(i) ?? {}) })
  const advance = (c: string, s: Style) => c === ZW ? 0 : s.fontSize * (c === ' ' ? 0.25 : 0.6)
  const kern = (a: string, b: string) => (a === 'A' && b === 'V') || (a === 'V' && b === 'A') ? -3 : 0
  class Text extends Node {
    textAutoResize = 'WIDTH_AND_HEIGHT'; hasMissingFont = false
    constructor(public characters: string, public styles: Style[]) { super('TEXT') }
    get width() {
      let chars = this.characters, end = chars.length
      while (end > 0 && chars[end - 1] === ' ') end-- // trailing spaces don't count, like Figma
      let w = 0
      for (let i = 0; i < end; i++) w += advance(chars[i], this.styles[i]) + (i > 0 ? kern(chars[i - 1], chars[i]) : 0)
      return w
    }
    get height() { return Math.max(...this.styles.map(s => s.fontSize * 1.2)) }
    clone() {
      touch('clone')
      const t = new Text(this.characters, copy(this.styles)); t._rel = copy(this._rel); t.name = this.name
      this.parent!.insertChild(this.parent!.children.indexOf(this) + 1, t); return t
    }
    deleteCharacters(a: number, b: number) { touch('delete'); this.characters = this.characters.slice(0, a) + this.characters.slice(b); this.styles.splice(a, b - a) }
    insertCharacters(at: number, chars: string, use: 'BEFORE' | 'AFTER') {
      touch('insert-text')
      const s = copy(this.styles[use === 'BEFORE' ? Math.max(0, at - 1) : Math.min(at, this.styles.length - 1)])
      this.characters = this.characters.slice(0, at) + chars + this.characters.slice(at)
      this.styles.splice(at, 0, ...Array.from(chars, () => copy(s)))
    }
    private set(a: number, b: number, k: keyof Style, v: any) { touch('style'); for (let i = a; i < b; i++) (this.styles[i] as any)[k] = copy(v) }
    setRangeFontName(a: number, b: number, v: any) { this.set(a, b, 'fontName', v) }
    setRangeFontSize(a: number, b: number, v: any) { this.set(a, b, 'fontSize', v) }
    setRangeLineHeight(a: number, b: number, v: any) { this.set(a, b, 'lineHeight', v) }
    getRangeFontName(a: number) { return copy(this.styles[a].fontName) }
    getRangeFontSize(a: number) { return this.styles[a].fontSize }
    getRangeLineHeight(a: number) { return copy(this.styles[a].lineHeight) }
    getRangeTextDecoration(a: number) { return this.styles[a].textDecoration }
    getRangeAllFontNames(a: number, b: number) { return this.styles.slice(a, b).map(s => copy(s.fontName)) }
    getStyledTextSegments(fields: (keyof Style)[]) {
      const out: any[] = []
      this.styles.forEach((s, i) => {
        const pick = Object.fromEntries(fields.map(f => [f, copy(s[f])]))
        const last = out[out.length - 1]
        if (last && JSON.stringify(fields.map(f => last[f])) === JSON.stringify(fields.map(f => pick[f]))) last.end = i + 1
        else out.push({ start: i, end: i + 1, ...pick })
      })
      return out
    }
  }

  const page = new Node('PAGE') as Node & { selection: Node[] }
  page.selection = []
  const other = new Text('x', [baseStyle(0)]); page.appendChild(other)
  const source = new Text(text, Array.from(text, (_, i) => baseStyle(i)))
  source.name = 'Headline'; source._rel = I(100, 200); page.appendChild(source)
  page.selection = [source]
  const figma: any = {
    currentPage: page,
    ui: { postMessage: (m: any) => messages.push(m) },
    showUI() {},
    closePlugin() {},
    on(event: string, cb: () => void) { handlers[event] = cb },
    async loadFontAsync(font: { family: string }) {
      fontLoads.push({ family: font.family, mutations })
      if (font.family === opts.failFont) throw new Error('missing')
    },
    group(nodes: Node[], parent: Node, index: number) {
      touch('group')
      const g = new Node('GROUP'); parent.insertChild(index, g)
      for (const n of nodes) g.appendChild(n)
      return g
    },
  }
  mutations = 0 // setup above is not part of the test
  const math = Object.create(Math)
  math.random = () => draws.length ? draws.shift()! : 0.75
  vm.runInNewContext(code, { figma, __html__: '', Math: math, console: { error() {} } })

  const send = async (type: string, left = 3, right = 3) => { await figma.ui.onmessage({ type, left, right }); return messages }
  const groups = () => page.children.filter(n => n.type === 'GROUP')
  const letters = () => groups()[0].children.filter(c => c.visible) as Text[]
  const status = () => messages.filter(m => m.type === 'status').at(-1)
  const select = (n: Node) => { page.selection = [n]; handlers.selectionchange?.() }
  return { figma, page, source, other, messages, draws, fontLoads, send, groups, letters, status, select, Text, get mutations() { return mutations } }
}

const near = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b), `${a} vs ${b}`).toBeLessThan(eps)
const angle = (n: { absoluteTransform: M }) => Math.atan2(-n.absoluteTransform[1][0], n.absoluteTransform[0][0]) * 180 / Math.PI
const center = (n: any) => { const t = n.absoluteTransform; return [t[0][0] * n.width / 2 + t[0][1] * n.height / 2 + t[0][2], t[1][0] * n.width / 2 + t[1][1] * n.height / 2 + t[1][2]] }
const plain = (s: string) => s.split(ZW).join('')

describe('split in place', () => {
  it('replaces the text with a letter group at the same position and keeps the original hidden inside', async () => {
    const h = harness()
    await h.send('apply')
    expect(h.status().error).toBe(false)
    const [g] = h.groups()
    expect(h.page.children.indexOf(g)).toBe(1) // same layer position as the source
    expect(h.source.parent).toBe(g)
    expect(h.source.visible).toBe(false)
    expect(h.source.locked).toBe(true)
    expect(h.letters().map(l => plain(l.characters))).toEqual(['A', 'V', 'A', 'b']) // the space needs no layer
    expect(h.page.selection).toEqual([g])
  })

  it('keeps kerning and every range style', async () => {
    const h = harness('AVA b', { styles: i => ({ fill: i * 10 }) })
    await h.send('apply', 0, 0)
    const [a, v, a2, b] = h.letters()
    near(a.absoluteTransform[0][2], 100)
    near(v.absoluteTransform[0][2], 100 + 12 - 3) // A is 12 wide, AV kerned by −3
    near(a2.absoluteTransform[0][2], 100 + 12 - 3 + 12 - 3)
    near(b.absoluteTransform[0][2], 100 + 36 - 6 + 5) // after the space
    expect([a, v, a2, b].map(l => l.styles[0].fill)).toEqual([0, 10, 20, 40])
    h.letters().forEach(l => near(l.absoluteTransform[1][2], 200))
  })

  it('aligns mixed font sizes on the original line with zero-width struts', async () => {
    const h = harness('aB', { styles: i => (i === 1 ? { fontSize: 40 } : {}) })
    await h.send('apply', 0, 0)
    const [a, b] = h.letters()
    expect(a.characters.includes(ZW)).toBe(true)
    expect(b.characters.includes(ZW)).toBe(false) // already the tallest style
    near(a.height, h.source.height)
    near(b.height, h.source.height)
    expect(plain(a.characters)).toBe('a')
  })

  it('loads every font before changing anything and changes nothing if a font is missing', async () => {
    const h = harness('Ab', { styles: i => ({ fontName: { family: i ? 'Serif' : 'Sans', style: 'Regular' } }) })
    await h.send('apply')
    expect(h.fontLoads.map(f => f.family)).toEqual(['Sans', 'Serif'])
    expect(h.fontLoads.every(f => f.mutations === 0)).toBe(true)

    const bad = harness('Ab', { failFont: 'Sans' })
    const before = bad.page.children.length
    await bad.send('apply')
    expect(bad.status().error).toBe(true)
    expect(bad.mutations).toBe(0)
    expect(bad.page.children.length).toBe(before)
  })

  it('puts the original back if something fails half-way', async () => {
    const h = harness('Hello', { failOn: 'group' })
    const abs = h.source.absoluteTransform
    await h.send('apply')
    expect(h.status().error).toBe(true)
    expect(h.groups()).toHaveLength(0)
    expect(h.page.children).toEqual([h.other, h.source])
    expect(h.source.visible && !h.source.locked).toBe(true)
    expect(h.source.absoluteTransform).toEqual(abs)
  })

  it('rejects unsupported text without changing anything', async () => {
    for (const text of ['two\nlines', 'emoji 😀', '   ', 'x'.repeat(201)]) {
      const h = harness(text)
      await h.send('apply')
      expect(h.status().error, text).toBe(true)
      expect(h.mutations, text).toBe(0)
    }
    const fixed = harness('Fixed'); fixed.source.textAutoResize = 'HEIGHT'
    await fixed.send('apply'); expect(fixed.mutations).toBe(0)
    const locked = harness('Locked'); locked.source.locked = true
    await locked.send('apply'); expect(locked.mutations).toBe(0)
  })
})

describe('rotation', () => {
  it('stays within −right … +left and maps seeds to angles', async () => {
    const h = harness('ABC')
    h.draws.push(1 - Number.EPSILON, 0.5, 0) // seeds ≈ 1, 0, −1
    await h.send('apply', 5, 8)
    const angles = h.letters().map(angle)
    near(angles[0], 5, 1e-4); near(angles[1], 0); near(angles[2], -8)
  })

  it('sliders scale the same pattern, letters turn around their own centre', async () => {
    const h = harness('Crack')
    await h.send('apply', 0, 0)
    const centers = h.letters().map(center)
    const ids = h.letters().map(l => l.id)
    await h.send('apply', 2, 2)
    const a = h.letters().map(angle)
    await h.send('apply', 4, 4)
    const b = h.letters().map(angle)
    a.forEach((v, i) => near(b[i], v * 2))
    h.letters().forEach((l, i) => { near(center(l)[0], centers[i][0]); near(center(l)[1], centers[i][1]) })
    expect(h.letters().map(l => l.id)).toEqual(ids)
    expect(h.groups()).toHaveLength(1)
  })

  it('shuffle draws a new pattern on the same letters', async () => {
    const h = harness('ABC')
    h.draws.push(0.9, 0.9, 0.9)
    await h.send('apply', 6, 6)
    h.draws.push(0.1, 0.1, 0.1)
    await h.send('shuffle', 6, 6)
    h.letters().forEach(l => expect(angle(l)).toBeLessThan(0))
    expect(h.groups()).toHaveLength(1)
  })

  it('works after the group was moved and when a letter is selected', async () => {
    const h = harness('Move')
    await h.send('apply', 0, 0)
    for (const c of h.groups()[0].children) { c._rel[0][2] += 50; c._rel[1][2] += 20 } // drag the group
    const centers = h.letters().map(center)
    h.select(h.letters()[1])
    await h.send('apply', 10, 10)
    h.letters().forEach((l, i) => { near(center(l)[0], centers[i][0]); near(center(l)[1], centers[i][1]) })
    expect(h.groups()).toHaveLength(1)
  })

  it('skips deleted letters', async () => {
    const h = harness('Gone')
    await h.send('apply')
    h.letters()[1].remove()
    await h.send('shuffle')
    expect(h.status()?.error ?? false).toBe(false)
  })

  it('reports the saved values when a Crack Font group is selected', async () => {
    const h = harness('Saved')
    await h.send('apply', 4, 7)
    h.select(h.groups()[0])
    expect(h.messages.at(-1)).toMatchObject({ type: 'selection', kind: 'crack', left: 4, right: 7, name: 'Saved' })
  })
})

describe('restore', () => {
  it('turns the letters back into the original text layer', async () => {
    const h = harness('Undo me')
    const abs = h.source.absoluteTransform
    await h.send('apply', 9, 9)
    await h.send('restore')
    expect(h.groups()).toHaveLength(0)
    expect(h.page.children).toEqual([h.other, h.source])
    expect(h.source.visible && !h.source.locked).toBe(true)
    expect(h.source.absoluteTransform).toEqual(abs)
    expect(h.source.characters).toBe('Undo me')
    expect(h.page.selection).toEqual([h.source])
  })

  it('follows the group when it was moved, even with deleted letters', async () => {
    const h = harness('Move')
    await h.send('apply')
    for (const c of h.groups()[0].children) { c._rel[0][2] += 50 }
    h.letters()[0].remove()
    await h.send('restore')
    near(h.source.absoluteTransform[0][2], 150)
  })

  it('needs a Crack Font group', async () => {
    const h = harness('Plain')
    await h.send('restore')
    expect(h.status().error).toBe(true)
    expect(h.mutations).toBe(0)
  })
})

describe('plugin boundary', () => {
  it('overlapping clicks create only one group', async () => {
    const h = harness('Twice')
    await Promise.all([h.send('apply'), h.send('apply')])
    expect(h.groups()).toHaveLength(1)
  })

  it('manifest keeps the Community identity and no network access', () => {
    expect(manifest.id).toBe('929414938810147814')
    expect(manifest.main).toBe('dist/code.js')
    expect(manifest.networkAccess.allowedDomains).toEqual(['none'])
  })
})
