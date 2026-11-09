-- PriceCatcher data spike. Run from repo root:  .venv/bin/python spike/run.py
-- Every query reads the Parquet files in place: no import step, no database file.

-- ## Setup: views over the raw files
-- Views are just saved queries, so the raw files stay the single source of truth.
-- trim(premise_type) fixes 'Pasar Basah ' vs 'Pasar Basah' (same type, trailing space).
CREATE OR REPLACE VIEW items    AS SELECT * FROM 'data/raw/lookup_item.parquet';
CREATE OR REPLACE VIEW premises AS
    SELECT premise_code, premise, address, trim(premise_type) AS premise_type, state, district
    FROM 'data/raw/lookup_premise.parquet';
CREATE OR REPLACE VIEW prices_all AS SELECT * FROM read_parquet('data/raw/pricecatcher_*.parquet');
-- Analysis month = Oct 2026: the latest *complete* file. Nov is only 8 days old (1 survey Monday).
CREATE OR REPLACE VIEW prices AS SELECT * FROM 'data/raw/pricecatcher_2026-10.parquet';

-- One price per (premise, item) for the month = that premise's median.
-- Without this, a premise reporting daily counts 22x and a weekly one 3x in every percentile.
CREATE OR REPLACE VIEW premise_item_price AS
    SELECT premise_code, item_code, median(price) AS price, count(*) AS n_obs
    FROM prices
    WHERE price > 0
    GROUP BY ALL;

-- ## Q1 Freshness: latest month and date, per file
SELECT strftime(date, '%Y-%m') AS month, min(date) AS first_date, max(date) AS last_date,
       count(DISTINCT date) AS n_days, count(*) AS n_rows
FROM prices_all GROUP BY 1 ORDER BY 1;

-- ## Q1b Rows per weekday (Oct): big Monday spike = weekly survey + daily core panel
SELECT dayname(date) AS weekday, count(DISTINCT date) AS n_days, count(*) // count(DISTINCT date) AS rows_per_day
FROM prices GROUP BY 1 ORDER BY rows_per_day DESC;

-- ## Q2 Scale (Oct)
SELECT count(*)                         AS n_rows,
       count(DISTINCT p.item_code)      AS n_items,
       count(DISTINCT p.premise_code)   AS n_premises,
       count(DISTINCT (s.state, s.district)) AS n_districts,  -- (state, district): names can repeat across states
       count(DISTINCT s.state)          AS n_states
FROM prices p LEFT JOIN premises s USING (premise_code);

-- ## Q3a Item standardisation: 10 example items (one per group, spread across the catalogue)
SELECT item_code, item, unit, item_group, item_category
FROM items WHERE item_code > 0
QUALIFY row_number() OVER (PARTITION BY item_group ORDER BY item_code) <= 2
ORDER BY item_group LIMIT 10;

-- ## Q3b Is item_code unique per (item name, unit)? Any name with several units/codes?
SELECT count(*) AS n_codes,
       count(DISTINCT (item, unit)) AS n_distinct_name_unit,
       count(*) FILTER (WHERE unit IS NULL OR trim(unit) = '') AS n_missing_unit
FROM items WHERE item_code > 0;

SELECT item, list(unit ORDER BY item_code) AS units, list(item_code ORDER BY item_code) AS codes
FROM items WHERE item_code > 0
GROUP BY item HAVING count(*) > 1 ORDER BY item LIMIT 10;

-- ## Q3c Unit strings are free text: how many spellings?
SELECT unit, count(*) AS n_items FROM items WHERE item_code > 0 GROUP BY 1 ORDER BY 2 DESC LIMIT 15;

-- ## Q4 Coverage: per district, items priced at >= 5 distinct premises in the month
WITH per_item AS (
    SELECT s.state, s.district, pip.item_code, count(*) AS n_premises
    FROM premise_item_price pip JOIN premises s USING (premise_code)
    GROUP BY ALL
)
SELECT state, district,
       count(*)                               AS items_priced,
       count(*) FILTER (WHERE n_premises >= 5) AS items_ge5_premises,
       CASE WHEN district ILIKE 'Petaling%' THEN '<== PETALING' ELSE '' END AS flag
FROM per_item GROUP BY ALL
ORDER BY items_ge5_premises DESC;

-- ## Q4b Coverage summary: how many districts clear a usable bar?
WITH per_item AS (
    SELECT s.state, s.district, pip.item_code, count(*) AS n_premises
    FROM premise_item_price pip JOIN premises s USING (premise_code) GROUP BY ALL
), per_district AS (
    SELECT state, district, count(*) FILTER (WHERE n_premises >= 5) AS ge5 FROM per_item GROUP BY ALL
)
SELECT count(*) AS n_districts,
       count(*) FILTER (WHERE ge5 >= 100) AS districts_ge100_items,
       count(*) FILTER (WHERE ge5 BETWEEN 1 AND 99) AS districts_1_to_99_items,
       count(*) FILTER (WHERE ge5 = 0) AS districts_zero_items,
       median(ge5) AS median_items_ge5
FROM per_district;

