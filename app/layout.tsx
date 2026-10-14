import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Supabase Entity Search POC',
  description: 'Elasticsearch → Supabase (pg_trgm) benchmark demo',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <nav className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-[#3ECF8E] font-bold text-lg">⚡ Supabase</span>
            <span className="text-zinc-600">×</span>
            <span className="text-zinc-400 text-sm">Search POC</span>
          </div>
          <div className="flex gap-1">
            <a href="/" className="px-3 py-1.5 rounded text-sm text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors">
              Search
            </a>
            <a href="/benchmark" className="px-3 py-1.5 rounded text-sm text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors">
              Benchmark
            </a>
            <a href="/prewarm" className="px-3 py-1.5 rounded text-sm text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors">
              Prewarm
            </a>
            <a href="/explain" className="px-3 py-1.5 rounded text-sm text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors">
              Explain
            </a>
          </div>
        </nav>
        {children}
      </body>
    </html>
  )
}
