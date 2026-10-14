-- Search function replicating Elasticsearch fixed-score model
--
-- Scoring tiers (matches their fixed-score model):
--   3.0  exact name match (keyword)
--   0–1  trigram similarity (fuzzy / n-gram)
--   0.1  country boost (additive, not a filter)
--
-- The CTE aggregates across all name variants per entity, keeping the best
-- match score for companies with many name forms.

CREATE OR REPLACE FUNCTION search_entities(
    p_query    text,
    p_country  text    DEFAULT NULL,
    p_limit    integer DEFAULT 20
)
RETURNS TABLE (
    entity_id    bigint,
    display_name text,
    country      text,
    score        double precision,
    matched_name text
)
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
WITH ranked AS (
    SELECT
        e.id                                             AS entity_id,
        e.display_name,
        e.country,
        -- Best score across all name variants for this entity
        MAX(
            CASE
                WHEN en.name_lower = lower(p_query) THEN 3.0          -- exact
                ELSE similarity(en.name, p_query)::double precision     -- fuzzy
            END
        )
        -- Country boost: additive, never filters out results
        + CASE WHEN p_country IS NOT NULL AND e.country = p_country
               THEN 0.1 ELSE 0.0 END                                   AS score,
        -- Surface the best-matching name for display
        (array_agg(en.name ORDER BY
            CASE WHEN en.name_lower = lower(p_query) THEN 0 ELSE 1 END,
            similarity(en.name, p_query) DESC
        ))[1]                                            AS matched_name
    FROM entity_names en
    JOIN entities e ON e.id = en.entity_id
    WHERE
        -- GIN index path: trigram similarity threshold (pg_trgm default 0.3)
        en.name % p_query
        -- Exact match fast path: bypasses trigram threshold
        OR en.name_lower = lower(p_query)
    GROUP BY e.id, e.display_name, e.country
)
SELECT entity_id, display_name, country, score, matched_name
FROM ranked
ORDER BY score DESC
LIMIT p_limit;
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
