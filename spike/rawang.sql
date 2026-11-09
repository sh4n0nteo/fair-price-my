-- Rawang investigation (Phase 1.1). Where do premises with a Rawang address sit, and when did they report?
CREATE OR REPLACE VIEW prices AS SELECT * FROM read_parquet('data/raw/pricecatcher_20*.parquet');

-- ## Every premise whose address or name mentions Rawang, with its reporting window
SELECT p.premise_code, p.premise, trim(p.premise_type) AS type, p.state, p.district,
       min(r.date) AS first_seen, max(r.date) AS last_seen, count(r.date) AS n_rows
FROM 'data/raw/lookup_premise.parquet' p
LEFT JOIN prices r USING (premise_code)
WHERE upper(p.address) LIKE '%RAWANG%' OR upper(p.premise) LIKE '%RAWANG%' OR p.district = 'Rawang'
GROUP BY ALL ORDER BY p.district, first_seen NULLS LAST;

-- ## Monthly active premises: Rawang district vs Rawang-address premises elsewhere
SELECT strftime(r.date, '%Y-%m') AS month,
       count(DISTINCT r.premise_code) FILTER (WHERE p.district = 'Rawang') AS rawang_district,
       count(DISTINCT r.premise_code) FILTER (WHERE p.district = 'Gombak' AND upper(p.address) LIKE '%RAWANG%') AS gombak_rawang_addr,
       count(DISTINCT r.premise_code) FILTER (WHERE p.district = 'Hulu Selangor' AND upper(p.address) LIKE '%RAWANG%') AS hulu_sel_rawang_addr
FROM prices r JOIN 'data/raw/lookup_premise.parquet' p USING (premise_code)
WHERE p.district = 'Rawang' OR upper(p.address) LIKE '%RAWANG%'
GROUP BY 1 ORDER BY 1;

-- ## Rawang postcodes (480xx) under any name, and whether they reported in the last 25 months
SELECT p.premise_code, p.premise, p.district, regexp_extract(p.address, '\b(480\d\d)\b', 1) AS postcode,
       min(r.date) AS first_seen, max(r.date) AS last_seen
FROM 'data/raw/lookup_premise.parquet' p LEFT JOIN prices r USING (premise_code)
WHERE regexp_matches(p.address, '\b480\d\d\b')
GROUP BY ALL ORDER BY last_seen DESC NULLS LAST;
