-- Price stats at all three comparison levels in ONE aggregation, using GROUPING SETS.
-- Each grouping set is a separate GROUP BY; grouping(col) = 1 marks a column rolled up.
-- Only states touched by scope are read, but state-level stats use the whole state
-- (e.g. all of Johor), since that is the fallback's whole point.
CREATE OR REPLACE TABLE level_stats AS
SELECT p.state, p.district, p.premise_type, l.item_code,
       CASE WHEN grouping(p.premise_type) = 0 THEN 'district_type'
            WHEN grouping(p.district) = 0     THEN 'district'
            ELSE 'state' END                 AS level,
       count(*)                              AS n_premises,
       -- Shop-type mix behind an all-types number (district or state level); NULL for typed groups.
       CASE WHEN grouping(p.premise_type) = 1 THEN histogram(p.premise_type) END AS type_mix,
       -- Controlled items only (NULL otherwise). +0.005 absorbs float noise around exact RM prices.
       CASE WHEN any_value(c.controlled_price) IS NOT NULL
            THEN count(*) FILTER (WHERE l.price > c.controlled_price + 0.005) END AS n_above_controlled,
       min(l.price)                          AS min,
       quantile_cont(l.price, 0.25)          AS p25,
       median(l.price)                       AS median,
       quantile_cont(l.price, 0.75)          AS p75,
       max(l.price)                          AS max,
       list({'premise_code': l.premise_code, 'price': l.price, 'date_seen': l.date_seen}
            ORDER BY l.price, p.premise)[1:3] AS cheapest
FROM latest l JOIN premises p USING (premise_code)
LEFT JOIN controlled c USING (item_code)
WHERE p.state IN (SELECT state FROM scope_districts)
GROUP BY GROUPING SETS (
    (p.state, p.district, p.premise_type, l.item_code),
    (p.state, p.district, l.item_code),
    (p.state, l.item_code)
);

-- The groups a user can ask about, per in-scope district and item:
--   * one per premise type seen in the district (primary level: district + type)
--   * one for all types, premise_type NULL       (primary level: district)
-- Each picks the first level with >= min_premises, in the order
-- district+type -> district -> state. Groups where even the state is too thin are dropped.
CREATE OR REPLACE TABLE groups AS
WITH wanted AS (
    SELECT s.state, s.district, s.premise_type, s.item_code
    FROM level_stats s JOIN scope_districts d USING (state, district)
    WHERE s.level IN ('district_type', 'district')
),
candidates AS (
    SELECT w.state, w.district, w.premise_type, w.item_code,
           s.level, s.n_premises, s.type_mix, s.n_above_controlled, s.min, s.p25, s.median, s.p75, s.max, s.cheapest,
           CASE s.level WHEN 'district_type' THEN 1 WHEN 'district' THEN 2 ELSE 3 END AS level_rank
    FROM wanted w
    JOIN level_stats s
      ON s.item_code = w.item_code AND s.state = w.state
     AND (   s.level = 'state'
          OR (s.level = 'district'      AND s.district = w.district)
          OR (s.level = 'district_type' AND s.district = w.district AND s.premise_type = w.premise_type))
    WHERE s.n_premises >= getvariable('min_premises')
)
SELECT state, district, premise_type, item_code, n_premises, n_above_controlled,
       CASE WHEN premise_type IS NULL THEN type_mix END AS type_mix,
       -- NULL when the group's own level had enough premises; else the level actually used.
       CASE WHEN level = CASE WHEN premise_type IS NULL THEN 'district' ELSE 'district_type' END
            THEN NULL ELSE level END AS fallback_level,
       min, p25, median, p75, max, cheapest
FROM candidates
QUALIFY row_number() OVER (PARTITION BY state, district, premise_type, item_code ORDER BY level_rank) = 1;
