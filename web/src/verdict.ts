// The decision logic: which comparison group applies, which verdict band a price falls in,
// and which caveats the user must see. Pure functions, no React, so every edge case is unit-tested
// (verdict.test.ts). The UI only renders what this returns.
import type { Group, Item } from './data'

export type Band = 'below_min' | 'good' | 'normal' | 'high' | 'above_max'

/** Why the number shown isn't the exact group the user asked for. */
export type Note =
  | { kind: 'type_absent'; type: string } // no shop of the chosen type prices this item here
  | { kind: 'type_thin'; type: string } // < 5 shops of that type: compared with all types in the district
  | { kind: 'state'; state: string } // < 5 shops in the district: compared across the state

export type Check =
  | { kind: 'controlled'; controlledPrice: number; priceAbove: boolean | null }
  | {
      kind: 'range'
      group: Group
      band: Band | null // null until the user enters a price
      place: string // where the comparison shops are: district, or state on fallback
      notes: Note[]
      hyperMedian: number | null // typical hypermarket price in the district, when it adds information
    }

// Compare in whole sen: 8.5 vs 8.50000001 must not flip a band.
const sen = (n: number) => Math.round(n * 100)

/**
 * Verdict band for a price within a group's distribution.
 * Boundaries: below min = below_min (likely a different pack size, so not called "good");
 * min up to p25 = good; p25..p75 inclusive = normal; above p75 up to max = high; above max.
 * A price exactly on p25 or p75 is "normal": the band edges belong to the middle.
 */
export function band(price: number, g: Pick<Group, 'min' | 'p25' | 'p75' | 'max'>): Band {
  if (g.p25 === null || g.p75 === null) throw new Error('band() needs percentiles (controlled items have none)')
  const p = sen(price)
  if (p < sen(g.min)) return 'below_min'
  if (p < sen(g.p25)) return 'good'
  if (p <= sen(g.p75)) return 'normal'
  if (p <= sen(g.max)) return 'high'
  return 'above_max'
}

/** "RM 8.50", "8,50", " 8.5 " -> 8.5. Anything not a positive amount -> null. */
export function parsePrice(input: string): number | null {
  const s = input.trim().replace(/^rm\s*/i, '').replace(',', '.')
  if (!/^\d{1,5}(\.\d{0,2})?$/.test(s)) return null
  const n = Number(s)
  return n > 0 ? n : null
}

/**
 * Pick the comparison group. shopType is the data value (e.g. 'Hypermarket'), or null for "Not sure".
 * Falls back to the all-types group when no shop of the chosen type prices the item here.
 */
export function pickGroup(item: Item, shopType: string | null): { group: Group | null; typeAbsent: boolean } {
  const all = item.groups.find((g) => g.premise_type === null) ?? null
  if (shopType === null) return { group: all, typeAbsent: false }
  const typed = item.groups.find((g) => g.premise_type === shopType)
  return typed ? { group: typed, typeAbsent: false } : { group: all, typeAbsent: true }
}

export function checkPrice(args: {
  item: Item
  shopType: string | null
  price: number | null
  district: string
  state: string
}): Check | null {
  const { item, shopType, price, district, state } = args

  if (item.controlled && item.controlled_price !== null) {
    const priceAbove = price === null ? null : sen(price) > sen(item.controlled_price)
    return { kind: 'controlled', controlledPrice: item.controlled_price, priceAbove }
  }

  const { group, typeAbsent } = pickGroup(item, shopType)
  if (!group) return null

  const notes: Note[] = []
  if (typeAbsent && shopType) notes.push({ kind: 'type_absent', type: shopType })
  // A typed group that fell back to 'district' now holds all-types numbers: say so.
  if (group.fallback_level === 'district' && group.premise_type !== null) {
    notes.push({ kind: 'type_thin', type: group.premise_type })
  }
  if (group.fallback_level === 'state') notes.push({ kind: 'state', state })

  // Typical hypermarket price: only from a real district-level hypermarket group (a fallback copy
  // would just repeat the all-types number), and only when it differs from what's already shown.
  const hyper = item.groups.find((g) => g.premise_type === 'Hypermarket' && g.fallback_level === null)
  const hyperMedian =
    shopType !== 'Hypermarket' && hyper?.median != null && group.median !== null && sen(hyper.median) !== sen(group.median)
      ? hyper.median
      : null

  return {
    kind: 'range',
    group,
    band: price === null ? null : band(price, group),
    place: group.fallback_level === 'state' ? state : district,
    notes,
    hyperMedian,
  }
}
