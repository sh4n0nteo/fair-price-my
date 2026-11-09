import { track } from '@vercel/analytics/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { District, Item, Manifest, ShopTypeCode, Town } from './data'
import { aliasFromUrl, fmtDate, loadDistrict, loadManifest, loadTowns, SHOP_TYPES, shopTypeByCode, titleCase } from './data'
import { Picker } from './Picker'
import { Result } from './Result'
import { rank } from './search'
import { checkPrice, parsePrice } from './verdict'

const STALE_DAYS = 14

// ---- URL state: ?d=district&t=type&i=item_code&p=price, so a check is a shareable link ----
function readUrl() {
  const q = new URLSearchParams(location.search)
  const t = q.get('t')
  const i = Number(q.get('i'))
  return {
    d: q.get('d'),
    t: shopTypeByCode(t) ? (t as ShopTypeCode) : null,
    i: Number.isInteger(i) && i > 0 ? i : null,
    p: q.get('p') ?? '',
    town: q.get('town'),
  }
}

function writeUrl(s: { d: string | null; town: string | null; t: ShopTypeCode | null; i: number | null; p: number | null }) {
  const q = new URLSearchParams()
  if (s.d) q.set('d', s.d)
  if (s.town) q.set('town', s.town) // alias towns only, so a shared link keeps the alias label
  if (s.t) q.set('t', s.t)
  if (s.i) q.set('i', String(s.i))
  if (s.p !== null) q.set('p', s.p.toFixed(2))
  const url = q.size ? `?${q}` : location.pathname
  // replaceState, not pushState: typing a price shouldn't fill the back button with every keystroke.
  history.replaceState(null, '', url)
}

type TownChoice = { name: string; town: Town }

