// Geometry for the result's range bar, as percentages of the track width. Pure, so the edge
// cases that broke the old bar (price far outside the range, min == max) are unit-tested.

export interface Seg {
  left: number
  width: number
}

export interface RulerGeometry {
  range: Seg // shop min..max
  mid: Seg // p25..p75, "most shops"
  median: number
  marker: number | null // the user's price
  connector: Seg | null // dashed link from the nearest end of the range to an outside marker
  tagAlign: 'start' | 'center' | 'end' // keeps the price tag inside the track at the edges
}

const PAD = 0.06 // domain padding each side, as a share of the span: the marker never sits on the edge
const MIN_SEG = 2 // % width: a zero-width range (every shop at one price) still shows as a block

export function rulerGeometry(
  g: { min: number; p25: number; median: number; p75: number; max: number },
  price: number | null,
): RulerGeometry {
  // Domain = min/max of (shop min, shop max, user price), padded.
  const lo0 = Math.min(g.min, price ?? g.min)
  const hi0 = Math.max(g.max, price ?? g.max)
  const span0 = hi0 - lo0
  const pad = span0 > 0 ? span0 * PAD : Math.max(Math.abs(hi0) * 0.05, 0.05) // all equal: pick a visible window
  const lo = lo0 - pad
  const span = hi0 + pad - lo
  const pct = (v: number) => ((v - lo) / span) * 100

  const seg = (a: number, b: number): Seg => {
    let left = pct(a)
    let width = pct(b) - left
    if (width < MIN_SEG) {
      left -= (MIN_SEG - width) / 2
      width = MIN_SEG
    }
    return { left, width }
  }

  const marker = price === null ? null : pct(price)
  let connector: Seg | null = null
  if (price !== null && price > g.max) connector = { left: pct(g.max), width: pct(price) - pct(g.max) }
  if (price !== null && price < g.min) connector = { left: pct(price), width: pct(g.min) - pct(price) }

  return {
    range: seg(g.min, g.max),
    mid: seg(g.p25, g.p75),
    median: pct(g.median),
    marker,
    connector,
    tagAlign: marker === null || (marker >= 18 && marker <= 82) ? 'center' : marker < 18 ? 'start' : 'end',
  }
}
