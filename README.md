# Supabase Entity Search POC

Next.js + Supabase demo showing Postgres (`pg_trgm`) as a drop-in replacement for
an Elasticsearch serving index: 421M documents, lexical-only, multi-valued name
fields, ~25% Chinese names, country ranking boost.

**Goal:** show equivalent search quality at a fraction of the cost.

---

## Setup

### 1. Create a Supabase project

[app.supabase.com](https://app.supabase.com) → New project.

### 2. Apply schema and search function

Paste into the SQL editor (or use `psql`):

```bash
psql "$DATABASE_URL" -f schema.sql -f search.sql
```

### 3. Configure environment

```bash
cp .env.local.example .env.local
# Fill in NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL
```

All three values are in **Project Settings → API / Database**.

### 4. Load synthetic data

```bash
pip install psycopg2-binary
python scripts/seed.py --entities 5_000_000 --dsn "$DATABASE_URL"
```

Scale guide:

| `--entities` | Name rows | Load time | GIN index size |
|---|---|---|---|
| 1,000,000 | ~3.5M | ~2 min | ~1 GB |
| 5,000,000 | ~17M | ~10 min | ~5 GB |
| 10,000,000 | ~35M | ~20 min | ~10 GB |
| 421,000,000 | ~1.5B | ~14 hrs | ~430 GB |

### 5. Run the app

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Pages

| Route | What it shows |
|---|---|
| `/` | Live search demo — type a company name (try a typo or Chinese characters) |
| `/benchmark` | Run the full suite: p50/p95/p99 latency × 6 query types + 20-worker burst test |

---

## How it works

| Elastic feature | Postgres equivalent |
|---|---|
| n-gram / keyword multi-field on `name` | `pg_trgm` GIN index on `entity_names.name` |
| Exact match (keyword subfield) | B-tree on `entity_names.name_lower` |
| Fixed score tiers | `CASE` scoring in `search_entities()`: exact=3.0, fuzzy=0–1 |
| Country ranking boost | `+0.1` additive, never filters |
| Multi-valued name field | `entity_names` table — one row per name variant |
| Non-Latin (Chinese) | `pg_trgm` handles Unicode trigrams natively |

The benchmark uses a **direct Postgres connection** (`pg` package) so latency
numbers reflect pure query time, not REST API overhead.
