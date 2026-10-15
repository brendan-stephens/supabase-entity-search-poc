#!/usr/bin/env python3
"""
GLEIF LEI data loader for the entity search POC.

Fetches ~3.2M active Legal Entity Identifier records from the free GLEIF
public API and loads them into the entities / entity_names tables.

Each LEI record maps cleanly to our schema:
  - Legal name                  → entity_names row + entities.display_name
  - Other / transliterated names → additional entity_names rows
  - legalAddress.country        → entities.country

Real GLEIF data has near-100% unique names, fixing the vocabulary-collision
problem that inflates GIN candidate sets in synthetic data.

Usage:
  pip install psycopg2-binary
  python scripts/load_gleif.py --dsn "$DATABASE_URL"
  python scripts/load_gleif.py --dsn "$DATABASE_URL" --workers 10
  python scripts/load_gleif.py --dsn "$DATABASE_URL" --limit 500_000
"""

import argparse
import json
import os
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    sys.exit("pip install psycopg2-binary")

GLEIF_API = "https://api.gleif.org/api/v1/lei-records"
PAGE_SIZE = 200
BATCH     = 2_000   # entities per DB commit
RETRIES   = 4


# ── Fetch ─────────────────────────────────────────────────────────────────────

def fetch_page(page_num: int) -> dict:
    url = (f"{GLEIF_API}?filter[entity.status]=ACTIVE"
           f"&page[size]={PAGE_SIZE}&page[number]={page_num}")
    for attempt in range(RETRIES):
        try:
            req = urllib.request.Request(url, headers={"Accept": "application/vnd.api+json"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read())
        except Exception as exc:
            if attempt == RETRIES - 1:
                raise RuntimeError(f"page {page_num} failed after {RETRIES} attempts: {exc}")
            time.sleep(2 ** attempt)


def parse_record(rec: dict):
    """Return (display_name, country, [names]) or None if record should be skipped."""
    entity = rec.get("attributes", {}).get("entity", {})
    if entity.get("status") != "ACTIVE":
        return None

    display_name = (entity.get("legalName") or {}).get("name", "").strip()
    if not display_name:
        return None

    country = (entity.get("legalAddress") or {}).get("country", "").strip() or None

    names = [display_name]
    for src in ("otherNames", "transliteratedOtherNames"):
        for n in entity.get(src) or []:
            v = (n.get("name") or "").strip()
            if v and v not in names:
                names.append(v)

    return display_name, country, names


# ── DB ────────────────────────────────────────────────────────────────────────

def db_flush(cur, entity_rows: list, name_rows: list):
    psycopg2.extras.execute_values(
        cur,
        "INSERT INTO entities (id, display_name, country)"
        " OVERRIDING SYSTEM VALUE VALUES %s ON CONFLICT DO NOTHING",
        entity_rows,
        page_size=500,
    )
    psycopg2.extras.execute_values(
        cur,
        "INSERT INTO entity_names (entity_id, name) VALUES %s ON CONFLICT DO NOTHING",
        name_rows,
        page_size=500,
    )


# ── Main ──────────────────────────────────────────────────────────────────────

def load(dsn: str, workers: int = 8, limit: int | None = None):
    conn = psycopg2.connect(dsn)
    cur  = conn.cursor()

    print("Clearing existing data…")
    cur.execute("TRUNCATE entities, entity_names RESTART IDENTITY CASCADE")
    conn.commit()

    print("Fetching page 1 to get total record count…")
    first      = fetch_page(1)
    pagination = first["meta"]["pagination"]
    total_recs = pagination["total"]
    total_pages = pagination["lastPage"]
    if limit:
        total_recs  = min(total_recs, limit)
        total_pages = (total_recs + PAGE_SIZE - 1) // PAGE_SIZE
    print(f"  {total_recs:,} active LEI records · {total_pages:,} pages · {workers} workers\n")

    next_id    = 0       # entity ID counter (we manage IDs explicitly)
    entity_buf = []
    name_buf   = []
    committed  = 0
    errors     = 0
    t0         = time.time()

    def absorb(page_data):
        nonlocal next_id
        for rec in page_data.get("data", []):
            parsed = parse_record(rec)
            if parsed is None:
                continue
            display_name, country, names = parsed
            next_id += 1
            entity_buf.append((next_id, display_name, country))
            for n in names:
                name_buf.append((next_id, n))
            if limit and next_id >= limit:
                return True   # signal: hit the limit
        return False

    def maybe_flush(force: bool = False):
        nonlocal committed
        if entity_buf and (len(entity_buf) >= BATCH or force):
            db_flush(cur, entity_buf, name_buf)
            conn.commit()
            committed += len(entity_buf)
            entity_buf.clear()
            name_buf.clear()

    def print_progress():
        done    = committed + len(entity_buf)
        elapsed = time.time() - t0
        rate    = done / elapsed if elapsed > 0 else 0
        eta_s   = (total_recs - done) / rate if rate > 0 else 0
        print(
            f"\r  {done:>9,} / {total_recs:,}  "
            f"{rate:>6.0f} ent/s  "
            f"ETA {eta_s / 60:>4.0f}m",
            end="", flush=True,
        )

    # Process page 1 (already fetched)
    hit_limit = absorb(first)
    maybe_flush()
    print_progress()

    if not hit_limit:
        page_iter = iter(range(2, total_pages + 1))

        with ThreadPoolExecutor(max_workers=workers) as pool:
            # Seed the pool with the first wave of futures
            in_flight = {pool.submit(fetch_page, p): p
                         for p in list(page_iter)[:workers * 4]}

            while in_flight and not hit_limit:
                for future in as_completed(in_flight, timeout=120):
                    pnum = in_flight.pop(future)
                    try:
                        hit_limit = absorb(future.result())
                    except Exception as exc:
                        errors += 1
                        print(f"\n  ✗ page {pnum}: {exc}", file=sys.stderr)

                    maybe_flush()
                    print_progress()

                    if hit_limit:
                        pool.shutdown(wait=False, cancel_futures=True)
                        break

                    # Refill the pool
                    try:
                        np = next(page_iter)
                        in_flight[pool.submit(fetch_page, np)] = np
                    except StopIteration:
                        pass

    maybe_flush(force=True)

    # Sync the sequence so future inserts don't collide
    cur.execute(
        "SELECT setval(pg_get_serial_sequence('entities','id'), "
        "(SELECT COALESCE(MAX(id), 0) FROM entities))"
    )
    conn.commit()

    elapsed = time.time() - t0
    name_count = cur.execute("SELECT COUNT(*) FROM entity_names") or 0
    cur.execute("SELECT COUNT(*) FROM entity_names")
    name_count = cur.fetchone()[0]

    print(f"\n\n  ✓  {committed:,} entities · {name_count:,} name rows · "
          f"{errors} errors · {elapsed:.0f}s")
    if errors:
        print(f"  {errors} pages failed — re-run to fill gaps", file=sys.stderr)

    cur.close()
    conn.close()


if __name__ == "__main__":
    p = argparse.ArgumentParser(description="Load GLEIF LEI data into entity search POC")
    p.add_argument("--dsn",     default=os.environ.get("DATABASE_URL"),
                   help="Postgres connection string (or set DATABASE_URL)")
    p.add_argument("--workers", type=int, default=8,
                   help="Concurrent API fetch workers (default: 8)")
    p.add_argument("--limit",   type=lambda x: int(x.replace("_", "")), default=None,
                   help="Stop after N entities, e.g. --limit 500_000")
    args = p.parse_args()

    if not args.dsn:
        sys.exit("--dsn or DATABASE_URL required")

    load(args.dsn, workers=args.workers, limit=args.limit)
