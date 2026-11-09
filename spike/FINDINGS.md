# PriceCatcher data spike: findings

**Question:** can KPDN PriceCatcher support "is RM X a fair price for item X in district Y"?
**Data:** `pricecatcher_2026-09/10/11.parquet`, `lookup_item.parquet` and `lookup_premise.parquet` from `storage.data.gov.my`. The URLs come from the DOSM catalogue pages.
**Method:** DuckDB SQL over the Parquet files in place (`spike/queries.sql`, run with `.venv/bin/python spike/run.py`).
**Analysis month:** Oct 2026, the latest complete file. Nov 2026 holds only 1–8 Nov (one survey Monday).

## Verdict: **GO, with scope limits**

The data supports "fair price for item X in district Y" for **urban and semi-urban districts**:

- 93 of 165 districts have 100+ items each priced at 5 or more premises.
- Items are specific product + brand + unit codes, so prices are directly comparable.
- Duplicates and nulls are zero, and outliers are rare.

The product has to:

- tell users when coverage is too thin;
- treat price-controlled items differently;
- show the premise type, because it moves the price as much as the district does.

## 1. Freshness
| file | first date | last date | days | rows |
|---|---|---|---|---|
| 2026-09 | 09-01 | 09-29 | 28 | 1,742,320 |
| 2026-10 | 10-10 | 10-31 | 22 | 1,359,706 |
| 2026-11 | 11-01 | **11-08** | 8 | 590,381 |

- The latest data point is **2026-11-08**, one day before this spike, so the feed is effectively daily.
- **The published data has a 10-day hole from 30 Sep to 9 Oct.**
- Collection is weekly-plus-daily. Mondays carry about 198k rows and other days about 40k. That fits a weekly survey of all premises plus a daily core panel. **One day is not a usable snapshot. Use a monthly window or a rolling 4 weeks.**

## 2. Scale (Oct 2026)
| metric | value |
|---|---|
| rows | 1,359,706 |
| items priced | 339 (of 796 in the lookup) |
| premises reporting | 2,141 (of 3,931 in the lookup) |
| districts | 165 across 16 states |

Districts are keyed by (state, district) because district names can repeat across states.

## 3. Item standardisation: **yes, mostly**
Each `item_code` is a specific product + unit, often with a brand:

| code | item | unit | category |
|---|---|---|---|
| 1 | AYAM BERSIH - STANDARD | 1kg | BARANGAN SEGAR / AYAM |
| 2 | AYAM BERSIH - SUPER | 1kg | BARANGAN SEGAR / AYAM |
| 129 | BAWANG BESAR KUNING/HOLLAND | 1kg | BARANGAN KERING / BAWANG |
| 131 | BAWANG KECIL MERAH ROSE IMPORT (INDIA) | 1kg | BARANGAN KERING / BAWANG |
| 154 | SERBUK KUNYIT (TIDAK BERBUNGKUS) | 100 g | REMPAH RATUS |
| 155 | SERBUK CILI (TIDAK BERBUNGKUS) | 100 g | REMPAH RATUS |
| 1017 | FISHERMAN'S FRIEND ORIGINAL | 25 g | UBAT-UBATAN |
| 1019 | MINYAK ANGIN CAP KAPAK | 3 ml | UBAT-UBATAN |
| 1157 | NASI PUTIH KOSONG | sepinggan | MAKANAN SIAP MASAK / NASI |
| 1158 | NASI AYAM | sepinggan | MAKANAN SIAP MASAK / NASI |

Caveats:

- **The same product name can map to several codes with different pack sizes.** For example, KICAP TAMIN comes as 330 ml and 350ml, and MACKEREL CAP AYAM as 425 g and 155 g. Search has to show the unit next to the name.
- **A few codes cover several sizes**, e.g. diapers with unit `'M58, L48, XL42'`. Those prices are *not* comparable, so exclude them.
- Unit strings are free text (`1kg`, `250 g`, `350ml`, `sepinggan`). They work as display labels. Don't parse them for per-kg maths in v1.
- The names and categories are in Malay, so the app needs a search/alias layer.

## 4. Coverage: items priced at ≥5 premises, per district (Oct)
- **Petaling (Selangor): 257 items with ≥5 premises**, out of 284 priced, from 41 premises. That ranks **#3 of 165**, behind Kinta (275) and Johor Bahru (272).
- **Petaling Jaya** appears as a **separate district label**: 237 items, 20 premises. In the lookup, "Petaling" covers Shah Alam and Subang, while PJ city premises are filed under "Petaling Jaya". Users will expect PJ to be part of Petaling, so the app should map the labels to what users expect.
- Summary across all 165 districts:
  - 93 have ≥100 qualifying items;
  - 36 have 1–99;
  - **36 have zero**. These are mostly rural Sabah and Sarawak, plus Kuala Langat, Tampin, Rembau and Labuan. They have items priced, but each item is seen at only 1–4 premises.
  - The median district has 111 qualifying items.

