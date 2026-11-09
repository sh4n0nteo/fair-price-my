-- Tag every window row with why it is dropped (NULL = kept). Tag, don't delete:
-- one table then gives both the clean rows and the per-reason counts for the manifest,
-- and kept + dropped always equals rows in.
-- Reasons are checked in order, so each row gets exactly one.
CREATE OR REPLACE TABLE rows_tagged AS
WITH tagged AS (
    SELECT r.date, r.premise_code, r.item_code, r.price,
           CASE
               WHEN r.date IS NULL OR r.premise_code IS NULL OR r.item_code IS NULL
                    OR r.price IS NULL OR r.price <= 0                       THEN 'invalid'
               WHEN i.item_code IS NULL                                      THEN 'unknown_item'
               WHEN p.premise_code IS NULL                                   THEN 'unknown_premise'
               WHEN list_contains(getvariable('excluded_items'), r.item_code) THEN 'excluded_item'
           END AS drop_reason
    FROM raw_window r
    LEFT JOIN items i USING (item_code)
    LEFT JOIN premises p USING (premise_code)
),
-- National median per item, over rows that survived the checks above.
national AS (
    SELECT item_code, median(price) AS nat_median
    FROM tagged WHERE drop_reason IS NULL GROUP BY 1
)
SELECT t.date, t.premise_code, t.item_code, t.price,
       coalesce(t.drop_reason,
                CASE WHEN t.price < getvariable('outlier_low')  * n.nat_median
                       OR t.price > getvariable('outlier_high') * n.nat_median THEN 'outlier' END
       ) AS drop_reason
FROM tagged t LEFT JOIN national n USING (item_code);

CREATE OR REPLACE TABLE drop_counts AS
SELECT drop_reason AS reason, count(*) AS n
FROM rows_tagged WHERE drop_reason IS NOT NULL GROUP BY 1 ORDER BY 1;
