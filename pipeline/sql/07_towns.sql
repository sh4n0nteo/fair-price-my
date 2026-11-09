-- towns.json: area name -> district slug, so "Subang Jaya" or "Bangsar" finds the right file.
-- Addresses are free text, and half have no postcode, so every comma-separated segment is a
-- candidate area name. Segments that are clearly not places (roads, lots, units) are filtered out.
-- Only premises with prices in the window, and districts that got a file: a search must never
-- land on a district with no data (e.g. 'Rawang' exists in the lookup but reports nothing).
CREATE OR REPLACE TABLE out_towns AS
WITH active AS (
    SELECT * FROM scope_districts WHERE slug IN (SELECT slug FROM out_districts)
),
segments AS (
    SELECT DISTINCT p.premise_code, d.slug,
           -- strip a leading postcode and a trailing state name: '47500 SUBANG JAYA, SELANGOR'
           trim(regexp_replace(
               regexp_replace(trim(seg), '^\d{5}\s*', ''),
               '\s*(SELANGOR( DARUL EHSAN)?|PULAU PINANG|PENANG|JOHOR( DARUL TA.ZIM)?|W\.?\s?P\.?)\.?$', ''
           )) AS town
    FROM premises p
    JOIN active d USING (state, district)
    SEMI JOIN latest l ON l.premise_code = p.premise_code,
         -- collapse \r\n and runs of spaces first: some addresses contain line breaks
         unnest(string_split(regexp_replace(upper(p.address), '\s+', ' ', 'g'), ',')) AS u(seg)
),
candidates AS (
    SELECT town, slug, count(*) AS n
    FROM segments
    WHERE length(town) >= 4
      AND NOT regexp_matches(town, '\d')   -- 'SEKSYEN 18', 'LOT 4991', 'NO.6'
      AND NOT regexp_matches(town,
          '^(JALAN|JLN|LORONG|LRG|PERSIARAN|LEBUH|LEBUHRAYA|LINGKARAN|LOT|NO|UNIT|BLOK|BLOCK|TINGKAT|LEVEL|'
          || 'GROUND|FLOOR|LOWER|UPPER|SUB-BASEMENT|BASEMENT|KM|BATU|MUKIM|BANGUNAN|WISMA|KOMPLEKS|PLAZA|MENARA|'
          || 'SELANGOR|JOHOR|PULAU PINANG|PENANG|MALAYSIA|KL)\b')
    GROUP BY ALL
),
-- Majority vote: a name maps to the district holding most of its premises.
-- A name spread across districts ('KUALA LUMPUR' spans 11) is dropped instead of guessed.
voted AS (
    SELECT town, slug, n, sum(n) OVER (PARTITION BY town) AS total
    FROM candidates
    QUALIFY row_number() OVER (PARTITION BY town ORDER BY n DESC, slug) = 1
)
SELECT lower(district) AS town, slug FROM active   -- district names always win
UNION ALL
SELECT lower(town), slug FROM voted
WHERE n >= 0.6 * total
  AND lower(town) NOT IN (SELECT lower(district) FROM active)
ORDER BY 1;
