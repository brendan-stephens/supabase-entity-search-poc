-- Search function replicating Elasticsearch fixed-score model
--
-- Scoring tiers:
--   3.0  exact name match (B-tree fast path, sub-5ms)
--   0–1  trigram similarity (GIN fuzzy, ~40ms, only runs when Stage 1 returns nothing)
--   0.1  country boost (additive)
--
-- Two-stage waterfall:
--   Stage 1: B-tree lookup on name_lower — returns immediately if any exact match found.
--   Stage 2: GIN trigram scan — only reached for queries with zero exact matches.
--
-- Adaptive threshold: ≤4 chars → 0.25, ≤6 → 0.35, else 0.50
-- Suffix stripping: strips LLC/GmbH/Ltd/etc. before GIN scan to improve fuzzy recall.

CREATE OR REPLACE FUNCTION search_entities(
    p_query   text,
    p_country text    DEFAULT NULL,
    p_limit   int     DEFAULT 20
)
RETURNS TABLE (
    entity_id    bigint,
    display_name text,
    country      text,
    score        float8,
    matched_name text
)
LANGUAGE plpgsql STABLE PARALLEL SAFE AS $$
DECLARE
    v_count     int;
    v_threshold text;
    v_fuzzy_q   text;
BEGIN
    v_threshold := CASE
        WHEN length(p_query) <= 4 THEN '0.25'
        WHEN length(p_query) <= 6 THEN '0.35'
        ELSE '0.50'
    END;

    v_fuzzy_q := trim(regexp_replace(
        p_query,
        '\s+(?:llc|inc|ltd|corp|co|bv|nv|sa|gmbh|ag|spa|plc|ab|as|oy|se|pty|srl|pte|'
        'holdings|holding|international|group|partners|partner|associates|services|'
        'solutions|consulting|ventures|enterprises|industries|technologies|technology|'
        'limited|incorporated|corporation|company)\.?\s*$',
        '', 'i'
    ));
    IF length(trim(v_fuzzy_q)) < 2 THEN v_fuzzy_q := p_query; END IF;

    -- Stage 1: B-tree exact match
    RETURN QUERY
        SELECT DISTINCT ON (e.id)
            e.id,
            e.display_name,
            e.country,
            3.0::float8
                + CASE WHEN p_country IS NOT NULL AND e.country = p_country
                       THEN 0.1 ELSE 0.0 END,
            en.name
        FROM entity_names en
        JOIN entities e ON e.id = en.entity_id
        WHERE en.name_lower = lower(p_query)
        ORDER BY e.id,
            CASE WHEN p_country IS NOT NULL AND e.country = p_country THEN 0 ELSE 1 END
        LIMIT p_limit;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count > 0 THEN RETURN; END IF;

    -- Stage 2: GIN fuzzy (only when no exact match)
    PERFORM set_config('pg_trgm.similarity_threshold', v_threshold, true);

    RETURN QUERY
        WITH candidates AS (
            SELECT
                en.entity_id,
                MAX(similarity(en.name, p_query)::float8) AS base_score,
                (array_agg(en.name ORDER BY similarity(en.name, p_query) DESC))[1] AS matched_name
            FROM entity_names en
            WHERE en.name % v_fuzzy_q
              AND en.name_lower != lower(p_query)
            GROUP BY en.entity_id
        )
        SELECT
            c.entity_id,
            e.display_name,
            e.country,
            c.base_score
                + CASE WHEN p_country IS NOT NULL AND e.country = p_country
                       THEN 0.1 ELSE 0.0 END,
            c.matched_name
        FROM candidates c
        JOIN entities e ON e.id = c.entity_id
        ORDER BY 4 DESC
        LIMIT p_limit;
END;
$$;

-- ── Prefix / starts-with search (fast B-tree path, no trigrams needed) ────────
-- Useful for autocomplete — bypasses GIN entirely.
CREATE OR REPLACE FUNCTION search_entities_prefix(
    p_prefix   text,
    p_country  text    DEFAULT NULL,
    p_limit    integer DEFAULT 20
)
RETURNS TABLE (
    entity_id    bigint,
    display_name text,
    country      text,
    matched_name text
)
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
SELECT DISTINCT ON (e.id)
    e.id,
    e.display_name,
    e.country,
    en.name
FROM entity_names en
JOIN entities e ON e.id = en.entity_id
WHERE en.name_lower LIKE lower(p_prefix) || '%'
ORDER BY e.id, en.name_lower
LIMIT p_limit;
$$;