-- ## Q4c Petaling vs Petaling Jaya: two district labels for one area (Petaling district contains PJ)
SELECT s.district, count(DISTINCT pip.premise_code) AS premises_with_prices,
       list(DISTINCT s.premise_type) AS types
FROM premise_item_price pip JOIN premises s USING (premise_code)
WHERE s.district ILIKE 'Petaling%' GROUP BY 1;

-- ## Q5a Premise types: how many premises of each type actually report prices
SELECT s.premise_type, count(DISTINCT pip.premise_code) AS n_premises, count(DISTINCT pip.item_code) AS n_items
FROM premise_item_price pip JOIN premises s USING (premise_code)
GROUP BY 1 ORDER BY 2 DESC;

-- ## Q5b National median price by premise type, 5 common items (one row per item, types as columns)
-- PIVOT turns premise_type values into columns, which suits this side-by-side comparison.
PIVOT (
    SELECT i.item || ' (' || i.unit || ')' AS item, s.premise_type, pip.price
    FROM premise_item_price pip
    JOIN items i USING (item_code) JOIN premises s USING (premise_code)
    WHERE pip.item_code IN (1, 1589, 129, 1976, 1611)
      AND s.premise_type IN ('Hypermarket', 'Pasar Raya / Supermarket', 'Pasar Mini', 'Kedai Runcit', 'Pasar Basah')
)
ON premise_type USING round(median(price), 2) GROUP BY item;

-- ## Q6 Worked example: AYAM BERSIH - STANDARD (1kg), Petaling district, Oct 2026
SELECT i.item, i.unit, count(*) AS n_premises,
       min(pip.price) AS min,
       quantile_cont(pip.price, 0.25) AS p25,
       median(pip.price) AS median,
       quantile_cont(pip.price, 0.75) AS p75,
       max(pip.price) AS max
FROM premise_item_price pip JOIN items i USING (item_code) JOIN premises s USING (premise_code)
WHERE pip.item_code = 1 AND s.district = 'Petaling'
GROUP BY ALL;

SELECT s.premise, s.premise_type, pip.price, pip.n_obs, s.address
FROM premise_item_price pip JOIN premises s USING (premise_code)
WHERE pip.item_code = 1 AND s.district = 'Petaling'
ORDER BY pip.price, s.premise LIMIT 3;

-- ## Q7a Data quality: nulls and non-positive prices
SELECT count(*) FILTER (WHERE date IS NULL)         AS null_date,
       count(*) FILTER (WHERE premise_code IS NULL) AS null_premise,
       count(*) FILTER (WHERE item_code IS NULL)    AS null_item,
       count(*) FILTER (WHERE price IS NULL)        AS null_price,
       count(*) FILTER (WHERE price <= 0)           AS nonpositive_price
FROM prices;

-- ## Q7b Orphans: codes missing from the lookups, or pointing at the -1 'unknown' row
SELECT count(*) FILTER (WHERE i.item_code IS NULL)    AS item_not_in_lookup,
       count(*) FILTER (WHERE s.premise_code IS NULL) AS premise_not_in_lookup,
       count(*) FILTER (WHERE p.item_code = -1 OR p.premise_code = -1) AS unknown_sentinel,
       count(*) FILTER (WHERE s.district IS NULL)     AS no_district
FROM prices p LEFT JOIN items i USING (item_code) LEFT JOIN premises s USING (premise_code);

-- ## Q7c Duplicates: exact duplicate rows, and same (date, premise, item) with conflicting prices
SELECT (SELECT count(*) FROM prices) - (SELECT count(*) FROM (SELECT DISTINCT * FROM prices)) AS exact_dup_rows,
       (SELECT count(*) FROM (SELECT date, premise_code, item_code FROM prices GROUP BY ALL
                              HAVING count(DISTINCT price) > 1)) AS conflicting_keys;

-- ## Q7d Outliers: premise prices >= 10x or <= 1/10 of the item's national median
WITH med AS (SELECT item_code, median(price) AS nat_median FROM premise_item_price GROUP BY 1)
SELECT count(*) AS n_premise_item_prices,
       count(*) FILTER (WHERE price >= 10 * nat_median) AS ge_10x,
       count(*) FILTER (WHERE price <= nat_median / 10) AS le_tenth,
       count(*) FILTER (WHERE price >= 3 * nat_median OR price <= nat_median / 3) AS beyond_3x
FROM premise_item_price JOIN med USING (item_code);

-- ## Q7e Worst outliers (likely unit or typo errors)
WITH med AS (SELECT item_code, median(price) AS nat_median FROM premise_item_price GROUP BY 1)
SELECT i.item, i.unit, s.premise, s.premise_type, pip.price, m.nat_median,
       round(pip.price / m.nat_median, 1) AS ratio
FROM premise_item_price pip JOIN med m USING (item_code)
JOIN items i USING (item_code) JOIN premises s USING (premise_code)
WHERE pip.price >= 10 * m.nat_median OR pip.price <= m.nat_median / 10
ORDER BY greatest(ratio, 1 / ratio) DESC LIMIT 10;
