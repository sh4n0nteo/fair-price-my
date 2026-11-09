-- One price per (premise, item): the most recent one in the window.
-- arg_max(price, date) returns the price on the row with the largest date, in a single pass.
-- This also fixes the spike's weighting problem: a daily reporter counts once, like a weekly one.
CREATE OR REPLACE TABLE latest AS
SELECT premise_code, item_code,
       arg_max(price, date) AS price,
       max(date)            AS date_seen
FROM rows_tagged
WHERE drop_reason IS NULL
GROUP BY ALL;
