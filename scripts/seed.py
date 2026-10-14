#!/usr/bin/env python3
"""
Synthetic data generator for the Supabase entity search POC.

Produces a realistic approximation of a large-scale Elastic serving index:
  - Multi-valued name fields (few per company, occasionally many)
  - ~25% non-Latin names (Chinese characters)
  - Country distribution skewed to US and China (~22% each)
  - ~290 bytes of JSON source per document → ~3-4 name variants average

Usage:
    python scripts/seed.py --entities 5_000_000 --dsn "postgresql://..."
"""

import argparse
import io
import math
import os
import random
import sys
import time

import psycopg2
import psycopg2.extras

# ── Name generation corpus ─────────────────────────────────────────────────────

ENGLISH_PREFIXES = [
    "Global", "International", "National", "Pacific", "Atlantic", "United",
    "Premier", "Advanced", "Strategic", "Digital", "Innovation", "First",
    "Capital", "Prime", "Royal", "Elite", "Superior", "Crown", "Northern",
    "Southern", "Eastern", "Western", "Central", "Allied", "General",
    "American", "Continental", "Universal", "Standard", "Precision",
    "Dynamic", "Integrated", "Consolidated", "Liberty", "Heritage",
]

ENGLISH_ROOTS = [
    "Tech", "Data", "Systems", "Industries", "Holdings", "Enterprises",
    "Partners", "Group", "Associates", "Ventures", "Capital", "Resources",
    "Management", "Consulting", "Solutions", "Services", "Networks",
    "Logistics", "Medical", "Energy", "Financial", "Properties", "Media",
    "Pharma", "Bio", "Auto", "Steel", "Mining", "Trade", "Commerce",
]

ENGLISH_SUFFIXES = [
    "LLC", "Inc.", "Corp.", "Ltd.", "Co.", "LP", "SA", "PLC", "AG", "BV",
    "GmbH", "S.A.", "N.V.", "",
]

# Common Chinese characters used in company names
CHINESE_CHARS = (
    "国际企业集团有限公司科技发展投资控股实业贸易技术服务中心"
    "建设工业咨询资产信息网络文化传媒教育医疗金融保险房地产"
    "北京上海广州深圳成都杭州武汉西安南京重庆天津苏州香港"
)

COUNTRIES = (
    ["US"] * 22 +
    ["CN"] * 22 +
    ["GB"] * 5 +
    ["DE"] * 4 +
    ["JP"] * 4 +
    ["FR"] * 3 +
    ["CA"] * 3 +
    ["AU"] * 3 +
    ["IN"] * 3 +
    ["BR"] * 2 +
    ["KR"] * 2 +
    ["NL"] * 2 +
    ["SG"] * 2 +
    ["CH"] * 1 +
    ["SE"] * 1 +
    ["MX"] * 1 +
    ["IT"] * 1 +
    ["ES"] * 1 +
    ["HK"] * 1 +
    ["ZA"] * 1 +
    ["OTHER"] * 16
)


def make_english_name() -> str:
    parts = []
    if random.random() < 0.7:
        parts.append(random.choice(ENGLISH_PREFIXES))
    parts.append(random.choice(ENGLISH_ROOTS))
    suffix = random.choice(ENGLISH_SUFFIXES)
    name = " ".join(parts)
    if suffix:
        name += " " + suffix
    return name


def make_chinese_name() -> str:
    length = random.randint(4, 8)
    chars = [random.choice(CHINESE_CHARS) for _ in range(length)]
    return "".join(chars)


def make_name(chinese: bool) -> str:
    if chinese:
        # Sometimes mix English suffix onto Chinese root
        if random.random() < 0.15:
            return make_chinese_name() + " " + random.choice(["Ltd.", "Co.", "Corp."])
        return make_chinese_name()
    return make_english_name()


def make_name_variants(display_name: str, is_chinese: bool) -> list[str]:
    """
    Generate 1–6 name variants per entity.
    Mirrors Elastic's multi-valued name field: a few forms per company,
    occasionally many (abbreviations, historical names, transliterations).
    """
    # Weighted: most companies have 1-3 names; occasional outliers have more
    weights = [40, 30, 15, 8, 4, 3]
    count = random.choices(range(1, 7), weights=weights)[0]

    names = [display_name]
    for _ in range(count - 1):
        names.append(make_name(is_chinese))

    return list(dict.fromkeys(names))  # deduplicate while preserving order


# ── Loaders ───────────────────────────────────────────────────────────────────

BATCH = 2_000


