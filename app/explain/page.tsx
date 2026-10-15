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

        {/* Cost comparison */}
        <Section title="Cost comparison (421M entities, production scale)">
          <p>
            Elastic bundles compute, storage, IOPS, and throughput into a single consumption line. Supabase bills each separately — the table below breaks it out so the comparison is apples-to-apples.
          </p>

          <div className="mt-4 rounded-lg border border-zinc-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800">
                  <th className="px-4 py-2.5 text-left text-xs text-zinc-500 font-medium">Line item</th>
                  <th className="px-4 py-2.5 text-right text-xs text-zinc-500 font-medium">Elastic Serverless</th>
                  <th className="px-4 py-2.5 text-right text-xs text-[#3ECF8E] font-medium">Supabase 8XL</th>
                  <th className="px-4 py-2.5 text-right text-xs text-zinc-400 font-medium">Supabase 4XL</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Compute', 'bundled', '$1,870/mo  ·  32 vCPU / 128 GB', '$960/mo  ·  16 vCPU / 64 GB'],
                  ['Disk  (~580 GB)', 'bundled', '$74/mo', '$74/mo'],
                  ['IOPS', 'bundled', '3,000 included', '3,000 included'],
                  ['Throughput', 'bundled', '125 MB/s included', '125 MB/s included'],
                ].map(([label, elastic, xl8, xl4]) => (
                  <tr key={label} className="border-t border-zinc-800/60">
                    <td className="px-4 py-2.5 text-xs text-zinc-400 font-medium">{label}</td>
                    <td className="px-4 py-2.5 text-xs text-zinc-500 text-right">{elastic}</td>
                    <td className="px-4 py-2.5 text-xs text-zinc-300 text-right">{xl8}</td>
                    <td className="px-4 py-2.5 text-xs text-zinc-400 text-right">{xl4}</td>
                  </tr>
                ))}
                <tr className="border-t border-zinc-700 bg-zinc-900/60">
                  <td className="px-4 py-3 text-sm font-semibold text-white">Total / month</td>
                  <td className="px-4 py-3 text-sm font-semibold text-zinc-300 text-right">~$2,000</td>
                  <td className="px-4 py-3 text-sm font-semibold text-[#3ECF8E] text-right">~$1,944  <span className="text-xs font-normal text-zinc-500">−3%</span></td>
                  <td className="px-4 py-3 text-sm font-semibold text-zinc-300 text-right">~$1,034  <span className="text-xs font-normal text-zinc-500">−48%</span></td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="mt-4 space-y-3">
            <CostNote label="8XL vs 4XL — which do you need?">
              The GIN index at full scale is ~430 GB. An 8XL (128 GB RAM) keeps ~30–50 GB of the hottest index pages in <code>shared_buffers</code>. For a real-world name search workload, popular companies are searched far more than obscure ones, so hot pages stay warm and cache hit rates are high. A 4XL (64 GB) works at roughly half the compute cost — with more cache misses on tail queries, but still sub-200 ms p50 for warm pages.
            </CostNote>
            <CostNote label="IOPS and throughput — baseline is enough">
              3,000 IOPS and 125 MB/s are included with every instance at no extra charge. At steady state with a warm cache, the benchmark shows near-100% buffer hit rates — actual disk reads drop to near zero. IOPS matter during cold starts (fixed by pg_prewarm) and the initial seed load (one-time write burst). Provisioned IOPS at $0.024/IOPS/mo above 3,000 are rarely needed for this read-heavy workload.
            </CostNote>
            <CostNote label="Scale-out: read replicas over vertical scaling">
              Rather than jumping to a 16XL ($3,730/mo), add a read replica at the same instance size. Two 8XL nodes costs ~$3,888/mo but doubles read throughput, doubles effective cache size, and adds availability — roughly the same price as a single 16XL with a cleaner horizontal growth path.
            </CostNote>
          </div>

          <p className="mt-4 text-xs text-zinc-600">
            Pricing from supabase.com/pricing, October 2026. Disk cost assumes General Purpose storage. Elastic figure is the customer&apos;s actual bill (all-in).
          </p>
        </Section>

        {/* The dataset */}
        <Section title="The dataset">
          <p>
            Each entity has:
          </p>
          <ul className="mt-2 space-y-1.5 text-sm text-zinc-400">
            <Li><strong className="text-zinc-200">Multiple name variants</strong> — a few per company on average, occasionally thousands (abbreviations, historical names, transliterations). In Elasticsearch these are multi-valued fields on a single document; here they are rows in a separate <code className="text-zinc-300">entity_names</code> table.</Li>
            <Li><strong className="text-zinc-200">Non-Latin names</strong> — Chinese, Arabic, Cyrillic, and other scripts. <code className="text-zinc-300">pg_trgm</code> handles Unicode trigrams natively, so no special configuration is needed.</Li>
            <Li><strong className="text-zinc-200">Country field</strong> — used as a ranking boost, not a filter. A search for &ldquo;Acme&rdquo; with country=US returns the same result set as without it, just re-ranked.</Li>
            <Li><strong className="text-zinc-200">Display name</strong> — stored but not indexed, returned in results.</Li>
          </ul>
          <p className="mt-3">
            The demo dataset is sourced from the <strong className="text-zinc-200">GLEIF (Global Legal Entity Identifier Foundation)</strong> registry — real legal entity names from ~200 countries, loaded via the GLEIF public API. Near-100% name uniqueness (as expected from a real registry) means GIN candidate sets are tight and query times reflect what the production workload would actually see.
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
              ['Data source', 'GLEIF LEI registry (~3.2M entities)'],
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
            <Li>The demo loads <strong className="text-zinc-200">GLEIF data (~3.2M active LEI records)</strong>, not the full production 421M-entity corpus. GLEIF covers registered legal entities with LEIs — a high-quality subset. The production index also includes non-LEI entities, unstructured name variants, and historical records not present here.</Li>
            <Li>The demo runs at <strong className="text-zinc-200">sub-scale</strong>. At full scale (421M entities, ~1.5B name rows, ~430 GB GIN index), a larger Supabase instance is required — an 8XL (32 cores, 128 GB RAM) keeps the hot working set in <code className="text-zinc-300">shared_buffers</code> and delivers sub-50 ms p95 for the most common query patterns.</Li>
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

function CostNote({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg px-4 py-3">
      <p className="text-xs font-medium text-zinc-300 mb-1">{label}</p>
      <p className="text-xs text-zinc-500 leading-relaxed">{children}</p>
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
