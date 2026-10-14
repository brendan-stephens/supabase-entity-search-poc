export default function ExplainPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 py-12">
      <div className="mb-10">
        <h1 className="text-2xl font-bold text-white mb-1">About this demo</h1>
        <p className="text-zinc-500 text-sm">
          What we&apos;re searching, how it works, and what the benchmark measures
        </p>
      </div>

      <div className="space-y-8">

        {/* What we're replacing */}
        <Section title="What we're replacing">
          <p>
            A production Elasticsearch serving index with roughly <strong>421 million documents</strong> — one per company in a global entity dataset. The index is <strong>lexical-only</strong>: no vectors, no ML. Search is driven by keyword and n-gram subfields on company name fields, with a fixed scoring model and an optional country ranking boost.
          </p>
          <p className="mt-3">
            The index runs on <strong>Elastic Cloud Serverless (General Purpose, Search Power 250)</strong> at approximately <strong>$2,000/month</strong> in Azure East US.
          </p>
        </Section>

        {/* The dataset */}
        <Section title="The dataset">
          <p>
            Each entity has:
          </p>
          <ul className="mt-2 space-y-1.5 text-sm text-zinc-400">
            <Li><strong className="text-zinc-200">Multiple name variants</strong> — a few per company on average, occasionally thousands (abbreviations, historical names, transliterations). In Elasticsearch these are multi-valued fields on a single document; here they are rows in a separate <code className="text-zinc-300">entity_names</code> table.</Li>
            <Li><strong className="text-zinc-200">~25% non-Latin names</strong> — primarily Chinese characters. <code className="text-zinc-300">pg_trgm</code> handles Unicode trigrams natively, so no special configuration is needed.</Li>
            <Li><strong className="text-zinc-200">Country field</strong> — used as a ranking boost, not a filter. A search for &ldquo;Acme&rdquo; with country=US returns the same result set as without it, just re-ranked.</Li>
            <Li><strong className="text-zinc-200">Display name</strong> — stored but not indexed, returned in results.</Li>
          </ul>
          <p className="mt-3">
            The demo dataset is synthetic and generated at 1/421 scale (~1M entities, ~2.1M name variants). The Postgres schema and search function are identical to what would run at full scale.
          </p>
        </Section>

        {/* How search works */}
        <Section title="How search works">
          <p>
            Two Postgres extensions do all the work:
          </p>
          <div className="mt-4 space-y-4">
            <Card label="Search waterfall — fastest path wins">
              Queries run through two stages. <strong className="text-zinc-200">Stage 1</strong>: case-insensitive B-tree lookup — if we get enough exact matches, we return immediately without touching the GIN index. <strong className="text-zinc-200">Stage 2</strong>: GIN trigram scan (similarity ≥ 0.5) — only reached when the exact path doesn&apos;t saturate the result limit. This means exact and prefix queries complete in ~30ms; only genuine typo/fuzzy queries pay the GIN cost.
            </Card>
            <Card label="pg_trgm · GIN index (fuzzy search)">
              Breaks every name into overlapping trigrams (three-character sequences) and stores them in a GIN index. A query like <code>&quot;Globel Technologeis&quot;</code> shares enough trigrams with <code>&quot;Global Technologies&quot;</code> to score above the similarity threshold (0.5) and appear in results. Handles typos, partial matches, and non-Latin scripts natively.
            </Card>
            <Card label="B-tree index on name_lower (exact match)">
              A case-insensitive exact match hits a standard B-tree index — single index scan regardless of dataset size.
            </Card>
          </div>
          <div className="mt-4 bg-zinc-900 border border-zinc-800 rounded-lg p-4 font-mono text-xs text-zinc-400 leading-relaxed">
            <div className="text-zinc-500 mb-2">-- Scoring model (mirrors Elastic&apos;s fixed-score tiers)</div>
            <div><span className="text-[#3ECF8E]">3.0</span>  exact name match</div>
            <div><span className="text-amber-400">0–1</span>  trigram similarity (fuzzy)</div>
            <div><span className="text-zinc-300">+0.1</span> country boost (additive)</div>
            <div className="mt-2 text-zinc-500">-- Aggregated per entity across all name variants</div>
            <div>-- so a company with many names surfaces as one result</div>
          </div>
        </Section>

        {/* What the benchmark measures */}
        <Section title="What the benchmark measures">
          <p>
            The benchmark runs from the Next.js server using a <strong>direct Postgres connection</strong> (<code>pg</code> package), so latency numbers reflect pure database query time — no HTTP or REST overhead.
          </p>
          <div className="mt-4 space-y-2">
            {[
              ['Exact match', 'Case-insensitive lookup of a full company name. Uses the B-tree fast path.'],
              ['Fuzzy (typos)', 'Intentionally misspelled names — tests the GIN trigram path with recheck.'],
              ['Multi-word fuzzy', 'Two-word queries with mixed exact and partial tokens.'],
              ['Chinese script', 'Unicode trigram queries — verifies non-Latin search works correctly.'],
              ['Country boost', 'Same fuzzy query with a country parameter — measures the additive boost overhead.'],
              ['Prefix autocomplete', 'Four-character prefix using the B-tree LIKE scan — the fast path for autocomplete UIs.'],
            ].map(([name, desc]) => (
              <div key={name} className="flex gap-3 text-sm">
                <span className="text-zinc-300 font-medium shrink-0 w-44">{name}</span>
                <span className="text-zinc-500">{desc}</span>
              </div>
            ))}
          </div>
          <p className="mt-4">
            The <strong>concurrent burst test</strong> runs 20 workers in parallel — matching the fan-out pattern where one inbound request triggers many parallel entity lookups. Headroom is expressed as a multiple of the 20 QPS burst target.
          </p>
        </Section>

        {/* Stack */}
        <Section title="Stack">
          <div className="grid grid-cols-2 gap-3 mt-1">
            {[
              ['Database', 'Supabase (Postgres 17)'],
              ['Search index', 'pg_trgm GIN (built-in extension)'],
              ['Web app', 'Next.js 14, TypeScript, Tailwind'],
              ['Benchmark client', 'node-postgres (pg), direct connection'],
              ['Data generator', 'Python / psycopg2'],
              ['Region', 'us-east-1 (matches Elastic cluster region)'],
            ].map(([k, v]) => (
              <div key={k} className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3">
                <p className="text-xs text-zinc-500 mb-0.5">{k}</p>
                <p className="text-sm text-zinc-200">{v}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* Caveats */}
        <Section title="Caveats and honest notes">
          <ul className="space-y-1.5 text-sm text-zinc-400">
            <Li>The demo data is <strong className="text-zinc-200">synthetic</strong>. Real company names are more varied — common words like &ldquo;Global Tech&rdquo; appear across many entities in this dataset, which inflates the GIN candidate set and slightly overstates query time for selective real-world queries.</Li>
            <Li>The demo runs at <strong className="text-zinc-200">1/421 scale</strong>. At full scale (421M entities, ~1.5B name rows, ~430GB GIN index), a larger Supabase instance is required — an 8XL (32 cores, 64GB RAM) keeps the working set in <code className="text-zinc-300">shared_buffers</code> and delivers sub-50ms p95 for most query types.</Li>
            <Li>Benchmark latency includes <strong className="text-zinc-200">network RTT</strong> from the Next.js server to Supabase us-east-1. In production (app server co-located with the database) this is negligible.</Li>
          </ul>
        </Section>

      </div>
    </main>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-base font-semibold text-white mb-3 pb-2 border-b border-zinc-800">{title}</h2>
      <div className="text-sm text-zinc-400 leading-relaxed">{children}</div>
    </div>
  )
}

function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3">
      <p className="text-xs font-mono text-[#3ECF8E] mb-1.5">{label}</p>
      <p className="text-sm text-zinc-400">{children}</p>
    </div>
  )
}

function Li({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <span className="text-zinc-600 shrink-0 mt-0.5">·</span>
      <span>{children}</span>
    </li>
  )
}
