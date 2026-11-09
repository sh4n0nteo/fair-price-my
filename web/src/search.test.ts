import { describe, expect, it } from 'vitest'
import { rank } from './search'

const items = [
  { en: 'Ayam Brand sardines (tomato sauce)', ms: 'SARDIN CAP AYAM (SOS TOMATO)' },
  { en: 'Whole cleaned chicken - standard', ms: 'AYAM BERSIH - STANDARD' },
  { en: 'Coarse refined white sugar', ms: 'GULA PUTIH BERTAPIS KASAR' },
]
const f = (i: (typeof items)[number]) => [i.en, i.ms]

describe('rank', () => {
  it('matches Malay names', () => expect(rank(items, 'gula', f).map((i) => i.en)).toEqual(['Coarse refined white sugar']))
  it('needs every word, in any order, across both names', () =>
    expect(rank(items, 'standard chicken', f).map((i) => i.ms)).toEqual(['AYAM BERSIH - STANDARD']))
  it('prefix matches rank first, shorter text breaks ties', () =>
    expect(rank(items, 'ayam', f).map((i) => i.ms)).toEqual(['AYAM BERSIH - STANDARD', 'SARDIN CAP AYAM (SOS TOMATO)']))
  it('ignores case and punctuation', () => expect(rank(items, 'AYAM-BERSIH', f)).toHaveLength(1))
  it('empty query returns nothing', () => expect(rank(items, '  ', f)).toEqual([]))
})
