'use client'

import { useState, useEffect, useRef } from 'react'
import type { BenchmarkSuite } from '@/lib/supabase'

const STORAGE_KEY = 'benchmark_results'

type Persisted = {
  suites: BenchmarkSuite[]
  burst: BurstResult
  meta: Meta
  elapsed: number
  ranAt: number
}

const TARGET_QPS = 20

type BurstResult = {
  workers: number
  totalQueries: number
  elapsedMs: number
  qps: number
  p50: number
  p95: number
  p99: number
  headroom: number
}

type Meta = { entityCount: number; nameCount: number }

function ms(n: number) { return `${n.toFixed(1)}ms` }

function LatencyCell({ value }: { value: number }) {
  const color = value < 50 ? 'text-[#3ECF8E]' : value < 150 ? 'text-amber-400' : 'text-red-400'
  return <td className={`px-4 py-2.5 font-mono text-xs ${color}`}>{ms(value)}</td>
}

function SuiteRow({ suite }: { suite: BenchmarkSuite }) {
  return (
    <tr className="border-t border-zinc-800 hover:bg-zinc-800/40 transition-colors">
      <td className="px-4 py-2.5 text-sm text-zinc-300">{suite.label}</td>
      <td className="px-4 py-2.5 text-xs text-zinc-600 font-mono">{suite.n}</td>
      <LatencyCell value={suite.p50} />
      <LatencyCell value={suite.p95} />
      <LatencyCell value={suite.p99} />
      <LatencyCell value={suite.mean} />
      <td className="px-4 py-2.5 font-mono text-xs text-zinc-400">{suite.qps.toFixed(0)}</td>
    </tr>
  )
}

function SkeletonRow() {
  return (
    <tr className="border-t border-zinc-800">
      {Array.from({ length: 7 }).map((_, i) => (
        <td key={i} className="px-4 py-2.5">
          <div className="h-3 bg-zinc-800 rounded animate-pulse" style={{ width: i === 0 ? '120px' : '48px' }} />
        </td>
      ))}
    </tr>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-5 py-4">
      <p className="text-xs text-zinc-500 mb-1">{label}</p>
      <p className="text-2xl font-bold text-white font-mono">{value}</p>
      {sub && <p className="text-xs text-zinc-600 mt-1">{sub}</p>}
    </div>
  )
}

const SUITE_COUNT = 6

