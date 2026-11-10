# fair-price-my

"Is this a fair grocery price?" for Malaysia, built on KPDN PriceCatcher open data (data.gov.my).

## Data pipeline

### What it does
`python -m pipeline` turns the raw PriceCatcher Parquet files into static JSON a frontend can
load directly. It has three steps:

- **download.py** finds the file URLs on the DOSM catalogue pages. It fetches only what changed (HTTP `If-Modified-Since`) into `data/raw/`, which git ignores.
- **transform.py** runs `pipeline/sql/*.sql` in order against an in-memory DuckDB.
  1. inputs + window
  2. drop bad rows
  3. latest price per premise
  4. controlled items (from config) + uniformity cross-check
  5. comparison groups
  6. output shape
  7. towns
- **export.py** writes `data/out/` (committed):
  - `districts/<slug>.json`: per item, its comparison groups with `n_premises`, `fallback_level`, min/p25/median/p75/max and the 3 cheapest premises.
  - `towns.json`: area name (lowercase) → district slug, e.g. `"subang jaya": "petaling"`.
  - `manifest.json`: build time, window, source files, rows in/kept/dropped by reason, controlled items (official vs observed price) and any warnings, districts covered, in-scope districts with no data, and a per-build `trend` of unknown item codes.

District file format notes:

- `premise_type: null` is the all-types group.
- `cheapest` entries are `[premise_code, price, date_seen]`, in the field order given by `cheapest_fields`.
- Premise names, types and addresses are listed once per file under `premises`, keyed by `premise_code`.

### Run it
```sh
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m pipeline        # download -> transform -> export (~2 s once files are cached)
.venv/bin/python -m pytest tests    # sanity checks on data/out/
```
Settings live in `pipeline/config.toml`: scope, thresholds, excluded items and the KPDN controlled-price list.
Translations are in `data/item_names_en.csv`. Edit `name_en` there, and set `needs_review` to `false` once you've checked a row. Rows with `out_of_scope=true` aren't shown anywhere yet, so skip them. The pipeline rewrites only that column.

### Decisions
| Decision | Why |
|---|---|
| Rolling 28 days ending at the latest date in the data | Collection is weekly (Mondays carry ~5x rows), so 28 days = 4 full survey rounds, always fresh, not tied to month boundaries. |
| Latest price per (premise, item), not median | The answer should reflect what a shop charges *now*; also makes each premise count once. |
| Group = district + premise type, fallback district → state below 5 premises | Shop type moves price 15–25% (wet market vs hypermarket); fall back rather than show a range built from 2 shops, and say so in `fallback_level`. |
| Drop prices < 0.25x or > 4x the item's national median | Catches typos and unit errors (onions at RM 0.02) without touching real regional spread. |
| Drop rows with item codes missing from the lookup | They can't be named or shown (~1.75% of rows); counted in `manifest.json` → `trend` per build so a fix upstream shows up. See `spike/unknown_codes.md`. |
| Exclude multi-size codes (listed in config) | One code priced across S/M/L/XL diapers isn't one product, so its range is meaningless. |
| Controlled items listed in config (KPDN official prices); skip percentiles, report `n_above_controlled` | A gazetted price is a legal fact, not a pattern to detect; for these, fair = at or below the fixed price, so the useful number is how many shops charge more. |
| Detection (≥97% of ≥100 premises at one price) kept as warnings only | Cross-checks the list both ways: catches a newly controlled item, a delisted one, or a wrong price in config. |
| Scope as a config list | Adding a district or state is a config edit, not a code change; typos fail the build. |
| English names in a reviewed CSV, Malay fallback | Lookup is Malay-only; a CSV is easy to hand-edit and diff, and a missing translation never blanks a name. |
| `out_of_scope` column recomputed each build | Only items that appear in some district file need review; coverage shifts, so a one-off mark would go stale. Other columns are written back untouched. |
| SQL in `.sql` files, config passed as DuckDB variables | SQL stays readable and runnable on its own; values are bound, never string-pasted into SQL. |
| Conditional GET instead of "skip if file exists" | The current month's file grows daily; an existence check would serve stale data forever. |
| Commit `data/out/` | The frontend can be a static site with no backend; diffs show how prices moved between builds. |

## Web app (`web/`)
A Vite + React + TypeScript static site. There's no backend: it reads the pipeline's JSON.

