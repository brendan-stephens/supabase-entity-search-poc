import { NextResponse } from 'next/server'
import { Pool } from 'pg'

export async function POST() {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL not set' }, { status: 500 })
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 })

  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS pg_prewarm')

    const { rows } = await pool.query<{
      entity_names_heap: number
      gin_trgm_idx: number
      name_lower_idx: number
      entity_id_idx: number
      entities_heap: number
      entities_pkey: number
      country_idx: number
    }>(`
      SELECT
        pg_prewarm('entity_names', 'buffer')               AS entity_names_heap,
        pg_prewarm('entity_names_name_trgm_idx', 'buffer') AS gin_trgm_idx,
        pg_prewarm('entity_names_name_lower_idx', 'buffer') AS name_lower_idx,
        pg_prewarm('entity_names_entity_id_idx', 'buffer') AS entity_id_idx,
        pg_prewarm('entities', 'buffer')                   AS entities_heap,
        pg_prewarm('entities_pkey', 'buffer')              AS entities_pkey,
        pg_prewarm('entities_country_idx', 'buffer')       AS country_idx
    `)

    const r = rows[0]
    const PAGE = 8 // KB per page

    const items = [
      { name: 'entity_names (heap)',   pages: r.entity_names_heap,  label: 'Table data' },
      { name: 'GIN trigram index',     pages: r.gin_trgm_idx,       label: 'Primary search index' },
      { name: 'name_lower (B-tree)',   pages: r.name_lower_idx,     label: 'Exact match fast path' },
      { name: 'entity_id (B-tree)',    pages: r.entity_id_idx,      label: 'Join index' },
      { name: 'entities (heap)',       pages: r.entities_heap,      label: 'Entity table data' },
      { name: 'entities pkey',         pages: r.entities_pkey,      label: 'Primary key' },
      { name: 'country index',         pages: r.country_idx,        label: 'Country boost' },
    ]

    const totalPages = items.reduce((s, i) => s + i.pages, 0)

    return NextResponse.json({
      items: items.map(i => ({
        ...i,
        sizeKb: i.pages * PAGE,
        sizeMb: Math.round((i.pages * PAGE) / 1024),
      })),
      totalMb: Math.round((totalPages * PAGE) / 1024),
    })
  } finally {
    await pool.end()
  }
}
