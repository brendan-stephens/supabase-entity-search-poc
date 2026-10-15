import { Pool, PoolClient } from 'pg'
import type { BenchmarkSuite } from '@/lib/supabase'

function getPool() {
  const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL
  return new Pool({
    connectionString,
    max: 22,
    idleTimeoutMillis: 30_000,
  })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}
function pct(sorted: number[], p: number) {
  return sorted[Math.min(Math.floor(sorted.length * p), sorted.length - 1)]
}
function calcStats(times: number[]): Omit<BenchmarkSuite, 'name' | 'label'> {
  const sorted = [...times].sort((a, b) => a - b)
  const sum = sorted.reduce((a, b) => a + b, 0)
  return {
    n: sorted.length,
    p50: pct(sorted, 0.5),
    p95: pct(sorted, 0.95),
    p99: pct(sorted, 0.99),
    mean: sum / sorted.length,
    max: sorted[sorted.length - 1],
    qps: sorted.length / (sum / 1000),
  }
}

// Introduce a single-character transposition typo (swap two adjacent chars)
function withTypo(s: string): string {
  const words = s.trim().split(/\s+/)
  // Pick the longest word to corrupt
  const wi = words.reduce((best, w, i) => w.length > words[best].length ? i : best, 0)
  const w = words[wi]
  if (w.length < 4) return s
  const i = 1 + Math.floor(w.length * 0.35)
  words[wi] = w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2)
  return words.join(' ')
}

// ── Query sampling ────────────────────────────────────────────────────────────
// Sample real names from the corpus instead of hardcoded generic terms.
// Hardcoded terms like "Global Technologies" match 30k+ rows in synthetic data;
// real sampled names are far more selective — much closer to production behaviour.

type QueryBanks = {
  exact: string[]
  fuzzy: string[]
  multiWord: string[]
  chinese: string[]
  countryBoost: Array<[string, string]>
  allNames: string[]
}

const COUNTRIES = ['US', 'CN', 'GB', 'DE', 'JP', 'FR', 'CA', 'AU']

async function buildQueryBanks(pool: Pool): Promise<QueryBanks> {
  // Grab 60 random names — mix of Latin and Chinese
  const { rows } = await pool.query<{ name: string; country: string }>(`
    SELECT en.name, e.country
    FROM entity_names en TABLESAMPLE BERNOULLI (0.01)
    JOIN entities e ON e.id = en.entity_id
    WHERE length(en.name) BETWEEN 5 AND 40
    LIMIT 60
  `)

  const latin = rows.filter(r => !/[一-鿿]/.test(r.name))
  const chinese = rows.filter(r => /[一-鿿]/.test(r.name))

  const exact = latin.slice(0, 15).map(r => r.name)
  const fuzzy = exact.map(withTypo)
  const multiWord = latin
    .filter(r => r.name.includes(' '))
    .slice(0, 10)
    .map(r => {
      // Use first 1-2 words of the name
      const words = r.name.split(' ')
      return words.slice(0, Math.min(2, words.length)).join(' ')
    })
  const chineseNames = chinese.length >= 4
    ? chinese.slice(0, 10).map(r => r.name.slice(0, 4))   // 4-char substring
    : ['国际科技', '有限公司', '集团控股', '发展投资']     // fallback if few Chinese rows

  const countryBoost: Array<[string, string]> = latin
    .slice(0, 8)
    .map(r => [r.name, r.country && COUNTRIES.includes(r.country) ? r.country : 'US'])

  return {
    exact,
    fuzzy,
    multiWord: multiWord.length ? multiWord : exact.map(n => n.split(' ').slice(0, 2).join(' ')),
    chinese: chineseNames,
    countryBoost,
    allNames: rows.map(r => r.name),
  }
}

// ── Query execution ───────────────────────────────────────────────────────────

const SEARCH_SQL = 'SELECT * FROM search_entities($1, $2, $3)'
const PREFIX_SQL = 'SELECT * FROM search_entities_prefix($1, $2, $3)'
const N = 8
const WARM = 2

async function timeQuery(client: PoolClient, sql: string, params: unknown[]) {
  const t0 = performance.now()
  await client.query(sql, params)
  return performance.now() - t0
}

