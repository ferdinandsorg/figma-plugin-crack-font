// Pure rotation math, shared by the plugin and the tests. No Figma API in here.

export type Matrix = [[number, number, number], [number, number, number]]

export const MAX_ANGLE = 15

/** One random value per letter in [-1, 1). The pattern stays fixed while the sliders only scale it. */
export function newSeeds(count: number, random: () => number = Math.random): number[] {
  return Array.from({ length: count }, () => random() * 2 - 1)
}

/**
 * Rotation in degrees, Figma convention: positive = counter-clockwise (tilts left).
 * Seeds ≥ 0 tilt left up to `left`, seeds < 0 tilt right up to `right`.
 */
export function angleFor(seed: number, left: number, right: number): number {
  return seed >= 0 ? seed * left : seed * right
}

export function clampAngle(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.min(MAX_ANGLE, Math.max(0, value))
}

export function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    [a[0][0] * b[0][0] + a[0][1] * b[1][0], a[0][0] * b[0][1] + a[0][1] * b[1][1], a[0][0] * b[0][2] + a[0][1] * b[1][2] + a[0][2]],
    [a[1][0] * b[0][0] + a[1][1] * b[1][0], a[1][0] * b[0][1] + a[1][1] * b[1][1], a[1][0] * b[0][2] + a[1][1] * b[1][2] + a[1][2]],
  ]
}

export function invert(m: Matrix): Matrix {
  const det = m[0][0] * m[1][1] - m[0][1] * m[1][0]
  if (Math.abs(det) < 1e-12) throw new Error('Cannot invert a degenerate transform.')
  const a = m[1][1] / det, b = -m[0][1] / det, c = -m[1][0] / det, d = m[0][0] / det
  return [[a, b, -(a * m[0][2] + b * m[1][2])], [c, d, -(c * m[0][2] + d * m[1][2])]]
}

export function translate(x: number, y: number): Matrix {
  return [[1, 0, x], [0, 1, y]]
}

/** Transform of a w×h box rotated by `deg` around its centre (cx, cy), in the frame the centre is given in. */
export function rotateAround(cx: number, cy: number, w: number, h: number, deg: number): Matrix {
  const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r)
  return [[c, s, cx - c * w / 2 - s * h / 2], [-s, c, cy + s * w / 2 - c * h / 2]]
}

/** Whitespace without visible decoration needs no layer of its own. */
export function needsLayer(char: string, decorated: boolean): boolean {
  return decorated || char.trim() !== ''
}
