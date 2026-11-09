import { describe, expect, it } from 'vitest'
import type { Group, Item, Town } from './data'
import { aliasFromUrl } from './data'
import { band, checkPrice, parsePrice, pickGroup } from './verdict'

const group = (over: Partial<Group> = {}): Group => ({
  premise_type: null,
  n_premises: 29,
  fallback_level: null,
  type_mix: { Hypermarket: 8, 'Pasar Mini': 21 },
  min: 6.79,
  p25: 7.39,
  median: 8.0,
  p75: 9.5,
  max: 10.5,
  cheapest: [],
  ...over,
})

const item = (groups: Group[], over: Partial<Item> = {}): Item => ({
  item_code: 1,
  name_ms: 'AYAM BERSIH - STANDARD',
  name_en: 'Whole cleaned chicken - standard',
  unit: '1kg',
  category: 'AYAM',
  controlled: false,
  controlled_price: null,
  groups,
  ...over,
})

const where = { district: 'Petaling', state: 'Selangor' }

describe('band', () => {
  const g = group()
  it('below p25 is a good price', () => expect(band(7.38, g)).toBe('good'))
  it('exactly p25 is normal (band edges belong to the middle)', () => expect(band(7.39, g)).toBe('normal'))
  it('between p25 and p75 is normal', () => expect(band(8.5, g)).toBe('normal'))
  it('exactly p75 is normal', () => expect(band(9.5, g)).toBe('normal'))
  it('just above p75 is on the high side', () => expect(band(9.51, g)).toBe('high'))
  it('exactly max is on the high side, not above every shop', () => expect(band(10.5, g)).toBe('high'))
  it('above max is higher than every shop', () => expect(band(10.51, g)).toBe('above_max'))
  it('below min is its own band: likely a different pack size', () => expect(band(1.0, g)).toBe('below_min'))
  it('one sen below min is below_min', () => expect(band(6.78, g)).toBe('below_min'))
  it('exactly min is a good price, not below_min', () => expect(band(6.79, g)).toBe('good'))
  it('min == p25: a price on it is normal', () => expect(band(7.39, group({ min: 7.39 }))).toBe('normal'))
  it('float noise does not flip a band', () => {
    expect(band(7.390000000001, g)).toBe('normal')
    expect(band(0.1 + 0.2, group({ min: 0.2, p25: 0.3, p75: 0.5, max: 0.6 }))).toBe('normal')
    expect(band(6.790000000001, g)).toBe('good')
  })
  it('collapsed distribution: p75 == max, price on it is normal', () => {
    const flat = group({ min: 2.5, p25: 2.5, p75: 2.5, max: 2.5 })
    expect(band(2.5, flat)).toBe('normal')
    expect(band(2.51, flat)).toBe('above_max')
    expect(band(2.49, flat)).toBe('below_min')
  })
  it('refuses a group without percentiles', () => expect(() => band(3, group({ p25: null, p75: null }))).toThrow())
})

describe('parsePrice', () => {
  it.each([
    ['8.50', 8.5], ['8.5', 8.5], ['8', 8], ['RM 8.50', 8.5], ['rm8', 8], [' 12.90 ', 12.9], ['8,50', 8.5], ['8.', 8],
  ])('%j -> %s', (input, expected) => expect(parsePrice(input)).toBe(expected))
  it.each(['', 'abc', '0', '0.00', '-1', '8.555', '1.2.3', '123456'])('%j -> null', (input) =>
    expect(parsePrice(input)).toBeNull(),
  )
})

describe('pickGroup', () => {
  const all = group()
  const hyper = group({ premise_type: 'Hypermarket', n_premises: 8, type_mix: null })
  it('"Not sure" uses the all-types group', () => expect(pickGroup(item([all, hyper]), null)).toEqual({ group: all, typeAbsent: false }))
  it('a chosen type uses its own group', () => expect(pickGroup(item([all, hyper]), 'Hypermarket').group).toBe(hyper))
  it('a type with no group falls back to all types and says so', () =>
    expect(pickGroup(item([all, hyper]), 'Pasar Basah')).toEqual({ group: all, typeAbsent: true }))
})

