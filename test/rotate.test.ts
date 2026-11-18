import { describe, expect, it } from 'vitest'
import { angleFor, clampAngle, invert, multiply, needsLayer, newSeeds, rotateAround, translate, MAX_ANGLE, type Matrix } from '../src/rotate'

const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-9)
const apply = (m: Matrix, x: number, y: number) => [m[0][0] * x + m[0][1] * y + m[0][2], m[1][0] * x + m[1][1] * y + m[1][2]]

describe('angleFor', () => {
  it('maps positive seeds to the left limit and negative seeds to the right limit', () => {
    expect(angleFor(1, 5, 8)).toBe(5)
    expect(angleFor(-1, 5, 8)).toBe(-8)
    expect(angleFor(0.5, 4, 10)).toBe(2)
    expect(angleFor(-0.25, 4, 10)).toBe(-2.5)
  })
  it('a zero limit keeps that side straight', () => {
    expect(angleFor(0.7, 0, 6)).toBe(0)
    expect(angleFor(-0.7, 6, 0) === 0).toBe(true)
  })
  it('scales the same pattern when the limits change', () => {
    const seeds = [0.2, -0.6, 0.9]
    const a = seeds.map(s => angleFor(s, 2, 2)), b = seeds.map(s => angleFor(s, 4, 4))
    a.forEach((v, i) => near(b[i], v * 2))
  })
})

describe('newSeeds', () => {
  it('stays in [-1, 1)', () => {
    expect(newSeeds(3, () => 0)).toEqual([-1, -1, -1])
    const top = newSeeds(1, () => 1 - Number.EPSILON)[0]
    expect(top).toBeLessThan(1)
    expect(newSeeds(1, () => 0.5)).toEqual([0])
  })
})

describe('clampAngle', () => {
  it('clamps to 0…MAX and rejects non-numbers', () => {
    expect(clampAngle(-3)).toBe(0)
    expect(clampAngle(99)).toBe(MAX_ANGLE)
    expect(clampAngle(4.5)).toBe(4.5)
    expect(clampAngle(NaN)).toBeNull()
    expect(clampAngle('3')).toBeNull()
  })
})

describe('rotateAround', () => {
  it('keeps the centre in place for any angle', () => {
    for (const deg of [-15, -3, 0, 7, 15]) {
      const m = rotateAround(50, 20, 30, 40, deg)
      const [x, y] = apply(m, 15, 20)
      near(x, 50); near(y, 20)
    }
  })
  it('positive angles turn counter-clockwise like Figma rotation', () => {
    const m = rotateAround(0, 0, 0, 0, 90)
    const [x, y] = apply(m, 1, 0)
    near(x, 0); near(y, -1)
  })
})

describe('matrices', () => {
  it('invert undoes multiply', () => {
    const a: Matrix = [[0.8, 0.6, 10], [-0.6, 0.8, -4]]
    const id = multiply(invert(a), a)
    near(id[0][0], 1); near(id[0][1], 0); near(id[0][2], 0)
    near(id[1][0], 0); near(id[1][1], 1); near(id[1][2], 0)
    expect(multiply(translate(3, 4), translate(1, 2))).toEqual(translate(4, 6))
  })
})

describe('needsLayer', () => {
  it('skips plain whitespace but keeps decorated spaces', () => {
    expect(needsLayer('a', false)).toBe(true)
    expect(needsLayer(' ', false)).toBe(false)
    expect(needsLayer(' ', true)).toBe(true)
  })
})
