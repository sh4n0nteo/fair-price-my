import type { District, Group, Item } from './data'
import { fmtDate, fmtShortDate, rm, shopTypeByValue } from './data'
import type { Band, Check, Note } from './verdict'

// KPDN consumer complaints portal, checked 2026-11-09: https://eaduan.kpdn.gov.my/
// ("Gerbang Aduan Kepenggunaan Dan Integriti KPDN"; the page lists hotline 1800-886-800).
const KPDN_COMPLAINTS = 'https://eaduan.kpdn.gov.my/'
const KPDN_HOTLINE = '1-800-886-800'

const BANDS: Record<Band, { title: string; line: (place: string) => string }> = {
  below_min: { title: 'Lower than every shop we track', line: () => 'Check the pack size matches.' },
  good: { title: 'Good price', line: () => 'Below what most shops here charge.' },
  normal: { title: 'Normal', line: () => 'In the range most shops here charge.' },
  high: { title: 'On the high side', line: () => 'Above what most shops here charge.' },
  above_max: { title: 'Higher than every shop we track', line: (p) => `No shop we track in ${p} charges this much.` },
}

function BandIcon({ band }: { band: Band }) {
  const paths: Record<Band, string> = {
    below_min: 'M12 7.5v.5m0 3.5v6M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 0 0 0-19Z', // info circle
    good: 'M12 4v13m0 0-6-6m6 6 6-6', // arrow down
    normal: 'M5 9h14M5 15h14', // equals
    high: 'M12 20V7m0 0-6 6m6-6 6 6', // arrow up
    above_max: 'M12 3 2 21h20L12 3Zm0 7v5m0 3v.5', // warning triangle
  }
  return (
    <svg className="band-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={paths[band]} fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function noteText(n: Note, district: string): string {
  const typeLabel = (v: string) => shopTypeByValue(v)?.plural ?? v
  switch (n.kind) {
    case 'type_absent':
      return `No ${typeLabel(n.type)} in ${district} price this item, so this compares all shop types.`
    case 'type_thin':
      return `Fewer than 5 ${typeLabel(n.type)} in ${district} price this item, so this compares all shop types in ${district}.`
    case 'state':
      return `Fewer than 5 shops in ${district} price this item, so this compares shops across ${n.state}.`
  }
}

/** Min..max ruler with the middle half (p25..p75) solid and the user's price as a hanging tag. */
function RangeBar({ g, price }: { g: Group; price: number | null }) {
  const lo = Math.min(g.min, price ?? g.min)
  const hi = Math.max(g.max, price ?? g.max)
  const span = hi - lo || 1
  const pos = (v: number) => `${(((v - lo) / span) * 100).toFixed(2)}%`
  const pricePct = price === null ? 0 : ((price - lo) / span) * 100
  const align = pricePct < 18 ? 'start' : pricePct > 82 ? 'end' : 'center'
  return (
    <div className="ruler" aria-hidden="true">
      {price !== null && (
        <div className={`ruler-tag ruler-tag--${align}`} style={{ left: pos(price) }}>
          <span>{rm(price)}</span>
        </div>
      )}
      <div className="ruler-track">
        <div className="ruler-span" style={{ left: pos(g.min), right: `calc(100% - ${pos(g.max)})` }} />
        <div className="ruler-mid" style={{ left: pos(g.p25!), right: `calc(100% - ${pos(g.p75!)})` }} />
        <div className="ruler-median" style={{ left: pos(g.median!) }} />
        {price !== null && <div className="ruler-pin" style={{ left: pos(price) }} />}
      </div>
      <div className="ruler-scale">
        <span style={{ left: pos(g.min) }} className="ruler-lab ruler-lab--min">{rm(g.min)}</span>
        <span style={{ left: pos(g.max) }} className="ruler-lab ruler-lab--max">{rm(g.max)}</span>
      </div>
    </div>
  )
}

function TypeMix({ mix, place }: { mix: Record<string, number>; place: string }) {
  const rows = Object.entries(mix).sort((a, b) => b[1] - a[1])
  const top = rows[0]?.[1] ?? 1
  return (
    <div className="mix">
      <h3 className="sub-heading">Shops behind this number in {place}</h3>
      <ul className="mix-list">
        {rows.map(([type, n]) => (
          <li key={type} className="mix-row">
            <span className="mix-label">{shopTypeByValue(type)?.label ?? type}</span>
            <span className="mix-bar" aria-hidden="true"><span style={{ width: `${(n / top) * 100}%` }} /></span>
            <span className="mix-n">{n}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function Result(props: {
  check: Check
  item: Item
  district: District
  price: number | null
  notSure: boolean
}) {
  const { check, item, district, price } = props

  if (check.kind === 'controlled') {
    return (
      <section className="result result--controlled" aria-live="polite" aria-label="Result">
        <p className="controlled-price">
          Controlled price: <strong className="num">{rm(check.controlledPrice)}</strong>
        </p>
        <p className="controlled-what">The maximum KPDN allows any shop to charge for {item.name_en.toLowerCase()} ({item.unit}).</p>
        {check.priceAbove === true && price !== null && (
          <p className="note note--alert">{rm(price)} is more than the controlled price.</p>
        )}
        <div className="report">
          <p>Charged more?</p>
          <a className="btn-outline" href={KPDN_COMPLAINTS} target="_blank" rel="noopener noreferrer">Report it to KPDN</a>
          <a className="btn-outline" href={`tel:${KPDN_HOTLINE.replaceAll('-', '')}`}>Call KPDN {KPDN_HOTLINE}</a>
        </div>
      </section>
    )
  }

  const { group: g, band, place, notes, hyperMedian } = check
  const typeLabel = g.premise_type && !g.fallback_level ? shopTypeByValue(g.premise_type)?.plural : null
  const shops = `${g.n_premises} ${typeLabel ?? (g.n_premises === 1 ? 'shop' : 'shops')}`

  return (
    <section className={`result${band ? ` result--${band}` : ''}`} aria-live="polite" aria-label="Result">
      {band && price !== null ? (
        <div className="verdict">
          <BandIcon band={band} />
          <div>
            <p className="verdict-title">{BANDS[band].title}</p>
            <p className="verdict-line">
              <span className="num">{rm(price)}</span> for {item.unit}. {BANDS[band].line(place)}
            </p>
          </div>
        </div>
      ) : (
        <p className="verdict-pending">Enter the price you see to get a verdict.</p>
      )}

      <RangeBar g={g} price={price} />
      <p className="range-text">
        Most shops charge <strong className="num">{rm(g.p25!)} – {rm(g.p75!)}</strong>. Middle price{' '}
        <span className="num">{rm(g.median!)}</span>, lowest <span className="num">{rm(g.min)}</span>, highest{' '}
        <span className="num">{rm(g.max)}</span>.
      </p>
      <p className="context">
        Based on {shops} in {place} · prices seen {fmtShortDate(district.window.start)} – {fmtDate(district.window.end)}
      </p>

      {notes.map((n) => (
        <p key={n.kind} className="note" role="note">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 21h20L12 3Zm0 7v5m0 3v.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span>{noteText(n, district.district)}</span>
        </p>
      ))}

      {props.notSure && g.type_mix && <TypeMix mix={g.type_mix} place={place} />}

      {hyperMedian !== null && (
        <p className="hyper">
          Hypermarkets in {district.district} typically charge <strong className="num">{rm(hyperMedian)}</strong>.
        </p>
      )}

      {g.cheapest.length > 0 && (
        <div className="cheapest">
          <h3 className="sub-heading">Cheapest shops{g.fallback_level === 'state' ? ` in ${place}` : ''}</h3>
          <ol className="shop-list">
            {g.cheapest.map((c) => {
              const p = district.premises[String(c.premise_code)]
              return (
                <li key={c.premise_code} className="shop">
                  <div className="shop-main">
                    <p className="shop-name">{p?.name ?? `Shop ${c.premise_code}`}</p>
                    {p && <p className="shop-addr">{p.address}</p>}
                  </div>
                  <div className="shop-price">
                    <p className="num">{rm(c.price)}</p>
                    <p className="shop-seen">seen {fmtShortDate(c.date_seen)}</p>
                  </div>
                </li>
              )
            })}
          </ol>
        </div>
      )}
    </section>
  )
}
