-- Supabase Entity Search POC: Elasticsearch -> Supabase (pg_trgm)
-- 421M documents, lexical-only, multi-valued name fields

-- Extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Core entity table (one row per company)
CREATE TABLE IF NOT EXISTS entities (
    id          bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    display_name text,           -- stored but not indexed (as in Elastic)
    country     text,            -- ranking boost, not a filter
    created_at  timestamptz DEFAULT now()
);

-- Name variants table (replaces Elastic's multi-valued name field)
-- Each company has 1..N name rows (avg a few, up to thousands per the customer)
CREATE TABLE IF NOT EXISTS entity_names (
    id          bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    entity_id   bigint NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    name        text NOT NULL,
    name_lower  text GENERATED ALWAYS AS (lower(name)) STORED
);

-- GIN trigram index — the workhorse for fuzzy / substring search
-- pg_trgm handles Unicode (including Chinese characters) natively
CREATE INDEX IF NOT EXISTS entity_names_name_trgm_idx
    ON entity_names USING GIN (name gin_trgm_ops);

-- For exact-match fast path (avoids index scan when query matches exactly)
CREATE INDEX IF NOT EXISTS entity_names_name_lower_idx
    ON entity_names (name_lower);

-- For the JOIN back to entities
CREATE INDEX IF NOT EXISTS entity_names_entity_id_idx
    ON entity_names (entity_id);

-- Country index (used for the ranking boost lookup)
CREATE INDEX IF NOT EXISTS entities_country_idx
    ON entities (country);
