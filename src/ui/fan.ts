// Fan control: one wedge shows how far letters may tilt left and right. Drag on either side,
// or focus a handle and use the arrow keys. The fan is drawn at twice the real angle so small
// values stay visible; the sample letters inside it use the real angles.
const SVG = 'http://www.w3.org/2000/svg'
const W = 248, H = 120, CX = W / 2, CY = 108, R = 92, INNER = 62
const SCALE = 2

export type Side = 'left' | 'right'
export type FanOptions = { max: number; step: number; onInput: (side: Side, value: number) => void }

const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, parent?: Element) => {
  const node = document.createElementNS(SVG, tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v))
  parent?.appendChild(node)
  return node
}

/** Point on the arc for a tilt of `deg` to one side (display angle = deg × SCALE). */
export function point(side: Side, deg: number, radius = R): [number, number] {
  const a = (deg * SCALE * Math.PI) / 180
  const dx = Math.sin(a) * radius
  return [CX + (side === 'left' ? -dx : dx), CY - Math.cos(a) * radius]
}

/** Pointer position → side and tilt in degrees, clamped and snapped. */
export function fromPointer(x: number, y: number, max: number, step: number): { side: Side; value: number } {
  const a = Math.atan2(x - CX, CY - y) * 180 / Math.PI // 0 = up, positive = right
  const value = Math.min(max, Math.max(0, Math.round(Math.abs(a) / SCALE / step) * step))
  return { side: a < 0 ? 'left' : 'right', value }
}

const GRAB = 16 // px around a handle that picks that handle, whichever side of the middle it is on

/**
 * Which handle a press grabs: the nearest one within GRAB. When both handles sit on top of each
 * other (both near 0°), the side of the press decides (null).
 */
export function grab(x: number, y: number, values: Record<Side, number>): Side | null {
  const d = (side: Side) => { const [hx, hy] = point(side, values[side]); return Math.hypot(x - hx, y - hy) }
  const l = d('left'), r = d('right')
  if (Math.min(l, r) > GRAB) return null
  if (Math.abs(l - r) < 4) return null
  return l < r ? 'left' : 'right'
}

export class Fan {
  readonly root: SVGSVGElement
  private values: Record<Side, number> = { left: 0, right: 0 }
  private wedge: SVGPathElement
  private edges: Record<Side, SVGLineElement>
  private handles: Record<Side, SVGCircleElement>
  private letters: Record<Side | 'mid', SVGTextElement>
  private dragging: Side | null = null
  private disabled = false

