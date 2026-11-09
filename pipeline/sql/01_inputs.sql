-- Inputs: lookups, scope, and the raw price rows inside the rolling window.
-- Config arrives as DuckDB variables (getvariable), set by transform.py from config.toml.

-- Items, with English names from the hand-reviewed CSV. Empty name_en falls back to Malay.
CREATE OR REPLACE TABLE items AS
SELECT i.item_code,
       i.item AS name_ms,
       coalesce(nullif(trim(n.name_en), ''), i.item) AS name_en,
       i.unit,
       i.item_category AS category
FROM read_parquet(getvariable('item_file')) i
LEFT JOIN read_csv(getvariable('names_file'), header = true) n USING (item_code)
WHERE i.item_code > 0;   -- -1 is the lookup's 'unknown' sentinel row

-- trim(): the lookup has 'Pasar Basah ' and 'Pasar Basah' as separate types.
CREATE OR REPLACE TABLE premises AS
SELECT premise_code, trim(premise) AS premise, trim(premise_type) AS premise_type,
       state, district, address
FROM read_parquet(getvariable('premise_file'))
WHERE premise_code > 0;

-- Expand config scope entries to (state, district) rows. Empty `districts` = whole state.
CREATE OR REPLACE TABLE scope_districts AS
WITH cfg AS (SELECT unnest(getvariable('scope')) AS s)
SELECT DISTINCT p.state, p.district,
       trim(regexp_replace(lower(p.district), '[^a-z0-9]+', '-', 'g'), '-') AS slug
FROM premises p JOIN cfg
  ON p.state = cfg.s.state
 AND (len(cfg.s.districts) = 0 OR list_contains(cfg.s.districts, p.district));

-- Fail loudly on config typos: a scope entry that matches no premise would silently vanish.
WITH wanted AS (
    SELECT s.state, unnest(CASE WHEN len(s.districts) = 0 THEN [NULL] ELSE s.districts END) AS district
    FROM (SELECT unnest(getvariable('scope')) AS s)
)
SELECT CASE WHEN count(*) > 0
            THEN error('scope entries match no premises: ' || string_agg(state || ' / ' || coalesce(district, '*'), ', '))
       END
FROM wanted w
WHERE NOT EXISTS (SELECT 1 FROM scope_districts d
                  WHERE d.state = w.state AND (w.district IS NULL OR d.district = w.district));

-- Rolling window: the last `window_days` days ending at the newest date in the files.
-- date > end - 28 keeps exactly 28 calendar days (end inclusive).
CREATE OR REPLACE TABLE raw_window AS
WITH all_rows AS (SELECT * FROM read_parquet(getvariable('price_files')))
SELECT * FROM all_rows
WHERE date > (SELECT max(date) FROM all_rows) - getvariable('window_days');