## 5. Premise types
The lookup lists 12 types, but **only 5 reported prices in October**: Pasar Raya / Supermarket (678 premises), Pasar Mini (660), Kedai Runcit (349), Pasar Basah (305) and Hypermarket (149). Restaurant and foodcourt premises (and the cooked-food items) were not priced that month.

Median national price by type (RM):

| item | Hyper | Supermarket | Pasar Mini | Kedai Runcit | Pasar Basah |
|---|---|---|---|---|---|
| Ayam standard 1kg | 8.29 | 8.29 | 9.20 | 9.80 | 10.00 |
| Bawang besar 1kg | 3.99 | 3.90 | 4.00 | 4.90 | 5.00 |
| Maggi kari 5×79g | 4.93 | 4.99 | 5.20 | 5.50 | 5.50 |
| Santan Kara 200ml | 3.60 | 3.75 | 3.90 | 4.00 | 4.10 |
| Gula putih 1kg | 2.85 | 2.85 | 2.85 | 2.85 | 2.85 |

- Sundry shops and wet markets cost **15–25% more** than hypermarkets for the same item. Show "fair for this type of shop" as well as overall.
- **Sugar is identical everywhere** because it is a price-controlled item. For controlled goods, "fair" means "at or below the gazetted price", not "inside the distribution".

## 6. Worked example: Ayam Bersih Standard 1kg, Petaling, Oct 2026
Each premise is first reduced to its own monthly median, so one premise counts once.

| n premises | min | p25 | median | p75 | max |
|---|---|---|---|---|---|
| 29 | 7.99 | 8.59 | 8.99 | 9.90 | 11.00 |

The 3 cheapest premises:

1. MYDIN MART SEKSYEN 18 (Supermarket): RM 7.99
2. TESCO SEKSYEN 13 (Hypermarket): RM 8.19
3. GIANT KEMUNING UTAMA (Hypermarket): RM 8.29

All three are in Shah Alam. Product framing: "RM 9.50 is above the median but within the normal range (≤ p75)."

Store names can be out of date: the lookup still lists "TESCO", which has since rebranded to Lotus's. Store names need a freshness caveat.

## 7. Data quality (Oct)
| check | result |
|---|---|
| nulls in date/premise/item/price | 0 |
| price ≤ 0 | 0 |
| exact duplicate rows | 0 |
| same (date, premise, item) with conflicting prices | 0 |
| rows pointing at the `-1` unknown sentinel | 0 |
| **rows whose item_code is missing from lookup_item** | **19,798 (1.5%), across 14 codes (2023, 2053–2096…), some priced at 770 premises** |
| premise prices ≥10× item median | 0 |
| premise prices ≤1/10 item median | 7 (e.g. bawang RM 0.02, Lactogen RM 0.35: typos or unit errors) |
| beyond 3× either way | 95 of 242,935 (0.04%) |

Lookup hygiene problems:

- `premise_type` has a trailing-space variant: `'Pasar Basah '` (338 rows) vs `'Pasar Basah'` (22). The views fix it with `trim()`.

Outliers are rare and low-side. Medians and percentiles already resist them. Add a ratio filter (for example, drop anything outside 0.2× to 5× the item median) before computing min/max, because those are not robust.

## Biggest risk
**The answer depends on a small, uneven sample per district.**

- A "district median" comes from somewhere between 5 and a few dozen premises, and the premise-type mix varies by district.
- Wet markets and sundry shops cost 15–25% more than hypermarkets. So a district that is mostly hypermarkets will make a fair kedai runcit price look like a rip-off.
- 36 districts can't produce a range at all.

**Mitigations:**

1. Always show n (the number of premises).
2. Refuse to answer, or fall back to state level, below 5 premises.
3. Offer a filter by premise type.
4. Pool 4 weeks of data.

**Runner-up risk: feed reliability.** The source has a 10-day gap (30 Sep – 9 Oct), and 1.5% of prices reference items missing from the lookup. Ingestion needs to detect gaps and must inner-join on the lookup.

## Addendum (Phase 1.1): Rawang
**Question:** did Rawang's premises move under another district (likely Gombak) around Sep 2026?
**Answer: no.** Queries are in `spike/rawang.sql`, run over 25 months (2024-11-01 .. 2026-11-08).

- 8 premises mention Rawang by name or address: 6 under district `Rawang` and 2 under `Hulu Selangor`. They include Tesco and NSK hypermarkets, Mydin and Pasar Besar Moden Rawang. **None reported a single price in those 25 months.**
- **No Gombak premise has a Rawang address.**
- Searching by Rawang postcode (480xx), under any name, finds the same 7 premises, all with zero rows.
- So there was no handover to another district to follow. Rawang has been absent from the price survey for at least two years.
- `towns.json` therefore has no "rawang" entry. Mapping it to Gombak would be a geographic choice, because Rawang town is administratively in Gombak district, but it isn't supported by the data.
