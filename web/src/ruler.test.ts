import { describe, expect, it } from 'vitest'
import { rulerGeometry } from './ruler'

const eggs = { min: 13.5, p25: 14.05, median: 14.85, p75: 15.6, max: 18 }
const inBounds = (n: number) => n >= 0 && n <= 100
const end = (s: { left: number; width: number }) => s.left + s.width

describe('rulerGeometry', () => {
  it('price inside the range: no connector, everything on the track', () => {
    const r = rulerGeometry(eggs, 14.85)
    expect(r.connector).toBeNull()
    for (const v of [r.range.left, end(r.range), r.mid.left, end(r.mid), r.median, r.marker!]) expect(inBounds(v)).toBe(true)
  })

  it('domain is padded: neither the range nor the marker touches an edge', () => {
    const r = rulerGeometry(eggs, null)
    expect(r.range.left).toBeGreaterThan(0)
    expect(end(r.range)).toBeLessThan(100)
  })

  it('price far above max: dashed connector from max to the marker', () => {
    const r = rulerGeometry(eggs, 25)
    expect(r.connector!.left).toBeCloseTo(end(r.range))
    expect(end(r.connector!)).toBeCloseTo(r.marker!)
    expect(r.marker!).toBeLessThan(100)
    expect(r.tagAlign).toBe('end')
  })

  it('price far below min: dashed connector from the marker to min', () => {
    const r = rulerGeometry(eggs, 3)
    expect(r.connector!.left).toBeCloseTo(r.marker!)
    expect(end(r.connector!)).toBeCloseTo(r.range.left)
    expect(r.marker!).toBeGreaterThan(0)
    expect(r.tagAlign).toBe('start')
  })

  it('min == max with no price: finite, visible, centred', () => {
    const r = rulerGeometry({ min: 16, p25: 16, median: 16, p75: 16, max: 16 }, null)
    expect(Number.isFinite(r.range.left)).toBe(true)
    expect(r.range.width).toBeGreaterThanOrEqual(2)
    expect(r.median).toBeCloseTo(50)
  })

  it('min == max == price: no NaN, no connector', () => {
    const r = rulerGeometry({ min: 2.5, p25: 2.5, median: 2.5, p75: 2.5, max: 2.5 }, 2.5)
    expect(r.marker).toBeCloseTo(50)
    expect(r.connector).toBeNull()
  })

  it('min == max, price just above: connector still drawn and on the track', () => {
    const r = rulerGeometry({ min: 16, p25: 16, median: 16, p75: 16, max: 16 }, 16.5)
    expect(r.connector!.width).toBeGreaterThan(0)
    expect(inBounds(r.marker!)).toBe(true)
  })
})
