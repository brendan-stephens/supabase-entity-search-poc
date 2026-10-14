import { Pool } from 'pg'

function getPool() {
  const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL
  return new Pool({ connectionString, max: 3, idleTimeoutMillis: 10_000 })
}

export async function GET() {
  const pool = getPool()
  try {
    // Sample real names so suggestions always match something in the DB
    const { rows } = await pool.query<{ name: string }>(`
      SELECT en.name
      FROM entity_names en TABLESAMPLE BERNOULLI (0.05)
      WHERE length(en.name) BETWEEN 5 AND 35
      LIMIT 200
    `)

    const latin   = rows.filter(r => !/[一-鿿]/.test(r.name))
    const chinese = rows.filter(r =>  /[一-鿿]/.test(r.name))

    // Pick a multi-word Latin name as the "exact match" demo
    const multiWord = latin.find(r => r.name.includes(' '))?.name ?? latin[0]?.name ?? 'Global Tech'

    // Pick a different Latin name and introduce a transposition typo
    const typoBase = latin.find(r => r !== latin[0] && r.name.includes(' ') && r.name.length >= 8)
    const typoName = typoBase ? withTypo(typoBase.name) : 'Internaional Holdings'

    // Short prefix (first 4 chars of a Latin name)
    const prefixBase = latin.find(r => r.name.length >= 6 && r !== typoBase)
    const prefixName = prefixBase ? prefixBase.name.slice(0, 4) : 'Glob'

    // Chinese: use a 4-char slice of a real Chinese name
    const ch1 = chinese[0] ? chinese[0].name.slice(0, 4) : '国际科技'
    const ch2 = chinese[1] ? chinese[1].name.slice(0, 4) : '技术集团'

    const suggestions = [multiWord, typoName, prefixName, ch1, ch2].filter(Boolean)

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