describe('checkPrice: controlled items', () => {
  const sugar = item([group({ p25: null, median: null, p75: null, min: 2.85, max: 2.85 })], {
    item_code: 1589, controlled: true, controlled_price: 2.85,
  })
  it('skips the verdict and range entirely', () => {
    expect(checkPrice({ item: sugar, shopType: null, price: 2.85, ...where })).toEqual({
      kind: 'controlled', controlledPrice: 2.85, priceAbove: false,
    })
  })
  it('flags a price above the controlled price', () =>
    expect(checkPrice({ item: sugar, shopType: null, price: 3.2, ...where })).toMatchObject({ priceAbove: true }))
  it('no price entered: priceAbove is unknown', () =>
    expect(checkPrice({ item: sugar, shopType: 'Hypermarket', price: null, ...where })).toMatchObject({ priceAbove: null }))
})

describe('checkPrice: fallback groups', () => {
  it('district-level group: no notes, place is the district', () => {
    const c = checkPrice({ item: item([group()]), shopType: null, price: 8, ...where })
    expect(c).toMatchObject({ kind: 'range', band: 'normal', place: 'Petaling', notes: [] })
  })
  it('typed group that fell back to the district says the type was too thin', () => {
    const thin = group({ premise_type: 'Pasar Basah', fallback_level: 'district', type_mix: null })
    const c = checkPrice({ item: item([group(), thin]), shopType: 'Pasar Basah', price: 8, ...where })
    expect(c).toMatchObject({ place: 'Petaling', notes: [{ kind: 'type_thin', type: 'Pasar Basah' }] })
  })
  it('state fallback compares across the state and says so', () => {
    const state = group({ fallback_level: 'state', n_premises: 6, p25: 9.0, p75: 9.9, max: 11 })
    const c = checkPrice({ item: item([state]), shopType: null, price: 9.5, ...where })
    expect(c).toMatchObject({ band: 'normal', place: 'Selangor', notes: [{ kind: 'state', state: 'Selangor' }] })
  })
  it('missing type plus state fallback reports both', () => {
    const state = group({ fallback_level: 'state' })
    const c = checkPrice({ item: item([state]), shopType: 'Kedai Runcit', price: 8, ...where })
    expect(c).toMatchObject({ notes: [{ kind: 'type_absent', type: 'Kedai Runcit' }, { kind: 'state', state: 'Selangor' }] })
  })
  it('no price yet: range without a band', () =>
    expect(checkPrice({ item: item([group()]), shopType: null, price: null, ...where })).toMatchObject({ band: null }))
  it('no usable group: null', () =>
    expect(checkPrice({ item: item([]), shopType: null, price: 8, ...where })).toBeNull())
})

describe('checkPrice: typical hypermarket price', () => {
  const hyper = (over: Partial<Group> = {}) => group({ premise_type: 'Hypermarket', median: 7.29, type_mix: null, ...over })
  it('shown when it differs from the number on screen', () =>
    expect(checkPrice({ item: item([group(), hyper()]), shopType: null, price: 8, ...where })).toMatchObject({ hyperMedian: 7.29 }))
  it('hidden when the user already picked hypermarket', () =>
    expect(checkPrice({ item: item([group(), hyper()]), shopType: 'Hypermarket', price: 8, ...where })).toMatchObject({ hyperMedian: null }))
  it('hidden when the hypermarket group is itself a fallback copy', () =>
    expect(checkPrice({ item: item([group(), hyper({ fallback_level: 'district' })]), shopType: null, price: 8, ...where })).toMatchObject({ hyperMedian: null }))
  it('hidden when it equals the median already shown', () =>
    expect(checkPrice({ item: item([group(), hyper({ median: 8.0 })]), shopType: null, price: 8, ...where })).toMatchObject({ hyperMedian: null }))
})

describe('aliasFromUrl (?town= on shared links)', () => {
  const towns: Record<string, Town> = {
    rawang: { slug: 'gombak', alias: true },
    'subang jaya': { slug: 'petaling', alias: false },
  }
  it('alias town matching the district: label it', () =>
    expect(aliasFromUrl(towns, 'rawang', 'gombak')).toEqual({ town: 'rawang', slug: 'gombak' }))
  it('alias town with no district: implies the district', () =>
    expect(aliasFromUrl(towns, 'Rawang', null)).toEqual({ town: 'rawang', slug: 'gombak' }))
  it('alias town for a different district: ignored, the label would be false', () =>
    expect(aliasFromUrl(towns, 'rawang', 'petaling')).toBeNull())
  it('plain (non-alias) town: no label', () => expect(aliasFromUrl(towns, 'subang jaya', 'petaling')).toBeNull())
  it('unknown or missing town: no label', () => {
    expect(aliasFromUrl(towns, 'atlantis', 'gombak')).toBeNull()
    expect(aliasFromUrl(towns, null, 'gombak')).toBeNull()
  })
})
