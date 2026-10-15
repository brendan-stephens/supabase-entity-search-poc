#!/usr/bin/env python3
"""
GLEIF LEI data loader for the entity search POC.

Paginates per ISO country code to bypass the GLEIF API's 10,000-record
Elasticsearch window limit (max page 50 × 200 per query). Each country is
fetched independently, so the total loaded approaches the full 3.2M dataset.

Usage:
  pip install psycopg2-binary
  python scripts/load_gleif.py --dsn "$DATABASE_URL"
  python scripts/load_gleif.py --dsn "$DATABASE_URL" --workers 4
  python scripts/load_gleif.py --dsn "$DATABASE_URL" --limit 500_000
"""

import argparse
import itertools
import json
import os
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    sys.exit("pip install psycopg2-binary")

GLEIF_API = "https://api.gleif.org/api/v1/lei-records"
PAGE_SIZE = 200
BATCH     = 2_000
RETRIES   = 5
MAX_PAGES = 50   # GLEIF API caps at 50 × 200 = 10,000 results per query window

# ISO 3166-1 alpha-2 codes sorted roughly by LEI density (big markets first)
# so the first pass yields diverse, high-value names quickly.
COUNTRY_CODES = [
    'US','DE','GB','JP','FR','CN','NL','IT','CA','AU','CH','SE','ES','KR','SG',
    'HK','IN','BE','NO','DK','FI','AT','BR','LU','IE','PL','PT','CZ','RU','MX',
    'ZA','AR','TW','TR','TH','MY','ID','PH','VN','NZ','IL','AE','SA','EG','NG',
    'KE','GH','MA','TZ','ET','QA','KW','BH','JO','LB','IQ','IR','PK','BD','LK',
    'NP','KZ','UA','RO','HU','SK','HR','SI','BG','EE','LV','LT','RS','BA','AL',
    'MK','ME','GR','CY','MT','IS','LI','MC','SM','VA','AD','LU','MU','RE','MG',
    'TN','DZ','SD','LY','MZ','ZM','ZW','UG','RW','TZ','AO','CM','CI','SN','GN',
    'ML','BF','NE','TD','GH','TG','BJ','GA','CG','CD','GW','SL','LR','GM','MR',
    'ER','DJ','SO','CG','CF','GQ','ST','CV','KM','SC','MW','LS','SZ','NA','BW',
    'CO','VE','CL','PE','EC','BO','PY','UY','GY','SR','CR','PA','GT','HN','SV',
    'NI','BZ','DO','CU','JM','HT','TT','BB','BS','AG','LC','GD','VC','KN','DM',
    'NZ','FJ','PG','SB','VU','WS','TO','KI','FM','MH','PW','NR','TV','CK','NU',
    'ID','BN','TL','MM','LA','KH','MN','AF','TJ','KG','TM','UZ','AZ','AM','GE',
    'BY','MD','GE','XK','FO','GL','IM','JE','GG','AX','BL','MF','PM','YT','GP',
    'MQ','GF','PF','NC','WF','RE','MO','HK','TW','SX','CW','BQ','AW','VI','PR',
    'GU','AS','MP','CX','CC','NF','HM','TF','BV','GS','SH','TC','VG','KY','BM',
    'AI','MS','PN','IO','FK','GI','SJ','SV','UM','AQ',
]


# ── Fetch ──────────────────────────────────────────────────────────────────────

def fetch_page(page_num: int, country: str) -> dict:
    url = (f"{GLEIF_API}?filter[entity.status]=ACTIVE"
           f"&filter[entity.legalAddress.country]={country}"
           f"&page[size]={PAGE_SIZE}&page[number]={page_num}")
    req = urllib.request.Request(url, headers={"Accept": "application/vnd.api+json"})

    attempt = 0
    rate_waits = 0
    while attempt < RETRIES:
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as exc:
            if exc.code == 429:
                # Respect Retry-After; don't count as a failure attempt
                rate_waits += 1
                wait_s = int(exc.headers.get("Retry-After", str(min(60, 5 * rate_waits))))
                time.sleep(wait_s + 1)
                continue
            if exc.code == 400:
                return {"data": [], "meta": {"pagination": {"total": 0, "lastPage": 0}}}
            attempt += 1
            if attempt >= RETRIES:
                raise RuntimeError(f"p{page_num}/{country} failed after {RETRIES} attempts: {exc}")
            time.sleep(2 ** attempt)
        except Exception as exc:
            attempt += 1
            if attempt >= RETRIES:
                raise RuntimeError(f"p{page_num}/{country} failed after {RETRIES} attempts: {exc}")
            time.sleep(2 ** attempt)


def parse_record(rec: dict):
    """Return (display_name, country, [names]) or None."""
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


# ── DB ─────────────────────────────────────────────────────────────────────────

