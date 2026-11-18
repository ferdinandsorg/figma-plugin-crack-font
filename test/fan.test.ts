import { describe, expect, it } from 'vitest'
import { fromPointer, grab, point } from '../src/ui/fan'

describe('fan geometry', () => {
  it('0° is straight up, 45° lies flat on either side (drawn at twice the angle)', () => {
    const [ux, uy] = point('left', 0)
    const [lx, ly] = point('left', 45), [rx, ry] = point('right', 45)
    expect(lx).toBeLessThan(ux); expect(rx).toBeGreaterThan(ux)
    expect(Math.abs(ly - ry)).toBeLessThan(1e-9)
    expect(uy).toBeLessThan(ly)
  })
  it('pointer → side and snapped angle, clamped to the maximum', () => {
    const [x, y] = point('right', 20)
    expect(fromPointer(x, y, 45, 1)).toEqual({ side: 'right', value: 20 })
    const [x2, y2] = point('left', 12.4)
    expect(fromPointer(x2, y2, 45, 1)).toEqual({ side: 'left', value: 12 })
    const [x3, y3] = point('left', 80)
    expect(fromPointer(x3, y3, 45, 1)).toEqual({ side: 'left', value: 45 })
  })
})

describe('grab', () => {
  it('a press near a handle grabs it even on the other side of the middle', () => {
    // left at 45°, right at 0° (straight up): press just left of the top handle → right handle
    const [x, y] = point('right', 0)
    expect(grab(x - 6, y + 2, { left: 45, right: 0 })).toBe('right')
    const [lx, ly] = point('left', 45)
    expect(grab(lx + 5, ly - 3, { left: 45, right: 0 })).toBe('left')
  })
  it('far from both handles, or with both handles on top of each other, the side decides', () => {
    expect(grab(0, 0, { left: 10, right: 10 })).toBeNull()
    const [x, y] = point('left', 0)
    expect(grab(x - 3, y, { left: 0, right: 0 })).toBeNull()
  })
})
