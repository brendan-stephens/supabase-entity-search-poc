import { Pool } from 'pg'

function getPool() {
  const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL
  return new Pool({ connectionString, max: 3, idleTimeoutMillis: 10_000 })
}

export async function GET() {
  const pool = getPool()
  try {
    const [latinRes, chineseRes] = await Promise.all([
      // Multi-word Latin names, 10–40 chars, no special chars — good for exact + fuzzy + prefix demos
      pool.query<{ name: string }>(`
        SELECT en.name
        FROM entity_names en TABLESAMPLE BERNOULLI (0.1)
        WHERE en.name ~ '^[A-Za-z]'
          AND en.name ~ ' '
          AND length(en.name) BETWEEN 10 AND 40
          AND en.name NOT LIKE '%(%'
        LIMIT 50
      `),
      // Chinese-script names
      pool.query<{ name: string }>(`
        SELECT en.name
        FROM entity_names en TABLESAMPLE BERNOULLI (0.5)
        WHERE en.name ~ '[\\u4e00-\\u9fff]'
          AND length(en.name) BETWEEN 4 AND 20
        LIMIT 10
      `),
    ])

    const latin   = latinRes.rows.map(r => r.name)
    const chinese = chineseRes.rows.map(r => r.name)

    // 1. Exact match — multi-word name as-is
    const exact = latin[0] ?? 'Global Industries'

    // 2. Fuzzy — typo of a different multi-word name
    const fuzzyBase = latin[1] ?? latin[0] ?? 'International Holdings'
    const fuzzy = withTypo(fuzzyBase)

    // 3. Prefix — first word of a name, at least 4 non-space chars
    const prefixBase = latin[2] ?? latin[0] ?? 'Precision Group'
    const firstWord  = prefixBase.split(/\s+/)[0]
    const prefix     = firstWord.length >= 4 ? firstWord : prefixBase.slice(0, 5).trimEnd()

    // 4 & 5. Chinese names — full name or 6-char slice to stay readable
    const ch1 = chinese[0] ? chinese[0].slice(0, 6) : '国际科技'
    const ch2 = chinese[1] ? chinese[1].slice(0, 6) : '技术集团'

    const suggestions = [exact, fuzzy, prefix, ch1, ch2].filter(Boolean)
    return Response.json({ suggestions })
  } catch (e) {
    return Response.json({ suggestions: [] }, { status: 500 })
  } finally {
    pool.end()
  }
}

function withTypo(s: string): string {
  const words = s.trim().split(/\s+/)
  const wi = words.reduce((best, w, i) => w.length > words[best].length ? i : best, 0)
  const w = words[wi]
  if (w.length < 4) return s
  const i = 1 + Math.floor(w.length * 0.35)
  words[wi] = w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2)
  return words.join(' ')
}