export function App() {
  const initial = useMemo(readUrl, [])
  const [manifest, setManifest] = useState<Manifest | null>(null)
  const [towns, setTowns] = useState<Record<string, Town> | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [slug, setSlug] = useState<string | null>(initial.d)
  const [aliasTown, setAliasTown] = useState<string | null>(null) // set only when picked via an alias
  const [shopType, setShopType] = useState<ShopTypeCode | null>(initial.t) // null = "Not sure"
  const [itemCode, setItemCode] = useState<number | null>(initial.i)
  const [priceText, setPriceText] = useState(initial.p)

  const [district, setDistrict] = useState<District | null>(null)
  const [districtError, setDistrictError] = useState<string | null>(null)
  const [shareStatus, setShareStatus] = useState<string | null>(null)

  // Start-up data: towns.json + manifest.json only (~20 KB). District files load on demand.
  useEffect(() => {
    Promise.all([loadManifest(), loadTowns()])
      .then(([m, t]) => {
        setManifest(m)
        setTowns(t)
      })
      .catch((e: Error) => setLoadError(e.message))
  }, [])

  // A shared link may name a district that's no longer in scope: drop it (and its item) rather than 404.
  const slugValid = !!manifest && !!slug && manifest.districts.some((d) => d.slug === slug)
  useEffect(() => {
    if (manifest && slug && !slugValid) {
      setSlug(null)
      setItemCode(null)
    }
  }, [manifest, slug, slugValid])

  // Fetch only districts the manifest knows: an unknown slug would hit the host's HTML fallback.
  useEffect(() => {
    if (!slug || !slugValid) return setDistrict(null)
    let current = true // ignore a slow response for a district the user has already left
    setDistrictError(null)
    loadDistrict(slug)
      .then((d) => current && setDistrict(d))
      .catch((e: Error) => current && setDistrictError(e.message))
    return () => {
      current = false
    }
  }, [slug, slugValid])

  const loadedDistrict = district && district.slug === slug ? district : null
  const item = loadedDistrict?.items.find((it) => it.item_code === itemCode) ?? null
  const price = parsePrice(priceText)
  const priceInvalid = priceText.trim() !== '' && price === null
  const shopTypeValue = shopTypeByCode(shopType)?.value ?? null

  // An item code from a link that this district doesn't price: clear it.
  useEffect(() => {
    if (loadedDistrict && itemCode && !item) setItemCode(null)
  }, [loadedDistrict, itemCode, item])

  // ?town= from a shared link: restore the alias label once towns.json is in.
  const townApplied = useRef(false)
  useEffect(() => {
    if (!towns || townApplied.current) return
    townApplied.current = true
    const a = aliasFromUrl(towns, initial.town, initial.d)
    if (a) {
      setSlug(a.slug)
      setAliasTown(a.town)
    }
  }, [towns, initial])

  useEffect(
    () => writeUrl({ d: slug, town: aliasTown, t: shopType, i: itemCode, p: price }),
    [slug, aliasTown, shopType, itemCode, price],
  )

  const check =
    item && loadedDistrict
      ? checkPrice({ item, shopType: shopTypeValue, price, district: loadedDistrict.district, state: loadedDistrict.state })
      : null

  // Analytics: one price_checked per distinct check, once the user has stopped typing.
  const lastTracked = useRef<string | null>(null)
  const bandForAnalytics = check?.kind === 'controlled' ? 'controlled' : check?.band ?? null
  useEffect(() => {
    if (!slug || !itemCode || price === null || !bandForAnalytics) return
    const key = `${slug}|${itemCode}|${shopType}|${price}`
    const timer = setTimeout(() => {
      if (lastTracked.current === key) return
      lastTracked.current = key
      track('price_checked', { district: slug, item: itemCode, band: bandForAnalytics })
    }, 1500)
    return () => clearTimeout(timer)
  }, [slug, itemCode, shopType, price, bandForAnalytics])

  const districtMeta = (s: string) => manifest?.districts.find((d) => d.slug === s)

  const townEntries = useMemo<TownChoice[]>(
    () => (towns ? Object.entries(towns).map(([name, town]) => ({ name, town })) : []),
    [towns],
  )

  // Before typing an item: the most widely sold items here, so common checks are one tap.
  const widelySold = useMemo(() => {
    if (!loadedDistrict) return []
    const n = (it: Item) => it.groups.find((g) => g.premise_type === null)?.n_premises ?? 0
    return [...loadedDistrict.items].sort((a, b) => n(b) - n(a)).slice(0, 6)
  }, [loadedDistrict])

  async function share() {
    track('share_clicked')
    const url = location.href
    const title = item ? `Is this a fair price? ${item.name_en} (${item.unit})` : 'Is this a fair price?'
    if (navigator.share) {
      try {
        await navigator.share({ title, url })
        return
      } catch (e) {
        if ((e as Error).name === 'AbortError') return // user closed the share sheet
      }
    }
    try {
      await navigator.clipboard.writeText(url)
      setShareStatus('Link copied')
    } catch {
      setShareStatus(`Copy this link: ${url}`)
    }
  }

  const daysOld = manifest ? Math.floor((Date.now() - Date.parse(manifest.window.end + 'T00:00:00Z')) / 86_400_000) : 0
  const meta = slug ? districtMeta(slug) : undefined

  return (
    <div className="page">
      <header className="masthead">
        <p className="wordmark">
          <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M3 5h14l12 12-12 12L3 17z" fill="var(--tag)" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" /><circle cx="10" cy="12" r="2.5" fill="currentColor" /></svg>
          Harga Patut
        </p>
        <h1>Is this a fair price?</h1>
        <p className="lede">Check a shelf price against what shops near you charge.</p>
        {manifest && (
          <p className={`freshness${daysOld > STALE_DAYS ? ' freshness--stale' : ''}`} role={daysOld > STALE_DAYS ? 'alert' : undefined}>
            {daysOld > STALE_DAYS
              ? `Prices last updated ${fmtDate(manifest.window.end)}, over ${STALE_DAYS} days ago. Shelf prices may have changed.`
              : `Prices updated ${fmtDate(manifest.window.end)}`}
          </p>
        )}
      </header>

      <main className="steps">
        {loadError && (
          <p className="note note--alert" role="alert">Couldn't load price data ({loadError}). Check your connection and reload.</p>
        )}

        <section className="step" aria-labelledby="step-where">
          <h2 id="step-where" className="step-title"><span className="step-n">1</span> Where are you?</h2>
          {slug && meta ? (
            <div className="chosen">
              <div>
                <p className="chosen-main">{meta.district}</p>
                <p className="chosen-sub">{meta.state}</p>
                {aliasTown && (
                  <p className="alias-note">Showing {meta.district} district, which includes {titleCase(aliasTown)}.</p>
                )}
              </div>
              <button type="button" className="link-btn" onClick={() => { setSlug(null); setAliasTown(null); setItemCode(null) }}>
                Change
              </button>
            </div>
          ) : (
            <Picker<TownChoice>
              label="Town or area"
              placeholder="e.g. Subang Jaya, Bangsar, Skudai"
              disabled={!towns}
              search={(q) => rank(townEntries, q, (t) => [t.name])}
              keyOf={(t) => t.name}
              render={(t) => {
                const m = districtMeta(t.town.slug)
                const isDistrict = m && m.district.toLowerCase() === t.name
                return (
                  <>
                    <span className="choice-main">{titleCase(t.name)}</span>
                    <span className="choice-sub">{isDistrict ? `District in ${m.state}` : `${m?.district ?? t.town.slug} district, ${m?.state ?? ''}`}</span>
                  </>
                )
              }}
              onPick={(t) => { setSlug(t.town.slug); setAliasTown(t.town.alias ? t.name : null); setItemCode(null) }}
              emptyText="No match in the areas we cover yet: Klang Valley, Penang and Johor Bahru."
            />
          )}
          {districtError && <p className="note note--alert" role="alert">Couldn't load prices for this area ({districtError}). Try again.</p>}
        </section>

        <section className="step" aria-labelledby="step-shop">
          <h2 id="step-shop" className="step-title"><span className="step-n">2</span> Where are you shopping?</h2>
          <div className="segmented" role="radiogroup" aria-labelledby="step-shop">
            {[{ code: null, label: 'Not sure', ms: '' }, ...SHOP_TYPES].map((s) => (
              <label key={s.code ?? 'any'} className="seg">
                <input type="radio" name="shop" checked={shopType === s.code} onChange={() => setShopType(s.code)} />
                <span>
                  {s.label}
                  {s.ms && <small>{s.ms}</small>}
                </span>
              </label>
            ))}
          </div>
        </section>

        <section className="step" aria-labelledby="step-item">
          <h2 id="step-item" className="step-title"><span className="step-n">3</span> What are you buying?</h2>
          {!slug ? (
            <p className="field-hint">Choose a town first.</p>
          ) : !loadedDistrict ? (
            !districtError && <p className="field-hint" role="status">Loading prices for {meta?.district}…</p>
          ) : item ? (
            <div className="chosen">
              <div>
                <p className="chosen-main">{item.name_en} <span className="unit">{item.unit}</span></p>
                <p className="chosen-sub" lang="ms">{item.name_ms}</p>
              </div>
              <button type="button" className="link-btn" onClick={() => setItemCode(null)}>Change</button>
            </div>
          ) : (
            <Picker<Item>
              label="Item, in English or Malay"
              placeholder="e.g. chicken, telur, gula"
              search={(q) => rank(loadedDistrict.items, q, (it) => [it.name_en, it.name_ms])}
              suggestions={{ heading: `Widely sold in ${loadedDistrict.district}`, items: widelySold }}
              keyOf={(it) => String(it.item_code)}
              render={(it) => (
                <>
                  <span className="choice-main">{it.name_en} <span className="unit">{it.unit}</span></span>
                  <span className="choice-sub" lang="ms">{it.name_ms}</span>
                </>
              )}
              onPick={(it) => setItemCode(it.item_code)}
              emptyText={`No match among the ${loadedDistrict.items.length} items priced in ${loadedDistrict.district}.`}
            />
          )}
        </section>

        <section className="step" aria-labelledby="step-price">
          <h2 id="step-price" className="step-title"><span className="step-n">4</span> Price you see <span className="optional">(optional)</span></h2>
          <div className="price-field">
            <span className="price-prefix" aria-hidden="true">RM</span>
            <input
              className="text-input price-input"
              aria-labelledby="step-price"
              aria-describedby={priceInvalid ? 'price-error' : undefined}
              aria-invalid={priceInvalid}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              value={priceText}
              onChange={(e) => setPriceText(e.target.value)}
            />
          </div>
          {priceInvalid && <p id="price-error" className="field-error">Enter an amount like 8.50</p>}
        </section>

        {check && item && loadedDistrict && (
          <>
            <Result check={check} item={item} district={loadedDistrict} price={price} notSure={shopType === null} />
            <div className="share">
              <button type="button" className="btn" onClick={share}>Share this check</button>
              {shareStatus && <p className="share-status" role="status">{shareStatus}</p>}
            </div>
          </>
        )}
      </main>

      <footer className="footer">
        <p>
          Data: <a href="https://data.gov.my/data-catalogue/pricecatcher">KPDN PriceCatcher via data.gov.my</a>,{' '}
          <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>.
        </p>
        <p>Prices are indicative: what surveyed shops charged recently, not a guarantee of today's shelf price.</p>
      </footer>
    </div>
  )
}
