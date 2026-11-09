import { afterEach, describe, expect, it, vi } from 'vitest'
import { track } from './analytics'

afterEach(() => vi.unstubAllGlobals())

describe('track', () => {
  it('is a no-op when window.umami is undefined (blocked or not loaded)', () => {
    vi.stubGlobal('window', {})
    expect(() => track('price_checked', { district: 'petaling', item: 1, band: 'normal' })).not.toThrow()
    expect(track('share_clicked')).toBeUndefined()
  })

  it('is a no-op when there is no window at all', () => {
    vi.stubGlobal('window', undefined)
    expect(() => track('share_clicked')).not.toThrow()
  })

  it('never throws when the tracker itself throws', () => {
    vi.stubGlobal('window', { umami: { track: () => { throw new Error('blocked') } } })
    expect(() => track('share_clicked')).not.toThrow()
  })

  it('forwards the event name and props unchanged when Umami is present', () => {
    const umamiTrack = vi.fn()
    vi.stubGlobal('window', { umami: { track: umamiTrack } })
    track('price_checked', { district: 'petaling', item: 1, band: 'high' })
    expect(umamiTrack).toHaveBeenCalledWith('price_checked', { district: 'petaling', item: 1, band: 'high' })
  })
})