def load(conn, n_entities: int, verbose: bool = True) -> None:
    cur = conn.cursor()

    entity_buf: list[tuple] = []
    names_buf: list[tuple] = []

    t0 = time.monotonic()
    inserted_entities = 0
    inserted_names = 0
    next_entity_id = _get_next_entity_id(cur)

    def flush():
        nonlocal inserted_entities, inserted_names, next_entity_id

        if entity_buf:
            psycopg2.extras.execute_values(
                cur,
                "INSERT INTO entities (display_name, country) VALUES %s",
                entity_buf,
                page_size=BATCH,
            )
            inserted_entities += len(entity_buf)
            entity_buf.clear()

        if names_buf:
            psycopg2.extras.execute_values(
                cur,
                "INSERT INTO entity_names (entity_id, name) VALUES %s",
                names_buf,
                page_size=BATCH,
            )
            inserted_names += len(names_buf)
            names_buf.clear()

        conn.commit()
        next_entity_id = _get_next_entity_id(cur)

    for i in range(n_entities):
        is_chinese = random.random() < 0.25
        country = random.choice(COUNTRIES)
        display_name = make_name(is_chinese)
        entity_buf.append((display_name, country))

        # We don't have the auto-generated ID yet — we'll flush entities first,
        # then query IDs. Instead, use a two-pass approach for simplicity.
        if len(entity_buf) >= BATCH:
            # Flush entities, then get IDs, then flush names
            psycopg2.extras.execute_values(
                cur,
                "INSERT INTO entities (display_name, country) VALUES %s RETURNING id, display_name, country",
                entity_buf,
                page_size=BATCH,
            )
            rows = cur.fetchall()
            for eid, dname, ctry in rows:
                is_cn = any(ord(c) > 0x4E00 for c in dname if c)
                variants = make_name_variants(dname, is_cn)
                for v in variants:
                    names_buf.append((eid, v))

            inserted_entities += len(entity_buf)
            entity_buf.clear()

            if names_buf:
                psycopg2.extras.execute_values(
                    cur,
                    "INSERT INTO entity_names (entity_id, name) VALUES %s",
                    names_buf,
                    page_size=len(names_buf),
                )
                inserted_names += len(names_buf)
                names_buf.clear()

            conn.commit()

            if verbose:
                elapsed = time.monotonic() - t0
                rate = inserted_entities / elapsed
                pct = 100 * inserted_entities / n_entities
                eta = (n_entities - inserted_entities) / rate if rate > 0 else 0
                print(
                    f"\r  {inserted_entities:>10,} entities / {inserted_names:>12,} names"
                    f"  {pct:5.1f}%  {rate:,.0f} ent/s  ETA {eta:,.0f}s",
                    end="",
                    flush=True,
                )

    # Flush remainder
    if entity_buf:
        psycopg2.extras.execute_values(
            cur,
            "INSERT INTO entities (display_name, country) VALUES %s RETURNING id, display_name, country",
            entity_buf,
            page_size=BATCH,
        )
        rows = cur.fetchall()
        for eid, dname, ctry in rows:
            is_cn = any(ord(c) > 0x4E00 for c in dname if c)
            variants = make_name_variants(dname, is_cn)
            for v in variants:
                names_buf.append((eid, v))
        inserted_entities += len(entity_buf)
        entity_buf.clear()

    if names_buf:
        psycopg2.extras.execute_values(
            cur,
            "INSERT INTO entity_names (entity_id, name) VALUES %s",
            names_buf,
            page_size=len(names_buf),
        )
        inserted_names += len(names_buf)
        names_buf.clear()

    conn.commit()

    elapsed = time.monotonic() - t0
    if verbose:
        print(f"\n\n  Done: {inserted_entities:,} entities, {inserted_names:,} names in {elapsed:.1f}s")
        print(f"  Avg names/entity: {inserted_names / max(inserted_entities, 1):.2f}")


def _get_next_entity_id(cur) -> int:
    cur.execute("SELECT COALESCE(MAX(id), 0) FROM entities")
    return cur.fetchone()[0] + 1


# ── CLI ───────────────────────────────────────────────────────────────────────

def main():
    p = argparse.ArgumentParser(description="Generate synthetic entity data for the search POC")
    p.add_argument("--entities", type=lambda x: int(x.replace("_", "")),
                   default=1_000_000,
                   help="Number of entities to generate (default: 1_000_000)")
    p.add_argument("--dsn", default=os.environ.get("DATABASE_URL"),
                   help="Postgres DSN (or set DATABASE_URL env var)")
    p.add_argument("--schema", action="store_true",
                   help="Apply schema.sql before loading data")
    p.add_argument("--quiet", action="store_true")
    args = p.parse_args()

    if not args.dsn:
        sys.exit("Error: --dsn or DATABASE_URL required")

    print(f"Connecting to Postgres...")
    conn = psycopg2.connect(args.dsn)
    conn.autocommit = False

    if args.schema:
        print("Applying schema.sql...")
        with open(os.path.join(os.path.dirname(__file__), "schema.sql")) as f:
            sql = f.read()
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()
        print("  schema applied")

    print(f"Generating {args.entities:,} entities...")
    load(conn, args.entities, verbose=not args.quiet)

    conn.close()
    print("Done.")


if __name__ == "__main__":
    main()
