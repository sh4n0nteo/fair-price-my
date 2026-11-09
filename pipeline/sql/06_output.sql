-- Shape the output: one row per district holding a nested list of items -> groups.
-- Structs and lists come back to Python as dicts and lists, so export.py only has to json.dump.
-- Items are nested (item fields once, then its groups) to keep files small.
CREATE OR REPLACE TABLE out_districts AS
WITH g AS (
    SELECT g.*, c.controlled_price AS c_price
    FROM groups g LEFT JOIN controlled c USING (item_code)
),
per_item AS (
    SELECT g.state, g.district, g.item_code,
           g.c_price IS NOT NULL AS controlled, g.c_price AS controlled_price,
           list({
               'premise_type':   g.premise_type,          -- NULL = all premise types
               'n_premises':     g.n_premises,
               'n_above_controlled': g.n_above_controlled,   -- controlled items only: count, no names
               'fallback_level': g.fallback_level,
               'min':    round(g.min, 2),
               -- Controlled items: percentiles are meaningless (everyone charges the same).
               'p25':    CASE WHEN c_price IS NULL THEN round(g.p25, 2) END,
               'median': CASE WHEN c_price IS NULL THEN round(g.median, 2) END,
               'p75':    CASE WHEN c_price IS NULL THEN round(g.p75, 2) END,
               'max':    round(g.max, 2),
               'cheapest': list_transform(g.cheapest, lambda x: {'premise_code': x.premise_code, 'price': round(x.price, 2), 'date_seen': x.date_seen})
           } ORDER BY g.premise_type NULLS FIRST) AS groups
    FROM g
    GROUP BY ALL
),
-- Premises referenced by any `cheapest` list, stored once per file and keyed by premise_code.
-- Repeating names inline made up over half of each file (spike: johor-bahru hit 530 KB).
referenced AS (
    SELECT DISTINCT r.state, r.district, r.premise_code
    FROM (SELECT state, district, unnest(cheapest, recursive := true) FROM groups) r
),
premise_maps AS (
    SELECT r.state, r.district,
           map_from_entries(list({'k': r.premise_code,
                                  'v': {'name': p.premise, 'type': p.premise_type, 'address': p.address}}
                                 ORDER BY r.premise_code)) AS premises
    FROM referenced r JOIN premises p USING (premise_code)
    GROUP BY ALL
)
SELECT d.slug, d.state, d.district,
       list({
           'item_code': p.item_code, 'name_ms': i.name_ms, 'name_en': i.name_en,
           'unit': i.unit, 'category': i.category,
           'controlled': p.controlled, 'controlled_price': p.controlled_price,
           'groups': p.groups
       } ORDER BY p.item_code) AS items,
       any_value(m.premises) AS premises
FROM per_item p
JOIN scope_districts d USING (state, district)
JOIN items i USING (item_code)
JOIN premise_maps m USING (state, district)
GROUP BY ALL;

CREATE OR REPLACE TABLE run_summary AS
SELECT (SELECT max(date) FROM raw_window) - getvariable('window_days') + 1 AS window_start,
       (SELECT max(date) FROM raw_window)                                  AS window_end,
       (SELECT count(*) FROM raw_window)                                   AS rows_in,
       (SELECT count(*) FROM rows_tagged WHERE drop_reason IS NULL)        AS rows_kept,
       (SELECT count(DISTINCT item_code) FROM rows_tagged WHERE drop_reason = 'unknown_item') AS unknown_item_codes,
       (SELECT count(*) FROM latest)                                       AS premise_item_prices,
       (SELECT count(*) FROM groups)                                       AS groups_out;

-- In scope but no file: the district's premises reported nothing in the window.
CREATE OR REPLACE TABLE scope_without_data AS
SELECT state, district FROM scope_districts
WHERE slug NOT IN (SELECT slug FROM out_districts) ORDER BY ALL;

CREATE OR REPLACE TABLE controlled_out AS
SELECT c.item_code, i.name_ms, i.name_en, i.unit, c.controlled_price,
       u.modal_price AS market_modal_price, u.n_premises,
       round(u.share_at_modal, 3) AS share_at_modal
FROM controlled c JOIN items i USING (item_code) LEFT JOIN uniformity u USING (item_code)
ORDER BY c.item_code;

CREATE OR REPLACE TABLE controlled_warnings_out AS
SELECT w.item_code, i.name_ms, w.warning, w.detail
FROM controlled_warnings w JOIN items i USING (item_code);
