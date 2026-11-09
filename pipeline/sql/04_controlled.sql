-- Controlled-price items come from config (KPDN's official list), not from the data:
-- a gazetted price is a legal fact, and detection could miss it in a month where many
-- shops overcharge. Detection still runs, as a cross-check that only produces warnings.

CREATE OR REPLACE TABLE controlled AS
SELECT c.item_code, c.price AS controlled_price
FROM (SELECT unnest(getvariable('controlled'), recursive := true)) c;

-- Fail loudly: a listed code that isn't in the item lookup is a config typo.
SELECT CASE WHEN count(*) > 0
            THEN error('controlled item_codes not in lookup_item: ' || string_agg(item_code::VARCHAR, ', '))
       END
FROM controlled ANTI JOIN items USING (item_code);

-- Per item, nationally: the most common price and the share of premises charging it.
-- Over `latest`, so each premise votes once.
CREATE OR REPLACE TABLE uniformity AS
WITH modal AS (SELECT item_code, mode(price) AS modal_price, count(*) AS n FROM latest GROUP BY 1)
SELECT l.item_code, m.modal_price, m.n AS n_premises,
       avg((l.price = m.modal_price)::INT) AS share_at_modal
FROM latest l JOIN modal m USING (item_code)
GROUP BY ALL;

CREATE OR REPLACE TABLE controlled_warnings AS
WITH u AS (
    SELECT u.*, c.controlled_price,
           u.n_premises >= getvariable('controlled_detect_min_premises')
           AND u.share_at_modal >= getvariable('controlled_detect_min_share') AS looks_controlled
    FROM uniformity u LEFT JOIN controlled c USING (item_code)
)
SELECT item_code, 'looks controlled but not in config' AS warning,
       printf('%.1f%% of %d premises charge RM%.2f', 100 * share_at_modal, n_premises, modal_price) AS detail
FROM u WHERE looks_controlled AND controlled_price IS NULL
UNION ALL
SELECT item_code, 'listed as controlled but prices not uniform',
       printf('only %.1f%% of %d premises charge the modal RM%.2f', 100 * share_at_modal, n_premises, modal_price)
FROM u WHERE controlled_price IS NOT NULL AND NOT looks_controlled
UNION ALL
SELECT item_code, 'listed price differs from market modal price',
       printf('config RM%.2f, modal RM%.2f', controlled_price, modal_price)
FROM u WHERE controlled_price IS NOT NULL AND abs(modal_price - controlled_price) > 0.005
UNION ALL
SELECT item_code, 'listed as controlled but not priced in window', ''
FROM controlled ANTI JOIN uniformity USING (item_code)
ORDER BY item_code, warning;
