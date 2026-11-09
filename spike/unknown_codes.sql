-- Item codes that appear in price files but not in lookup_item. Feeds spike/unknown_codes.md.
-- Run from repo root after downloading history into data/raw/ (any number of monthly files).
CREATE OR REPLACE VIEW prices AS SELECT * FROM read_parquet('data/raw/pricecatcher_20*.parquet');
CREATE OR REPLACE VIEW premises AS
    SELECT premise_code, trim(premise_type) AS premise_type FROM 'data/raw/lookup_premise.parquet';
CREATE OR REPLACE VIEW unknown AS
    SELECT p.* FROM prices p ANTI JOIN 'data/raw/lookup_item.parquet' i USING (item_code);

-- ## Coverage of the history we searched
SELECT min(date) AS first_date, max(date) AS last_date, count(DISTINCT strftime(date, '%Y-%m')) AS months
FROM prices;

-- ## Per code: volume, dates, price level, where it's sold
SELECT u.item_code,
       count(*)                          AS n_rows,
       count(DISTINCT u.premise_code)    AS n_premises,
       min(u.date)                       AS first_seen,
       max(u.date)                       AS last_seen,
       round(median(u.price), 2)         AS median_price,
       round(quantile_cont(u.price, 0.1), 2) AS p10,
       round(quantile_cont(u.price, 0.9), 2) AS p90,
       string_agg(DISTINCT s.premise_type, ', ' ORDER BY s.premise_type) AS premise_types
FROM unknown u LEFT JOIN premises s USING (premise_code)
GROUP BY 1 ORDER BY n_rows DESC;

-- ## Rows per month (trend: is the problem growing or shrinking?)
SELECT strftime(date, '%Y-%m') AS month, count(*) AS unknown_rows,
       count(DISTINCT item_code) AS unknown_codes,
       round(100.0 * count(*) / any_value(t.total), 2) AS pct_of_rows
FROM unknown
JOIN (SELECT strftime(date, '%Y-%m') AS month, count(*) AS total FROM prices GROUP BY 1) t
  ON t.month = strftime(date, '%Y-%m')
GROUP BY 1 ORDER BY 1;

-- ## Neighbouring known codes (lookup codes are assigned roughly in batches by product type)
WITH u AS (SELECT DISTINCT item_code FROM unknown)
SELECT u.item_code,
       (SELECT item || ' | ' || unit FROM 'data/raw/lookup_item.parquet' i
        WHERE i.item_code < u.item_code ORDER BY i.item_code DESC LIMIT 1) AS prev_known,
       (SELECT item || ' | ' || unit FROM 'data/raw/lookup_item.parquet' i
        WHERE i.item_code > u.item_code ORDER BY i.item_code LIMIT 1) AS next_known
FROM u ORDER BY 1;

-- ## Premises that price the unknown codes: what else do they price at a similar level?
-- For each unknown code, known items whose median price at the SAME premises is closest.
WITH u_med AS (SELECT item_code, median(price) AS m FROM unknown GROUP BY 1),
known AS (
    SELECT p.item_code, i.item, i.unit, i.item_category, median(p.price) AS m, count(DISTINCT p.premise_code) AS n
    FROM prices p JOIN 'data/raw/lookup_item.parquet' i USING (item_code)
    WHERE p.date >= DATE '2026-10-01' GROUP BY ALL HAVING n >= 300
)
SELECT u.item_code, round(u.m, 2) AS unknown_median,
       list(k.item || ' (' || k.unit || ') RM' || round(k.m, 2) ORDER BY abs(k.m - u.m))[1:3] AS similar_price_known
FROM u_med u, known k GROUP BY ALL ORDER BY 1;
