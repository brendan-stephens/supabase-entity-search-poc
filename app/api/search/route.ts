import { NextRequest, NextResponse } from 'next/server'
import { serverClient } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const { query, country } = await req.json()

  if (!query || query.trim().length < 2) {
    return NextResponse.json({ results: [], dbMs: 0, count: 0 })
  }

  const supabase = serverClient()
  const t0 = performance.now()

  const { data, error } = await supabase.rpc('search_entities', {
    p_query: query.trim(),
    p_country: country || null,
    p_limit: 20,
  })

  const dbMs = Math.round(performance.now() - t0)

  if (error) {
    console.error('search_entities error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    results: data ?? [],
    dbMs,
    count: data?.length ?? 0,
  })
}