export default function BenchmarkPage() {
  const [running, setRunning] = useState(false)
  const [suites, setSuites] = useState<BenchmarkSuite[]>([])
  const [burst, setBurst] = useState<BurstResult | null>(null)
  const [meta, setMeta] = useState<Meta | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState<number | null>(null)
  const [ranAt, setRanAt] = useState<number | null>(null)
  const done = burst !== null

  // Accumulate values during a run so we can persist them reliably at the end
  const acc = useRef<{ suites: BenchmarkSuite[]; burst: BurstResult | null; meta: Meta | null }>({
    suites: [], burst: null, meta: null,
  })

  // Restore last results on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const p: Persisted = JSON.parse(raw)
      setSuites(p.suites)
      setBurst(p.burst)
      setMeta(p.meta)
      setElapsed(p.elapsed)
      setRanAt(p.ranAt)
    } catch {}
  }, [])

  async function runBenchmark() {
    setRunning(true)
    setError(null)
    setSuites([])
    setBurst(null)
    setMeta(null)
    setStatus('Connecting…')
    acc.current = { suites: [], burst: null, meta: null }
    const t0 = performance.now()
    setStartedAt(t0)

    try {
      const res = await fetch('/api/benchmark', { method: 'POST' })
      if (!res.body) throw new Error('No response stream')

      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''

      while (true) {
        const { done: streamDone, value } = await reader.read()
        if (streamDone) break

        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.trim()) continue
          let event: Record<string, unknown>
          try { event = JSON.parse(line) } catch { continue }

          if (event.type === 'error') {
            setError(event.message as string)
            setRunning(false)
            return
          }
          if (event.type === 'meta') {
            acc.current.meta = event as unknown as Meta
            setMeta(event as unknown as Meta)
            setStatus('Running 6 suites in parallel…')
          }
          if (event.type === 'suite') {
            const s = event.data as BenchmarkSuite
            acc.current.suites = [...acc.current.suites, s]
            setSuites(prev => [...prev, s])
            // Persist partial results immediately — don't wait for 'done'
            if (acc.current.meta) {
              try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify({
                  suites: acc.current.suites,
                  burst: acc.current.burst,
                  meta: acc.current.meta,
                  elapsed: Math.round(performance.now() - t0),
                  ranAt: Date.now(),
                } satisfies Persisted))
              } catch {}
            }
          }
          if (event.type === 'progress') {
            setStatus(event.message as string)
          }
          if (event.type === 'burst') {
            acc.current.burst = event.data as BurstResult
            setBurst(event.data as BurstResult)
          }
          if (event.type === 'done') {
            const ms = Math.round(performance.now() - t0)
            const now = Date.now()
            setElapsed(ms)
            setRanAt(now)
            setStatus(null)
            const { suites: s, burst: b, meta: m } = acc.current
            if (b && m) {
              try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(
                  { suites: s, burst: b, meta: m, elapsed: ms, ranAt: now } satisfies Persisted
                ))
              } catch {}
            }
          }
        }
      }
    } catch (e) {
      // Keep partial results visible; only show the error banner
      setError(String(e))
      setStatus(null)
    } finally {
      setRunning(false)
    }
  }

  const pendingSuites = SUITE_COUNT - suites.length

  return (
    <main className="max-w-4xl mx-auto px-4 py-12">
      <div className="mb-10 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">Benchmark</h1>
          <p className="text-zinc-500 text-sm">
            {N} queries per suite · direct Postgres connection · no HTTP overhead
            <br />
            Target: handle a 20 QPS burst with room to spare.
          </p>
        </div>
        <button
          onClick={runBenchmark}
          disabled={running}
          className="shrink-0 px-5 py-2.5 bg-[#3ECF8E] text-zinc-950 text-sm font-semibold rounded-lg hover:bg-[#2db87a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {running ? 'Running…' : done ? 'Run Again' : 'Run Benchmark'}
        </button>
      </div>

      {/* Cached-results notice */}
      {!running && done && ranAt && (
        <div className="flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2 mb-4 text-xs text-zinc-500">
          <span>Showing results from {new Date(ranAt).toLocaleString()}</span>
          <button
            onClick={() => { localStorage.removeItem(STORAGE_KEY); setSuites([]); setBurst(null); setMeta(null); setRanAt(null); setElapsed(null) }}
            className="text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            Clear
          </button>
        </div>
      )}

      {/* Status bar */}
      {(running || status) && (
        <div className="flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-lg px-5 py-3 mb-6">
          {running && <div className="w-3.5 h-3.5 border-2 border-[#3ECF8E] border-t-transparent rounded-full animate-spin shrink-0" />}
          <p className="text-sm text-zinc-300">{status}</p>
          {running && suites.length > 0 && (
            <span className="ml-auto text-xs text-zinc-500">{suites.length}/{SUITE_COUNT} suites done</span>
          )}
        </div>
      )}

      {error && (
        <div className="bg-red-950/50 border border-red-800 rounded-lg px-5 py-4 mb-6">
          <p className="text-sm text-red-400">{error}</p>
          {error.includes('seed') && (
            <p className="text-xs text-red-600 mt-1">
              Run: <code className="font-mono">python scripts/seed.py --entities 5_000_000 --dsn &quot;…&quot;</code>
            </p>
          )}
        </div>
      )}

      {(suites.length > 0 || running) && meta && (
        <>
          {/* Dataset summary */}
          <div className="grid grid-cols-3 gap-3 mb-8">
            <Stat
              label="Entities"
              value={meta.entityCount.toLocaleString()}
              sub={`1/${Math.round(421_000_000 / meta.entityCount)}× scale vs production`}
            />
            <Stat
              label="Name variants"
              value={meta.nameCount.toLocaleString()}
              sub={`avg ${(meta.nameCount / meta.entityCount).toFixed(1)} per entity`}
            />
            <Stat
              label="Run time"
              value={elapsed ? `${(elapsed / 1000).toFixed(1)}s` : '—'}
              sub="total wall time incl. warm-up"
            />
          </div>

          {/* Suite results table — rows appear as each suite finishes */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden mb-6">
            <div className="px-4 py-3 border-b border-zinc-800">
              <h2 className="text-sm font-semibold text-white">Query latency by suite</h2>
              <p className="text-xs text-zinc-500 mt-0.5">Measured at the Postgres level · no network</p>
            </div>
            <table className="w-full">
              <thead>
                <tr className="border-b border-zinc-800">
                  {['Suite', 'n', 'p50', 'p95', 'p99', 'mean', 'QPS'].map(h => (
                    <th key={h} className="px-4 py-2 text-left text-xs text-zinc-500 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {suites.map(s => <SuiteRow key={s.name} suite={s} />)}
                {running && Array.from({ length: pendingSuites }).map((_, i) => (
                  <SkeletonRow key={i} />
                ))}
              </tbody>
            </table>
          </div>

          {/* Burst test */}
          {burst ? (
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-5 py-4 mb-6">
              <h2 className="text-sm font-semibold text-white mb-3">
                Concurrent burst test
                <span className="ml-2 text-xs font-normal text-zinc-500">
                  {burst.workers} workers × {Math.round(burst.totalQueries / burst.workers)} queries
                </span>
              </h2>
              <div className="grid grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-zinc-500 mb-1">Sustained QPS</p>
                  <p className="text-xl font-bold font-mono text-white">{burst.qps.toFixed(0)}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500 mb-1">p50 latency</p>
                  <p className={`text-xl font-bold font-mono ${burst.p50 < 50 ? 'text-[#3ECF8E]' : 'text-amber-400'}`}>{ms(burst.p50)}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500 mb-1">p95 latency</p>
                  <p className={`text-xl font-bold font-mono ${burst.p95 < 150 ? 'text-amber-400' : 'text-red-400'}`}>{ms(burst.p95)}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500 mb-1">vs {TARGET_QPS} QPS target</p>
                  <p className={`text-xl font-bold font-mono ${burst.headroom >= 3 ? 'text-[#3ECF8E]' : burst.headroom >= 1.5 ? 'text-amber-400' : 'text-red-400'}`}>
                    {burst.headroom.toFixed(1)}×
                  </p>
                  <p className="text-xs text-zinc-600">headroom</p>
                </div>
              </div>
            </div>
          ) : running && suites.length === SUITE_COUNT && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-5 py-4 mb-6">
              <div className="flex items-center gap-3">
                <div className="w-3.5 h-3.5 border-2 border-[#3ECF8E] border-t-transparent rounded-full animate-spin" />
                <p className="text-sm text-zinc-300">Running burst test (20 workers)…</p>
              </div>
            </div>
          )}

          {/* Cost comparison — only show when fully done */}
          {done && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-800">
                <h2 className="text-sm font-semibold text-white">Cost comparison</h2>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800">
                    <th className="px-4 py-2 text-left text-xs text-zinc-500 font-medium"></th>
                    <th className="px-4 py-2 text-left text-xs text-zinc-500 font-medium">Elasticsearch (current)</th>
                    <th className="px-4 py-2 text-left text-xs text-zinc-500 font-medium">Supabase</th>
                  </tr>
                </thead>
                <tbody className="text-xs">
                  {[
                    ['Config', 'General Purpose · Search Power 250 · Azure eastus', '8XL · 32 cores · 64 GB RAM'],
                    ['Data size', '421M docs · 311 GB', '421M entities · ~430 GB (incl. GIN index)'],
                    ['Est. monthly cost', '~$2,000', '~$650–900'],
                    ['Savings', '—', '55–68% reduction'],
                  ].map(([label, elastic, supabase]) => (
                    <tr key={label} className="border-t border-zinc-800">
                      <td className="px-4 py-2 text-zinc-500">{label}</td>
                      <td className={`px-4 py-2 ${label === 'Est. monthly cost' ? 'text-red-400 font-semibold' : 'text-zinc-300'}`}>{elastic}</td>
                      <td className={`px-4 py-2 ${label === 'Est. monthly cost' || label === 'Savings' ? 'text-[#3ECF8E] font-semibold' : 'text-zinc-300'}`}>{supabase}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="px-4 py-2 text-xs text-zinc-600 border-t border-zinc-800">
                Supabase: $0.32/hr × 730 hrs (8XL compute) + $0.125/GB/month × 430 GB storage
              </p>
            </div>
          )}
        </>
      )}

      {suites.length === 0 && !running && !error && (
        <div className="border border-dashed border-zinc-800 rounded-lg p-8 text-center">
          <p className="text-zinc-500 text-sm mb-4">
            Click &ldquo;Run Benchmark&rdquo; to measure query latency and QPS against your dataset.
          </p>
          <div className="text-left inline-block">
            <p className="text-xs text-zinc-600 mb-2">Prerequisites:</p>
            <ol className="text-xs text-zinc-500 space-y-1 list-decimal list-inside">
              <li>Schema and search functions applied via SQL editor</li>
              <li><code className="text-zinc-400">DATABASE_URL</code> set in <code className="text-zinc-400">.env.local</code></li>
              <li>Data loaded via <code className="text-zinc-400">scripts/seed.py</code></li>
            </ol>
          </div>
        </div>
      )}
    </main>
  )
}

const N = 8
