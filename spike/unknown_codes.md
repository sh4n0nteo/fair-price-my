# Unknown item codes

The 14 `item_code`s below are priced in the current window (2026-10-12 .. 2026-11-08) but are
missing from `lookup_item.parquet`. The pipeline drops them: 32,887 rows, or 1.75% of the window.
The count is logged in `manifest.json` → `trend` on every build.

**Searched:** 25 monthly files, 2024-11-01 .. 2026-11-08 (queries: `spike/unknown_codes.sql`).
"First seen" means first seen *within that history*. A code first seen in Nov 2024 may be older.

## The 14 codes
Row counts and dates cover all 25 months. Premise types are the types that ever priced the code.

| code | rows | premises | first seen | last seen | median RM (p10–p90) | premise types |
|---|---:|---:|---|---|---|---|
| 2057 | 56,045 | 1,559 | 2024-11-24 | 2026-11-05 | 5.90 (4.99–7.20) | Hyper, Super, Pasar Mini, Kedai Runcit, Pasar Basah* |
| 2059 | 47,796 | 1,334 | 2024-11-24 | 2026-11-05 | 8.80 (7.49–9.50) | Hyper, Super, Pasar Mini, Kedai Runcit, Pasar Basah* |
| 2094 | 45,060 | 905 | 2025-07-21 | 2026-11-05 | 6.90 (5.69–7.60) | Hyper, Super, Pasar Mini, Kedai Runcit |
| 2053 | 43,730 | 1,057 | 2024-11-25 | 2026-11-05 | 11.50 (9.80–15.90) | Hyper, Super, Pasar Mini, Kedai Runcit |
| 2023 | 40,228 | 647 | 2024-11-04 | 2026-11-05 | 16.28 (14.78–18.60) | Hyper, Super, Pasar Mini, Kedai Runcit |
| 2089 | 38,421 | 840 | 2025-07-21 | 2026-11-05 | 9.85 (9.19–10.90) | Hyper, Super, Pasar Mini, Kedai Runcit |
| 2095 | 37,625 | 860 | 2025-07-21 | 2026-11-05 | 13.99 (12.60–15.95) | Hyper, Super, Pasar Mini, Kedai Runcit |
| 2090 | 33,685 | 815 | 2025-07-21 | 2026-11-05 | 5.70 (5.39–6.19) | Hyper, Super, Pasar Mini, Kedai Runcit |
| 2091 | 28,709 | 674 | 2025-07-21 | 2026-11-05 | 2.50 (2.29–3.00) | Hyper, Super, Pasar Mini, Kedai Runcit |
| 2092 | 24,903 | 627 | 2025-07-21 | 2026-11-05 | 5.70 (5.45–5.99) | Hyper, Super, Pasar Mini, Kedai Runcit |
| 2096 | 22,958 | 658 | 2025-07-21 | 2026-11-05 | 5.99 (5.50–6.90) | Hyper, Super, Pasar Mini, Kedai Runcit |
| 2093 | 19,889 | 482 | 2025-07-21 | 2026-11-05 | 6.25 (5.80–7.20) | Hyper, Super, Pasar Mini, Kedai Runcit |
| 2035 | 567 | 13 | 2024-11-04 | 2026-11-05 | 19.50 (18.10–20.30) | Hyper, Super, Pasar Mini |
| 2048 | 328 | 10 | 2025-06-16 | 2026-11-05 | 3.20 (2.99–3.40) | Hyper, Super, Pasar Mini |

\* 2057 and 2059 were priced at wet markets earlier in the history, but **0%** of their premises in the current window are wet markets.

## Categories: inferred, not confirmed
Nothing in the open data names these codes. Three signals point the same way:

1. **All 14 are packaged retail goods.** In the current window, 0% of their premises are wet
   markets (Pasar Basah), and 16–28% are hypermarkets (except 2035, sold at only 6 premises). Fresh produce in this dataset is
   dominated by wet markets.
2. **They were introduced in the same batches as known packaged codes.** Codes are assigned
   in batches, and each batch shares a first-seen date:
   - **2089–2096** all first appear on **2025-07-21**, the same day as known codes 2097–2105:
     Sustagen All-in-One, Drypers/Huggies diapers, Dettol/Lifebuoy bath soap, Fernleaf 1-3/4-6.
     This batch is **baby, health-drink and personal-care FMCG**.
   - **2053, 2057, 2059** first appear on **2024-11-24/25**, alongside 2056 (Axion dishwashing
     paste) and 2060 (Marigold HL milk). This batch is **household / dairy packaged goods**.
   - **2023** first appears on 2024-11-04, alongside 2022 (Buttercup spread) and 2025 (Everyday
     milk powder). This batch is **spreads / milk powder**.
3. **The same shops price them as a set.** 85–92% of the premises that price 2089 also price
   the other codes in the 2089–2096 block. They are surveyed as one shelf group.

Price levels are **not** good evidence on their own. For example, 2094 at RM 6.90 matches 1kg
bottled cooking oil, and 2091 at RM 2.50 matches polybag oil. But those match by coincidence:
2091's spread (RM 2.29–3.00) rules out the price-controlled polybag oil, which is 99.9% uniform
at RM 2.50.

**To confirm:** ask data.gov.my / KPDN which codes 2023, 2035, 2048, 2053, 2057, 2059 and
2089–2096 are, or check whether a newer `lookup_item` adds them. The pipeline will pick them up
automatically once they're in the lookup, and the trend will show the drop.

## Trend by month
| month | unknown rows | unknown codes | % of rows |
|---|---:|---:|---:|
| 2024-11 | 58,495 | 31 | 2.37 |
| 2025-01 | 68,175 | 32 | 2.56 |
| 2025-04 | 59,196 | 32 | 2.50 |
| 2025-07 | 50,088 | 34 | 2.16 |
| 2025-08 | 29,477 | 20 | 1.49 |
| 2025-09 | 23,885 | 14 | 1.45 |
| 2026-01 | 31,242 | 14 | 1.58 |
| 2026-04 | 24,001 | 14 | 1.34 |
| 2026-07 | 25,423 | 14 | 1.40 |
| 2026-09 | 26,191 | 14 | 1.50 |
| 2026-10 | 19,798 | 14 | 1.46 |
| 2026-11 (8 days) | 13,089 | 14 | 2.22 |

(Selected months. The full monthly table comes from `spike/unknown_codes.sql`.)

- In Aug 2025, about 20 older unknown codes (e.g. 2064, 2065, 2070, 2071) **stopped being
  priced**. They weren't added to the lookup.
- The current set of 14 has been **stable since Sep 2025**, at 1.3–1.7% of rows.
- Nov 2026 reads higher (2.22%) only because 8 days is mostly one Monday survey round.