// Each suite gets its own persistent client so the SET sticks for all queries
async function runSuite(
  pool: Pool,
  label: string,
  queryFn: () => [string, string | null],
  sql = SEARCH_SQL
): Promise<BenchmarkSuite & { name: string; label: string }> {
  const client = await pool.connect()
  try {
    // Set threshold once per client — avoids the 33k-candidate problem on common words
    await client.query("SET pg_trgm.similarity_threshold = 0.5")

    for (let i = 0; i < WARM; i++) {
      const [q, c] = queryFn()
      await timeQuery(client, sql, [q, c, 20])
    }
    const times: number[] = []
    for (let i = 0; i < N; i++) {
      const [q, c] = queryFn()
      times.push(await timeQuery(client, sql, [q, c, 20]))
    }
    return { name: label.toLowerCase().replace(/ /g, '_'), label, ...calcStats(times) }
  } finally {
    client.release()
  }
}

// ── Burst test ────────────────────────────────────────────────────────────────

async function burstTest(pool: Pool, allNames: string[], workers = 20, perWorker = 5) {
  // Warm: establish all connections and set threshold
  await Promise.all(Array.from({ length: workers }, async () => {
    const client = await pool.connect()
    try {
      await client.query("SET pg_trgm.similarity_threshold = 0.5")
      await timeQuery(client, SEARCH_SQL, [pick(allNames), null, 20])
    } finally {
      client.release()
    }
  }))

  const t0 = performance.now()
  const allTimes = await Promise.all(
    Array.from({ length: workers }, async () => {
      const client = await pool.connect()
      try {
        await client.query("SET pg_trgm.similarity_threshold = 0.5")
        const times: number[] = []
        for (let i = 0; i < perWorker; i++) {
          times.push(await timeQuery(client, SEARCH_SQL, [pick(allNames), null, 20]))
        }
        return times
      } finally {
        client.release()
      }
    })
  )
  const elapsed = performance.now() - t0
  const times = allTimes.flat().sort((a, b) => a - b)
  return {
    workers,
    totalQueries: times.length,
    elapsedMs: Math.round(elapsed),
    qps: times.length / (elapsed / 1000),
    p50: pct(times, 0.5),
    p95: pct(times, 0.95),
    p99: pct(times, 0.99),
    headroom: times.length / (elapsed / 1000) / 20,
  }
}

// ── Streaming NDJSON handler ──────────────────────────────────────────────────

export async function POST() {
  if (!process.env.DIRECT_URL && !process.env.DATABASE_URL) {
    return new Response(
      JSON.stringify({ type: 'error', message: 'DIRECT_URL or DATABASE_URL not set' }) + '\n',
      { status: 500, headers: { 'Content-Type': 'application/x-ndjson' } }
    )
  }

  const enc = new TextEncoder()
  const pool = getPool()

  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (event: object) =>
        ctrl.enqueue(enc.encode(JSON.stringify(event) + '\n'))

      try {
        const { rows: er } = await pool.query('SELECT COUNT(*)::int AS n FROM entities')
        const entityCount: number = er[0].n
        if (entityCount === 0) {
          send({ type: 'error', message: 'No data — run scripts/seed.py first' })
          return
        }
        const { rows: nr } = await pool.query('SELECT COUNT(*)::int AS n FROM entity_names')
        send({ type: 'meta', entityCount, nameCount: nr[0].n })

        // Build query banks from real sampled data
        const banks = await buildQueryBanks(pool)

        await Promise.all([
          runSuite(pool, 'Exact match',
            () => [pick(banks.exact), null])
            .then(s => send({ type: 'suite', data: s })),

          runSuite(pool, 'Fuzzy (typos)',
            () => [pick(banks.fuzzy), null])
            .then(s => send({ type: 'suite', data: s })),

          runSuite(pool, 'Multi-word fuzzy',
            () => [pick(banks.multiWord), null])
            .then(s => send({ type: 'suite', data: s })),

          runSuite(pool, 'Chinese script',
            () => [pick(banks.chinese), null])
            .then(s => send({ type: 'suite', data: s })),

          runSuite(pool, 'Country boost',
            () => pick(banks.countryBoost))
            .then(s => send({ type: 'suite', data: s })),

          runSuite(pool, 'Prefix autocomplete',
            () => [pick(banks.exact).slice(0, 5), null], PREFIX_SQL)
            .then(s => send({ type: 'suite', data: s })),
        ])

        send({ type: 'progress', message: 'Running burst test (20 workers)…' })
        const burst = await burstTest(pool, banks.allNames)
        send({ type: 'burst', data: burst })
        send({ type: 'done' })
      } catch (e) {
        send({ type: 'error', message: String(e) })
      } finally {
        ctrl.close()
        pool.end()
      }
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson' },
  })
}
