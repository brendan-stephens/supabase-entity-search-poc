'use client'

import { useState, useRef, useCallback } from 'react'
import type { SearchResult, SearchResponse } from '@/lib/supabase'

const COUNTRIES = [
  { code: '', label: 'All countries' },
  { code: 'US', label: '🇺🇸 United States' },
  { code: 'CN', label: '🇨🇳 China' },
  { code: 'GB', label: '🇬🇧 United Kingdom' },
  { code: 'DE', label: '🇩🇪 Germany' },
  { code: 'JP', label: '🇯🇵 Japan' },
  { code: 'FR', label: '🇫🇷 France' },
  { code: 'CA', label: '🇨🇦 Canada' },
  { code: 'AU', label: '🇦🇺 Australia' },
  { code: 'IN', label: '🇮🇳 India' },
  { code: 'BR', label: '🇧🇷 Brazil' },
  { code: 'SG', label: '🇸🇬 Singapore' },
  { code: 'HK', label: '🇭🇰 Hong Kong' },
]

const SUGGESTIONS = [
  'Global Technologies',
  'Internaional Holdings',  // typo — tests fuzzy
  '国际科技',
  'Premier Cap',            // prefix
  'Advansed Solutions',     // typo
  '技术集团',
]

function ScoreBar({ score }: { score: number }) {
  // Max meaningful score is ~3.1 (exact + country boost)
  const pct = Math.min((score / 3.1) * 100, 100)
  const color = score >= 2.5 ? '#3ECF8E' : score >= 1 ? '#f59e0b' : '#71717a'
  return (
    <div className="h-1 w-24 bg-zinc-800 rounded-full overflow-hidden">
      <div
        className="h-full rounded-full score-bar"
        style={{ width: `${pct}%`, backgroundColor: color }}
      />
    </div>
  )
}

function LatencyBadge({ ms, loading }: { ms: number | null; loading: boolean }) {
  if (loading) return (
    <span className="text-sm text-zinc-500 animate-pulse">searching…</span>
  )
  if (ms === null) return null
  const color = ms < 20 ? 'text-[#3ECF8E]' : ms < 100 ? 'text-amber-400' : 'text-red-400'
  return (
    <span className={`text-sm font-mono font-semibold ${color}`}>
      {ms}ms
    </span>
  )
}

export default function SearchPage() {
  const [query, setQuery] = useState('')
  const [country, setCountry] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [dbMs, setDbMs] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [empty, setEmpty] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout>>()

  const search = useCallback(async (q: string, c: string) => {
    if (q.trim().length < 2) {
      setResults([])
      setDbMs(null)
      setEmpty(false)
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, country: c }),
      })
      if (!res.ok) {
        const { error } = await res.json()
        console.error(error)
        return
      }
      const data: SearchResponse = await res.json()
      setResults(data.results)
      setDbMs(data.dbMs)
      setEmpty(data.count === 0)
    } finally {
      setLoading(false)
    }
  }, [])

  function handleInput(q: string) {
    setQuery(q)
    clearTimeout(debounce.current)
    debounce.current = setTimeout(() => search(q, country), 200)
  }

  function handleCountry(c: string) {
    setCountry(c)
    if (query.trim().length >= 2) search(query, c)
  }

  return (
    <main className="max-w-3xl mx-auto px-4 py-12">
      {/* Header */}
      <div className="mb-10">
        <h1 className="text-2xl font-bold text-white mb-1">Entity Search</h1>
        <p className="text-zinc-500 text-sm">
          421M-document lexical search · Elasticsearch → Supabase (
          <code className="text-zinc-400 text-xs">pg_trgm</code> GIN index)
        </p>
      </div>

      {/* Search controls */}
      <div className="flex gap-2 mb-3">
        <input
          type="text"
          value={query}
          onChange={e => handleInput(e.target.value)}
          placeholder="Search company names (try a typo)…"
          className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 text-white placeholder-zinc-600 focus:outline-none focus:border-[#3ECF8E] focus:ring-1 focus:ring-[#3ECF8E] transition-colors text-sm"
          autoFocus
        />
        <select
          value={country}
          onChange={e => handleCountry(e.target.value)}
          className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-3 text-zinc-300 text-sm focus:outline-none focus:border-[#3ECF8E] cursor-pointer"
        >
          {COUNTRIES.map(c => (
            <option key={c.code} value={c.code}>{c.label}</option>
          ))}
        </select>
      </div>

      {/* Status row */}
      <div className="flex items-center gap-3 h-5 mb-6">
        <LatencyBadge ms={dbMs} loading={loading} />
        {!loading && results.length > 0 && (
          <span className="text-xs text-zinc-600">
            {results.length} result{results.length !== 1 ? 's' : ''}
          </span>
        )}
        {!loading && dbMs !== null && country && (
          <span className="text-xs text-zinc-600">· country boost active</span>
        )}
      </div>

      {/* Suggestions */}
      {!query && (
        <div className="mb-8">
          <p className="text-xs text-zinc-600 mb-2">Try:</p>
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map(s => (
              <button
                key={s}
                onClick={() => handleInput(s)}
                className="px-3 py-1 bg-zinc-900 border border-zinc-800 rounded-full text-xs text-zinc-400 hover:border-zinc-600 hover:text-zinc-200 transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {empty && !loading && (
        <div className="text-center py-16 text-zinc-600">
          <p className="text-sm">No results for &ldquo;{query}&rdquo;</p>
          <p className="text-xs mt-1">Trigram similarity threshold not met</p>
        </div>
      )}

      {/* Results */}
      <div className="space-y-2">
        {results.map(r => (
          <div
            key={r.entity_id}
            className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 hover:border-zinc-700 transition-colors"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-white text-sm font-medium truncate">{r.display_name}</p>
                {r.matched_name !== r.display_name && (
                  <p className="text-zinc-500 text-xs mt-0.5">
                    via <span className="text-zinc-400">{r.matched_name}</span>
                  </p>
                )}
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <span className="text-xs font-mono text-zinc-500">{r.country}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-zinc-600">{r.score.toFixed(2)}</span>
                  <ScoreBar score={r.score} />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Scoring legend */}
      {results.length > 0 && (
        <div className="mt-8 border-t border-zinc-800 pt-6">
          <p className="text-xs text-zinc-600 mb-2">Scoring model</p>
          <div className="flex flex-wrap gap-4 text-xs text-zinc-500">
            <span><span className="text-[#3ECF8E] font-mono">3.0</span> exact match</span>
            <span><span className="text-amber-400 font-mono">0–1</span> trigram similarity</span>
            <span><span className="text-zinc-400 font-mono">+0.1</span> country boost</span>
          </div>
        </div>
      )}
    </main>
  )
}