```sh
cd web && npm install
npm run dev      # copies ../data/out -> public/data, then starts Vite
npm test         # Vitest: verdict/band logic and search ranking
npm run build    # copies data, type-checks, builds to web/dist
```
Deploy on Vercel from the repo root. `vercel.json` builds `web/` and serves `web/dist`. Enable Web Analytics in the Vercel project settings. The Umami website ID is set in `web/index.html` (`data-website-id`).

| Decision | Why |
|---|---|
| `data/out/` copied into `public/data` at build time (git-ignored) | One copy of the data in git; the site always ships what the pipeline last built. |
| Start-up loads only `towns.json` + `manifest.json`; district files fetched on choice and cached as promises | ~25 KB to first interaction instead of ~1 MB; two quick taps share one request. |
| Verdict, band and fallback-note logic in `src/verdict.ts`, pure and unit-tested | That's where a bug would mislead someone; the UI only renders its output. |
| Band edges compared in whole sen; p25 and p75 count as "Normal" | Avoids float flips (8.5 vs 8.50000001); the edges belong to the middle band. |
| Results as an inline list of large buttons, not a dropdown | One-thumb friendly, never hidden behind the keyboard, plain list/button semantics. |
| URL kept in sync with `replaceState` | A check is a shareable link, and typing a price doesn't flood the back button. |
| Self-hosted Atkinson Hyperlegible (latin only) | Designed for low-vision legibility (glare in shops); self-hosting avoids sending visitors' IPs to Google Fonts. |
| Page views via Vercel Web Analytics; custom events via Umami Cloud | Vercel Hobby doesn't collect custom events. Both are cookieless; page URLs and event URLs are stripped of query strings, so only `price_checked` {district, item, band} and `share_clicked` leave the device. |
| All events go through `src/analytics.ts` | Call sites never import a vendor SDK: switching providers means editing one file, and that file guarantees a blocked tracker can't break the app. |
| Umami `data-domains="harga-patut.vercel.app"` | Only production visits are tracked, not localhost or Vercel preview deployments. |

## How it stays fresh
Two GitHub Actions workflows keep the site current without a server.

**`refresh.yml`: weekly data refresh.** It runs every Tuesday at 00:23 UTC (08:23 Malaysia time), or on demand from the Actions tab ("Run workflow"):

1. Rebuild the data: `python -m pipeline`, then `pytest`.
2. Check the new build against the last *committed* one using three gates (`pipeline/gates.py`). The run fails, and nothing is committed, if any of these is true. Each failure prints its reason:

   | Gate | Fails when | Why |
   |---|---|---|
   | Source stalled | the latest data date hasn't moved past the committed manifest's | Otherwise last week's prices would be re-published as new. |
   | Row drop | kept rows fell more than 30% (`gate_max_kept_drop` in `config.toml`) | A partial upload or schema change upstream. The normal weekly swing is about 10%. |
   | Missing district | a district that had a file and is still in scope has none | Shared links point at those files. Districts that never had data (Rawang) or were removed from scope are fine. |

3. Commit `data/out/` as `github-actions[bot]` with `data: weekly refresh (window <start> to <end>)` and push. This happens only if the gates pass and something besides the manifest timestamp changed. Vercel redeploys on the push.

Other details:

- The schedule is off the top of the hour because GitHub delays `:00` jobs under load. Tuesday gives Monday's big survey round a day to land.
- A concurrency group queues overlapping runs instead of letting them race on the push.
- If someone pushed in the meantime, the bot rebases its commit on top.
- The bot doesn't commit `data/item_names_en.csv`. Its `out_of_scope` column is recomputed whenever you run the pipeline locally.

**`ci.yml`: checks on every push and pull request.**

- The pipeline job runs `pytest` on the committed output.
- The web job runs `npm ci`, the type-check, Vitest, the build, and `npm run check:mobile` in headless Chrome. It uses `browser-actions/setup-chrome`, and the script adds `--no-sandbox` in CI because Ubuntu 24.04 blocks Chrome's sandbox.
- If the layout check fails, the screenshots are uploaded as the `mobile-check-screenshots` artifact on the run's page.
- Pushes made by the refresh bot don't trigger CI: GitHub doesn't start workflows from `GITHUB_TOKEN` pushes. The refresh runs `pytest` itself.
