import { createClient } from '@supabase/supabase-js'

export type SearchResult = {
  entity_id: number
  display_name: string
  country: string
  score: number
  matched_name: string
}

export type SearchResponse = {
  results: SearchResult[]
  dbMs: number
  count: number
}

export type BenchmarkSuite = {
  name: string
  label: string
  n: number
  p50: number
  p95: number
  p99: number
  mean: number
  max: number
  qps: number
}

export type BenchmarkResponse = {
  entityCount: number
  nameCount: number
  suites: BenchmarkSuite[]
  burst: {
    workers: number
    totalQueries: number
    elapsedMs: number
    qps: number
    p50: number
    p95: number
    p99: number
    headroom: number
  }
}

// Server-side client using service role key (never exposed to browser)
export function serverClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}