def db_flush(cur, entity_rows: list, name_rows: list):
    psycopg2.extras.execute_values(
        cur,
        "INSERT INTO entities (id, display_name, country)"
        " OVERRIDING SYSTEM VALUE VALUES %s ON CONFLICT DO NOTHING",
        entity_rows, page_size=500,
    )
    psycopg2.extras.execute_values(
        cur,
        "INSERT INTO entity_names (entity_id, name) VALUES %s ON CONFLICT DO NOTHING",
        name_rows, page_size=500,
    )


# ── Main ───────────────────────────────────────────────────────────────────────

def load(dsn: str, workers: int = 4, limit: int | None = None):
    conn = psycopg2.connect(dsn)
    cur  = conn.cursor()

    print("Clearing existing data…")
    cur.execute("TRUNCATE entities, entity_names RESTART IDENTITY CASCADE")
    conn.commit()

    next_id    = 0
    entity_buf = []
    name_buf   = []
    committed  = 0
    errors     = 0
    t0         = time.time()

    def absorb(page_data) -> bool:
        nonlocal next_id
        for rec in page_data.get("data", []):
            parsed = parse_record(rec)
            if not parsed:
                continue
            display_name, country, names = parsed
            next_id += 1
            entity_buf.append((next_id, display_name, country))
            for n in names:
                name_buf.append((next_id, n))
            if limit and next_id >= limit:
                return True
        return False

    def maybe_flush(force: bool = False):
        nonlocal committed
        if entity_buf and (len(entity_buf) >= BATCH or force):
            db_flush(cur, entity_buf, name_buf)
            conn.commit()
            committed += len(entity_buf)
            entity_buf.clear()
            name_buf.clear()

    hit_limit = False

    for ci, country in enumerate(COUNTRY_CODES, 1):
        if hit_limit:
            break

        # Page 1: discover this country's total record count
        try:
            first = fetch_page(1, country)
        except Exception as exc:
            errors += 1
            print(f"\n  ✗ {country} p1: {exc}", file=sys.stderr)
            continue

        country_total = first["meta"]["pagination"]["total"]
        if country_total == 0:
            continue

        last_page  = min(first["meta"]["pagination"]["lastPage"], MAX_PAGES)
        total_done = committed + len(entity_buf)
        elapsed    = time.time() - t0
        rate       = total_done / elapsed if elapsed > 0 else 0
        capped     = "⚠ capped" if first["meta"]["pagination"]["lastPage"] > MAX_PAGES else ""
        print(f"\n  [{ci:>3}/{len(COUNTRY_CODES)}] {country}  "
              f"{country_total:>7,} records  total {total_done:>8,}  {rate:>6.0f}/s  {capped}")

        hit_limit = absorb(first)
        maybe_flush()

        if hit_limit or last_page <= 1:
            continue

        # Pages 2..last_page — concurrent fetch
        page_iter = iter(range(2, last_page + 1))
        with ThreadPoolExecutor(max_workers=workers) as pool:
            in_flight = {pool.submit(fetch_page, p, country): p
                         for p in itertools.islice(page_iter, workers * 2)}

            while in_flight and not hit_limit:
                done, _ = wait(in_flight, timeout=120, return_when=FIRST_COMPLETED)
                for future in done:
                    pnum = in_flight.pop(future)
                    try:
                        hit_limit = absorb(future.result())
                    except Exception as exc:
                        errors += 1
                        print(f"\n  ✗ {country} p{pnum}: {exc}", file=sys.stderr)

                    maybe_flush()

                    if hit_limit:
                        pool.shutdown(wait=False, cancel_futures=True)
                        break

                    try:
                        np = next(page_iter)
                        in_flight[pool.submit(fetch_page, np, country)] = np
                    except StopIteration:
                        pass

    maybe_flush(force=True)

    cur.execute(
        "SELECT setval(pg_get_serial_sequence('entities','id'), "
        "(SELECT COALESCE(MAX(id), 0) FROM entities))"
    )
    conn.commit()

    cur.execute("SELECT COUNT(*) FROM entity_names")
    name_count = cur.fetchone()[0]

    elapsed = time.time() - t0
    print(f"\n\n  ✓  {committed:,} entities · {name_count:,} name rows · "
          f"{errors} errors · {elapsed / 60:.1f}m")
    if errors:
        print(f"  {errors} page errors — re-run to fill gaps", file=sys.stderr)

    cur.close()
    conn.close()


if __name__ == "__main__":
    p = argparse.ArgumentParser(
        description="Load GLEIF LEI data via per-country pagination"
    )
    p.add_argument("--dsn",     default=os.environ.get("DATABASE_URL"),
                   help="Postgres connection string (or set DATABASE_URL)")
    p.add_argument("--workers", type=int, default=4,
                   help="Concurrent fetch workers per country (default: 4)")
    p.add_argument("--limit",   type=lambda x: int(x.replace("_", "")), default=None,
                   help="Stop after N entities, e.g. --limit 500_000")
    args = p.parse_args()

    if not args.dsn:
        sys.exit("--dsn or DATABASE_URL required")

    load(args.dsn, workers=args.workers, limit=args.limit)