  constructor(host: HTMLElement, private opts: FanOptions) {
    const svg = this.root = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'fan', role: 'group', 'aria-label': 'Rotation range' })
    // track with ticks every 15°
    el('path', { d: `M ${point('left', opts.max).join(' ')} A ${R} ${R} 0 0 1 ${point('right', opts.max).join(' ')}`, class: 'fan-track' }, svg)
    for (let d = 0; d <= opts.max; d += 15) for (const side of ['left', 'right'] as Side[]) {
      const [x1, y1] = point(side, d, R + 3), [x2, y2] = point(side, d, R + (d % 45 === 0 ? 9 : 6))
      el('line', { x1, y1, x2, y2, class: 'fan-tick' }, svg)
    }
    el('line', { x1: CX, y1: CY, x2: CX, y2: CY - R, class: 'fan-zero' }, svg)
    this.wedge = el('path', { class: 'fan-wedge' }, svg)
    this.edges = { left: el('line', { class: 'fan-edge' }, svg), right: el('line', { class: 'fan-edge' }, svg) }
    const letter = (cls: string) => { const t = el('text', { x: CX, y: CY - 30, class: cls, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, svg); t.textContent = 'A'; return t }
    this.letters = { left: letter('fan-letter ghost'), right: letter('fan-letter ghost'), mid: letter('fan-letter') }
    const handle = (side: Side) => {
      const c = el('circle', { r: 7, class: 'fan-handle', tabindex: 0, role: 'slider', 'aria-label': `Tilt ${side}`, 'aria-valuemin': 0, 'aria-valuemax': opts.max }, svg)
      c.addEventListener('keydown', e => this.onKey(side, e))
      return c
    }
    this.handles = { left: handle('left'), right: handle('right') }
    svg.addEventListener('pointerdown', e => this.onPointer(e, true))
    svg.addEventListener('pointermove', e => { if (this.dragging) this.onPointer(e, false) })
    const end = () => { this.dragging = null; svg.classList.remove('dragging') }
    svg.addEventListener('pointerup', end)
    svg.addEventListener('pointercancel', end)
    host.appendChild(svg)
    this.render()
  }

  set(side: Side, value: number): void {
    this.values[side] = value
    this.render()
  }

  /** Swaps the sample letter (the easter egg: type any letter or digit). */
  setLetter(char: string): void {
    for (const t of Object.values(this.letters)) t.textContent = char
  }

  setDisabled(disabled: boolean): void {
    this.disabled = disabled
    this.root.classList.toggle('disabled', disabled)
    for (const h of Object.values(this.handles)) h.setAttribute('tabindex', disabled ? '-1' : '0')
  }

  private local(e: PointerEvent): [number, number] {
    const r = this.root.getBoundingClientRect()
    return [(e.clientX - r.left) * W / r.width, (e.clientY - r.top) * H / r.height]
  }

  private onPointer(e: PointerEvent, start: boolean): void {
    if (this.disabled) return
    const [x, y] = this.local(e)
    const hit = fromPointer(x, y, this.opts.max, 1) // dragging snaps to whole degrees
    if (start) {
      this.dragging = grab(x, y, this.values) ?? hit.side
      this.root.setPointerCapture(e.pointerId)
      this.root.classList.add('dragging')
      this.handles[hit.side].focus({ preventScroll: true })
    }
    const side = this.dragging!
    const value = hit.side === side ? hit.value : 0 // dragged past the middle: that side goes to 0
    if (value !== this.values[side]) { this.set(side, value); this.opts.onInput(side, value) }
    e.preventDefault()
  }

  private onKey(side: Side, e: KeyboardEvent): void {
    if (this.disabled) return
    const step = e.shiftKey ? 5 : 1
    const outward = side === 'left' ? ['ArrowLeft', 'ArrowUp'] : ['ArrowRight', 'ArrowUp']
    const inward = side === 'left' ? ['ArrowRight', 'ArrowDown'] : ['ArrowLeft', 'ArrowDown']
    let v = this.values[side]
    if (outward.includes(e.key)) v += step
    else if (inward.includes(e.key)) v -= step
    else if (e.key === 'Home') v = 0
    else if (e.key === 'End') v = this.opts.max
    else return
    v = Math.min(this.opts.max, Math.max(0, Math.round(v / this.opts.step) * this.opts.step))
    e.preventDefault()
    if (v !== this.values[side]) { this.set(side, v); this.opts.onInput(side, v) }
  }

  private render(): void {
    const { left, right } = this.values
    const [lx, ly] = point('left', left), [rx, ry] = point('right', right)
    this.wedge.setAttribute('d', `M ${CX} ${CY} L ${lx} ${ly} A ${R} ${R} 0 0 1 ${rx} ${ry} Z`)
    // Edges start outside the sample letter so it stays readable.
    const edge = (side: Side, deg: number, x: number, y: number) => {
      const [ix, iy] = point(side, deg, INNER), l = this.edges[side]
      l.setAttribute('x1', String(ix)); l.setAttribute('y1', String(iy)); l.setAttribute('x2', String(x)); l.setAttribute('y2', String(y))
    }
    edge('left', left, lx, ly); edge('right', right, rx, ry)
    for (const [side, x, y, v] of [['left', lx, ly, left], ['right', rx, ry, right]] as const) {
      const h = this.handles[side]
      h.setAttribute('cx', String(x)); h.setAttribute('cy', String(y))
      h.setAttribute('aria-valuenow', String(v)); h.setAttribute('aria-valuetext', `${v}°`)
    }
    // Sample letters at the real extremes (positive SVG rotation = clockwise = right).
    const ty = CY - 30
    this.letters.left.setAttribute('transform', `rotate(${-left} ${CX} ${ty})`)
    this.letters.right.setAttribute('transform', `rotate(${right} ${CX} ${ty})`)
  }
}
