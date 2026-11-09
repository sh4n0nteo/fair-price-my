// Types mirror the pipeline's JSON (pipeline/sql/06_output.sql, 07_towns.sql, export.py).

export type FallbackLevel = 'district' | 'state' | null

export interface Cheapest {
  premise_code: number
  price: number
  date_seen: string // YYYY-MM-DD
}

export interface Group {
  premise_type: string | null // null = all shop types
  n_premises: number
  fallback_level: FallbackLevel
  type_mix: Record<string, number> | null // all-types groups only
  min: number
  p25: number | null // null for controlled items
  median: number | null
  p75: number | null
  max: number
  cheapest: Cheapest[]
}

export interface Item {
  item_code: number
  name_ms: string
  name_en: string
  unit: string
  category: string
  controlled: boolean
  controlled_price: number | null
  groups: Group[]
}

export interface Premise {
  name: string
  type: string
  address: string
}

export interface District {
  slug: string
  state: string
  district: string
  items: Item[]
  premises: Record<string, Premise>
  window: { start: string; end: string }
}

export interface Town {
  slug: string
  alias: boolean // hand-mapped (config town_aliases): the UI explains the jump
}

export interface ManifestDistrict {
  slug: string
  state: string
  district: string
}

export interface Manifest {
  built_at: string
  window: { start: string; end: string }
  districts: ManifestDistrict[]
}

// Shop types as stored in the data, with short codes for URLs and plain-English labels.
export const SHOP_TYPES = [
  { code: 'hyper', value: 'Hypermarket', label: 'Hypermarket', plural: 'hypermarkets', ms: '' },
  { code: 'super', value: 'Pasar Raya / Supermarket', label: 'Supermarket', plural: 'supermarkets', ms: 'Pasar raya' },
  { code: 'mini', value: 'Pasar Mini', label: 'Mini market', plural: 'mini markets', ms: 'Pasar mini' },
  { code: 'runcit', value: 'Kedai Runcit', label: 'Sundry shop', plural: 'sundry shops', ms: 'Kedai runcit' },
  { code: 'basah', value: 'Pasar Basah', label: 'Wet market', plural: 'wet markets', ms: 'Pasar basah' },
] as const

export type ShopTypeCode = (typeof SHOP_TYPES)[number]['code']

export const shopTypeByValue = (value: string) => SHOP_TYPES.find((s) => s.value === value)
export const shopTypeByCode = (code: string | null) => SHOP_TYPES.find((s) => s.code === code)

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`)
  return res.json() as Promise<T>
}

export const loadTowns = () => getJson<Record<string, Town>>('/data/towns.json')
export const loadManifest = () => getJson<Manifest>('/data/manifest.json')

// Cache the promise, not the result: two quick taps share one request.
// A failed request is evicted so the next attempt retries instead of replaying the error.
const districtCache = new Map<string, Promise<District>>()
export function loadDistrict(slug: string): Promise<District> {
  let p = districtCache.get(slug)
  if (!p) {
    p = getJson<District>(`/data/districts/${slug}.json`)
    p.catch(() => districtCache.delete(slug))
    districtCache.set(slug, p)
  }
  return p
}

// ---- formatting (Malaysian conventions: RM, day-month-year) ----

export const rm = (n: number) => `RM ${n.toFixed(2)}`

const dateFmt = new Intl.DateTimeFormat('en-MY', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const shortDateFmt = new Intl.DateTimeFormat('en-MY', { day: 'numeric', month: 'short', timeZone: 'UTC' })
export const fmtDate = (iso: string) => dateFmt.format(new Date(iso + 'T00:00:00Z'))
export const fmtShortDate = (iso: string) => shortDateFmt.format(new Date(iso + 'T00:00:00Z'))

/**
 * The optional ?town= param of a shared link. Returns the alias town to label, and the district it
 * implies, only when the town is a hand-mapped alias of that district (or no district was given).
 * A plain town, an unknown town or a mismatched district returns null: the label would be false.
 */
export function aliasFromUrl(
  towns: Record<string, Town>,
  town: string | null,
  slug: string | null,
): { town: string; slug: string } | null {
  const key = town?.trim().toLowerCase()
  const t = key ? towns[key] : undefined
  if (!key || !t?.alias) return null
  if (slug !== null && slug !== t.slug) return null
  return { town: key, slug: t.slug }
}

/** "Subang Jaya" from "subang jaya"; keeps short tokens like "kl" readable. */
export const titleCase = (s: string) =>
  s.replace(/\S+/g, (w) => (w.length <= 2 ? w.toUpperCase() : w[0]!.toUpperCase() + w.slice(1)))
