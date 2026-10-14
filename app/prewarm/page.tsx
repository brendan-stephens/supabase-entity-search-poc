'use client'

import { useState } from 'react'

type PrewarmItem = {
  name: string
  label: string
  pages: number
  sizeKb: number
  sizeMb: number
}

type PrewarmResult = {
  items: PrewarmItem[]
  totalMb: number
}

function Bar({ mb, maxMb }: { mb: number; maxMb: number }) {
  const pct = Math.max((mb / maxMb) * 100, 1)
  return (
    <div className="h-1.5 w-24 bg-zinc-800 rounded-full overflow-hidden">
      <div
        className="h-full rounded-full bg-[#3ECF8E] score-bar"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

export default function PrewarmPage() {
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<PrewarmResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [elapsedMs, setElapsedMs] = useState<number | null>(null)

  async function run() {
    setRunning(true)
    setError(null)
    setResult(null)
    const t0 = performance.now()
    try {
      const res = await fetch('/api/prewarm', { method: 'POST' })
      setElapsedMs(Math.round(performance.now() - t0))
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Prewarm failed'); return }
      setResult(data)
    } catch (e) {
      setError(String(e))
    } finally {
      setRunning(false)
    }
  }

  const maxMb = result ? Math.max(...result.items.map(i => i.sizeMb)) : 1

  return (
    <main className="max-w-2xl mx-auto px-4 py-12">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">Prewarm</h1>
          <p className="text-zinc-500 text-sm">
            Loads all indexes and table data into <code className="text-zinc-400">shared_buffers</code> so the first benchmark query hits cache, not disk.
          </p>
        </div>
        <button
          onClick={run}
          disabled={running}
          className="shrink-0 px-5 py-2.5 bg-[#3ECF8E] text-zinc-950 text-sm font-semibold rounded-lg hover:bg-[#2db87a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {running ? 'Warming…' : result ? 'Rewarm' : 'Run Prewarm'}
        </button>
      </div>

      {running && (
        <div className="flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-lg px-5 py-4 mb-6">
          <div className="w-4 h-4 border-2 border-[#3ECF8E] border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-white">Loading indexes into shared_buffers…</p>
        </div>
      )}

      {error && (
        <div className="bg-red-950/50 border border-red-800 rounded-lg px-5 py-4 mb-6">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {result && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
            <div>
              <span className="text-sm font-semibold text-white">
                {result.totalMb} MB loaded into shared_buffers
              </span>
              <span className="text-xs text-zinc-500 ml-2">in {elapsedMs}ms</span>
            </div>
            <span className="text-xs text-[#3ECF8E] font-medium">✓ Cache warm</span>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="px-4 py-2 text-left text-xs text-zinc-500 font-medium">Object</th>
                <th className="px-4 py-2 text-left text-xs text-zinc-500 font-medium">Purpose</th>
                <th className="px-4 py-2 text-left text-xs text-zinc-500 font-medium">Pages</th>
                <th className="px-4 py-2 text-left text-xs text-zinc-500 font-medium">Size</th>
                <th className="px-4 py-2 text-left text-xs text-zinc-500 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {result.items.map(item => (
                <tr key={item.name} className="border-t border-zinc-800 hover:bg-zinc-800/40 transition-colors">
                  <td className="px-4 py-2.5 text-sm text-zinc-200 font-mono text-xs">{item.name}</td>
                  <td className="px-4 py-2.5 text-xs text-zinc-500">{item.label}</td>
                  <td className="px-4 py-2.5 text-xs text-zinc-500 font-mono">{item.pages.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-xs text-zinc-400 font-mono">{item.sizeMb} MB</td>
                  <td className="px-4 py-2.5"><Bar mb={item.sizeMb} maxMb={maxMb} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-3 border-t border-zinc-800">
            <p className="text-xs text-zinc-600">
              Run this after an instance restart or compute upgrade. The benchmark page will show consistent latency once the cache is warm.
            </p>
          </div>
        </div>
      )}

      {!result && !running && !error && (
        <div className="border border-dashed border-zinc-800 rounded-lg p-8 text-center">
          <p className="text-zinc-500 text-sm">
            Click &ldquo;Run Prewarm&rdquo; to load all indexes into memory before benchmarking.
          </p>
        </div>
      )}
    </main>
  )
}
