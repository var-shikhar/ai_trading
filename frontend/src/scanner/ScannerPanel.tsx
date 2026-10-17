import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type InstrumentHit, type InstrumentKind } from '../api/client'
import { usePref } from '../prefs'
import { Dropdown } from '../ui/Dropdown'
import { useWatchlistActions, useWatchlists } from '../watchlist/queries'
import {
  CONDITION_DEFS,
  MARKET_UNIVERSE,
  describeCondition,
  type MarketStatus,
  type ScanCondition,
  type ScanJob,
  type ScanMatch,
  type ScanPreset,
} from './types'

type SortKey = 'ticker' | 'close' | 'change_pct'

interface Setup {
  universe: string
  tf: string
  custom: string
  presetId: string | null
  conditions: ScanCondition[]
}

const kindOf = (s: string): InstrumentKind => (s.startsWith('MCX:') ? 'COM' : s.endsWith('-INDEX') ? 'INDEX' : 'EQ')
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
const formatEta = (seconds: number) => (seconds < 60 ? `${seconds}s` : `${Math.ceil(seconds / 60)} min`)

/** Screener in three steps: pick a scan (or build one), pick the stocks,
 * run. Results open on the chart. Tailwind + TanStack Query. */
export function ScannerPanel({ onOpen }: { onOpen: (s: InstrumentHit) => void }) {
  const catalogQuery = useQuery({ queryKey: ['scanner', 'catalog'], queryFn: api.scannerCatalog, staleTime: Infinity })
  const catalog = catalogQuery.data
  const [setup, setSetup] = usePref<Setup>('scannerSetup', {
    universe: MARKET_UNIVERSE,
    tf: '1D',
    custom: '',
    presetId: null,
    conditions: [],
  })
  const [customizing, setCustomizing] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'change_pct', desc: true })
  const [picked, setPicked] = useState<string | null>(null)

  const set = (patch: Partial<Setup>) => setSetup((s) => ({ ...s, ...patch }))
  const choosePreset = (p: ScanPreset) => {
    set({ presetId: p.id, conditions: p.conditions })
    setCustomizing(false)
  }
  const setConditions = (conditions: ScanCondition[]) => set({ conditions, presetId: null })

  // First visit: start from the first scan.
  const presets = catalog?.presets
  useEffect(() => {
    if (presets?.length) setSetup((s) => (s.conditions.length ? s : { ...s, presetId: presets[0].id, conditions: presets[0].conditions }))
  }, [presets, setSetup])

  const job = useQuery({
    queryKey: ['scanner', 'job', jobId],
    queryFn: () => api.scanJob(jobId!),
    enabled: !!jobId,
    refetchInterval: (q) => (q.state.data?.status === 'running' ? 1500 : false),
  })
  const run = useMutation({
    mutationFn: () =>
      api.runScan(setup.universe, setup.tf, setup.conditions, setup.custom.split(/[\s,]+/).filter(Boolean)),
    onSuccess: (started) => setJobId(started.id),
  })
  const cancel = useMutation({ mutationFn: (id: string) => api.cancelScan(id) })
  const current: ScanJob | undefined = job.data
  const running = current?.status === 'running' || run.isPending

  const results = useMemo(() => {
    const list = [...(current?.matches ?? [])]
    list.sort((a, b) => {
      const v = sort.key === 'ticker' ? a.ticker.localeCompare(b.ticker) : a[sort.key] - b[sort.key]
      return sort.desc ? -v : v
    })
    return list
  }, [current, sort])

  const open = (m: ScanMatch) => {
    setPicked(m.symbol)
    onOpen({ symbol: m.symbol, ticker: m.ticker, name: m.name, kind: kindOf(m.symbol) })
  }

  if (!catalog)
    return (
      <div className="tw flex flex-1 items-center justify-center text-muted">
        {catalogQuery.error ? <span className="text-down">{catalogQuery.error.message}</span> : 'Loading…'}
      </div>
    )

  const preset = catalog.presets.find((p) => p.id === setup.presetId)
  const groups = [...new Set(catalog.presets.map((p) => p.group ?? 'Other'))]
  const error = (run.error ?? job.error)?.message

  return (
    <div className="tw min-h-0 flex-1 overflow-y-auto bg-bg">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-4 md:px-6 md:py-6">
        <header className="flex items-baseline justify-between">
          <h1 className="text-[20px] font-semibold text-fg">Screener</h1>
          <span className="text-[12px] text-muted">Daily bars · results open on the chart</span>
        </header>

        {/* 1. Scan */}
        <Section step={1} title="Choose a scan">
          <div className="flex flex-col gap-3">
            {groups.map((g) => (
              <div key={g}>
                <div className="mb-1.5 text-[11px] font-semibold tracking-wider text-muted uppercase">{g}</div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {catalog.presets
                    .filter((p) => (p.group ?? 'Other') === g)
                    .map((p) => (
                      <PresetCard key={p.id} preset={p} active={p.id === setup.presetId} onPick={() => choosePreset(p)} />
                    ))}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-xl border border-line bg-bg p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12px] font-semibold text-muted">
                {preset ? `${preset.name}:` : 'Custom scan:'} all must match
              </span>
              <span className="ml-auto" />
              <button
                onClick={() => setCustomizing(!customizing)}
                className="cursor-pointer rounded-md px-2 py-1 text-[13px] font-medium text-accent hover:bg-accent-soft"
              >
                {customizing ? 'Done' : 'Customize'}
              </button>
            </div>
            {!customizing && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {setup.conditions.map((c, i) => (
                  <span key={i} className="rounded-full bg-accent-soft px-2.5 py-1 text-[12px] font-medium text-accent">
                    {describeCondition(c)}
                  </span>
                ))}
              </div>
            )}
            {customizing && (
              // The condition editor is the older styled component (not .tw).
              <div className="mt-2 conditions-host">
                <div className="conditions">
                  {setup.conditions.map((c, i) => (
                    <ConditionCard
                      key={i}
                      condition={c}
                      onChange={(next) => setConditions(setup.conditions.map((x, j) => (j === i ? next : x)))}
                      onRemove={() => setConditions(setup.conditions.filter((_, j) => j !== i))}
                    />
                  ))}
                  <select
                    className="add-condition"
                    value=""
                    onChange={(e) => {
                      const def = CONDITION_DEFS[e.target.value]
                      if (def) setConditions([...setup.conditions, { type: e.target.value, params: { ...def.defaults } }])
                    }}
                    aria-label="Add condition"
                  >
                    <option value="">+ Add condition</option>
                    {catalog.conditions
                      .filter((c) => CONDITION_DEFS[c])
                      .map((c) => (
                        <option key={c} value={c}>
                          {CONDITION_DEFS[c].name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
            )}
          </div>
        </Section>

        {/* 2. Stocks */}
        <Section step={2} title="Stocks to scan">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={setup.universe}
              onChange={(e) => set({ universe: e.target.value })}
              aria-label="Stocks to scan"
              className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-[14px] text-fg"
            >
              {catalog.universes.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
            <div className="flex overflow-hidden rounded-lg border border-line" role="group" aria-label="Timeframe">
              {catalog.timeframes.map((t) => (
                <button
                  key={t}
                  onClick={() => set({ tf: t })}
                  className={`cursor-pointer px-3 py-2 text-[13px] font-medium ${
                    setup.tf === t ? 'bg-accent text-accent-fg' : 'text-muted hover:bg-hover'
                  }`}
                >
                  {t === '1D' ? 'Daily' : t === '1W' ? 'Weekly' : t}
                </button>
              ))}
            </div>
          </div>
          {setup.universe === 'custom' && (
            <textarea
              rows={2}
              placeholder="Tickers, e.g. SBIN, TCS, NIFTY1!, CRUDEOIL1!"
              value={setup.custom}
              onChange={(e) => set({ custom: e.target.value })}
              className="mt-2 w-full rounded-lg border border-line bg-bg px-3 py-2 text-[14px] text-fg"
            />
          )}
          {setup.universe === MARKET_UNIVERSE && <MarketData />}
        </Section>

        {/* 3. Run */}
        <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-3 border-t border-line bg-bg/95 px-4 py-3 backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:p-0">
          {current?.status === 'running' ? (
            <button
              onClick={() => cancel.mutate(current.id)}
              className="cursor-pointer rounded-full border border-line px-6 py-2.5 text-[14px] font-semibold text-fg"
            >
              Cancel
            </button>
          ) : (
            <button
              disabled={!setup.conditions.length || running}
              onClick={() => run.mutate()}
              className="cursor-pointer rounded-full bg-accent px-6 py-2.5 text-[14px] font-semibold text-accent-fg shadow-card disabled:opacity-50"
            >
              {run.isPending ? 'Starting…' : 'Run scan'}
            </button>
          )}
          {current && (
            <span className="text-[13px] text-muted">
              {current.status === 'running'
                ? `Scanning ${current.done} of ${current.total}${current.eta_seconds !== null ? ` · ~${formatEta(current.eta_seconds)} left` : ''}`
                : current.status === 'done'
                  ? `${current.matches.length} of ${current.total} matched · ${current.elapsed_seconds}s`
                  : current.message || current.status}
            </span>
          )}
          {current?.status === 'running' && (
            <div className="h-1 w-full overflow-hidden rounded-full bg-hover">
              <div className="h-full bg-accent transition-all" style={{ width: `${(current.done / Math.max(1, current.total)) * 100}%` }} />
            </div>
          )}
          {error && <p className="w-full text-[13px] text-down">{error}</p>}
        </div>

        {/* Results */}
        {current && results.length > 0 && (
          <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
            <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
              <b className="text-[14px] text-fg">{results.length} matches</b>
              <span className="ml-auto" />
              {current.status !== 'running' && <AddToWatchlist matches={results} />}
            </div>
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="text-left text-[12px] text-muted">
                  <SortHeader label="Symbol" k="ticker" sort={sort} onSort={setSort} />
                  <SortHeader label="Close" k="close" sort={sort} onSort={setSort} num />
                  <SortHeader label="Chg %" k="change_pct" sort={sort} onSort={setSort} num />
                </tr>
              </thead>
              <tbody>
                {results.map((m) => (
                  <tr
                    key={m.symbol}
                    onClick={() => open(m)}
                    className={`cursor-pointer border-t border-line hover:bg-hover ${picked === m.symbol ? 'bg-selected' : ''}`}
                  >
                    <td className="px-4 py-2.5 align-top">
                      <b className="font-semibold text-fg">{m.ticker}</b>
                      {m.industry && <span className="text-muted"> · {m.industry}</span>}
                      <div className="mt-0.5 text-[12px] text-muted">{m.details.join(' · ')}</div>
                    </td>
                    <td className="px-4 py-2.5 text-right align-top tabular-nums text-fg">
                      {m.close.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                    </td>
                    <td className={`px-4 py-2.5 text-right align-top font-medium tabular-nums ${m.change_pct >= 0 ? 'text-up' : 'text-down'}`}>
                      {m.change_pct >= 0 ? '+' : ''}
                      {m.change_pct.toFixed(2)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {current?.status === 'done' && results.length === 0 && (
          <p className="rounded-xl border border-dashed border-line p-6 text-center text-muted">
            No matches today. Try another scan, a bigger list, or Customize to loosen a condition.
          </p>
        )}
        {current && current.errors.length > 0 && (
          <details className="text-[12px] text-muted">
            <summary className="cursor-pointer">{current.errors.length} symbols skipped</summary>
            {current.errors.map((e) => (
              <div key={e}>{e}</div>
            ))}
          </details>
        )}
      </div>
    </div>
  )
}

function Section({ step, title, children }: { step: number; title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-4 shadow-card">
      <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-fg">
        <span className="flex size-6 items-center justify-center rounded-full bg-accent-soft text-[12px] text-accent">{step}</span>
        {title}
      </h2>
      {children}
    </section>
  )
}

function PresetCard({ preset, active, onPick }: { preset: ScanPreset; active: boolean; onPick: () => void }) {
  const research = preset.evidence?.startsWith('Research')
  return (
    <button
      onClick={onPick}
      aria-pressed={active}
      className={`flex cursor-pointer flex-col gap-1 rounded-xl border p-3 text-left transition-colors ${
        active ? 'border-accent bg-accent-soft' : 'border-line bg-bg hover:border-muted'
      }`}
    >
      <span className="flex items-center gap-2">
        <b className={`text-[14px] font-semibold ${active ? 'text-accent' : 'text-fg'}`}>{preset.name}</b>
        {preset.evidence && (
          <span
            title={preset.evidence}
            className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              research ? 'bg-up-soft text-up' : 'bg-hover text-muted'
            }`}
          >
            {research ? 'Research' : 'Practice'}
          </span>
        )}
      </span>
      <span className="text-[12px] leading-snug text-muted">{preset.description}</span>
    </button>
  )
}

function SortHeader({
  label,
  k,
  sort,
  onSort,
  num,
}: {
  label: string
  k: SortKey
  sort: { key: SortKey; desc: boolean }
  onSort: (s: { key: SortKey; desc: boolean }) => void
  num?: boolean
}) {
  const on = sort.key === k
  return (
    <th
      aria-sort={on ? (sort.desc ? 'descending' : 'ascending') : 'none'}
      onClick={() => onSort({ key: k, desc: on ? !sort.desc : k !== 'ticker' })}
      className={`cursor-pointer px-4 py-2 font-medium select-none ${num ? 'text-right' : ''} ${on ? 'text-fg' : ''}`}
    >
      {label}
      {on ? (sort.desc ? ' ▾' : ' ▴') : ''}
    </th>
  )
}

/** Status of the whole-NSE data, with the one-time download. */
function MarketData() {
  const qc = useQueryClient()
  const status = useQuery({
    queryKey: ['scanner', 'market'],
    queryFn: api.marketStatus,
    refetchInterval: (q) => (q.state.data?.status === 'running' ? 3000 : 60_000),
  })
  const start = useMutation({
    mutationFn: api.startMarketSync,
    onSuccess: (s) => qc.setQueryData<MarketStatus>(['scanner', 'market'], s),
  })
  const s = status.data
  if (!s) return null
  const box = 'mt-3 rounded-xl px-3 py-2.5 text-[13px]'
  if (s.status === 'running')
    return (
      <div className={`${box} bg-accent-soft text-fg`}>
        <div className="flex justify-between">
          <span>
            {s.phase === 'today' ? 'Updating today’s prices' : 'Downloading daily history'} · {s.done} of {s.total}
          </span>
          {s.eta_seconds !== null && <span className="text-muted">~{formatEta(s.eta_seconds)} left</span>}
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-hover">
          <div className="h-full bg-accent transition-all" style={{ width: `${(s.done / Math.max(1, s.total)) * 100}%` }} />
        </div>
        <p className="mt-1.5 text-[12px] text-muted">Runs on the server: you can leave this page. Once done, it refreshes itself after each close.</p>
      </div>
    )
  if (!s.stored)
    return (
      <div className={`${box} flex flex-wrap items-center gap-3 border border-dashed border-line`}>
        <span className="min-w-0 flex-1 text-muted">
          To scan all {s.equities.toLocaleString('en-IN')} NSE stocks, their daily prices are downloaded once (~25 min), then kept current automatically.
        </span>
        <button
          disabled={start.isPending}
          onClick={() => start.mutate()}
          className="cursor-pointer rounded-full bg-accent px-4 py-2 text-[13px] font-semibold text-accent-fg disabled:opacity-50"
        >
          Download NSE data
        </button>
        {(start.error || s.status === 'error') && (
          <span className="w-full text-[12px] text-down">{start.error?.message ?? s.message}</span>
        )}
      </div>
    )
  return (
    <div className={`${box} flex flex-wrap items-center gap-x-3 gap-y-1 text-muted`}>
      <span>
        <b className="text-fg">{s.liquid.toLocaleString('en-IN')}</b> liquid stocks (price ≥ ₹20, ≥ ₹1 Cr traded a day) of{' '}
        {s.equities.toLocaleString('en-IN')}
        {s.latest_bar && <> · prices to {fmtDate(s.latest_bar)}</>}
      </span>
      <button onClick={() => start.mutate()} disabled={start.isPending} className="cursor-pointer text-accent">
        Update now
      </button>
      {(start.error || s.status === 'error') && <span className="w-full text-[12px] text-down">{start.error?.message ?? s.message}</span>}
    </div>
  )
}

/** Append scan results to a watchlist (optimistic, through the shared cache). */
function AddToWatchlist({ matches }: { matches: ScanMatch[] }) {
  const lists = useWatchlists().data ?? []
  const actions = useWatchlistActions()
  const [saved, setSaved] = useState<string | null>(null)
  const addAll = (id: string, name: string) => {
    actions.addMany(
      id,
      matches.map((m) => ({ symbol: m.symbol, ticker: m.ticker, name: m.name, kind: kindOf(m.symbol) })),
    )
    setSaved(`Added to ${name}`)
  }
  return (
    <span className="flex items-center gap-2">
      {saved && <span className="text-[12px] text-up">{saved}</span>}
      <Dropdown label={`Add ${matches.length} to watchlist`} title="Add results to a watchlist">
        {(close) => (
          <div className="menu-list">
            {lists.map((l) => (
              <div key={l.id} className="menu-item">
                <button className="menu-main" onClick={() => (close(), addAll(l.id, l.name))}>
                  {l.name}
                </button>
              </div>
            ))}
            <div className="menu-item">
              <button
                className="menu-main"
                onClick={async () => {
                  close()
                  const name = window.prompt('New watchlist name', 'Scan results')?.trim()
                  if (name) {
                    const created = await actions.create(name)
                    addAll(created.id, created.name)
                  }
                }}
              >
                New list…
              </button>
            </div>
          </div>
        )}
      </Dropdown>
    </span>
  )
}

export function ConditionCard({
  condition,
  onChange,
  onRemove,
}: {
  condition: ScanCondition
  onChange: (c: ScanCondition) => void
  onRemove: () => void
}) {
  const def = CONDITION_DEFS[condition.type]
  if (!def) return null
  const params = { ...def.defaults, ...condition.params }
  const set = (key: string, value: number | string | boolean) => onChange({ ...condition, params: { ...params, [key]: value } })
  return (
    <div className="condition-card">
      <div className="condition-head">
        <b>{def.name}</b>
        <button className="icon-button" aria-label={`Remove ${def.name}`} onClick={onRemove}>
          <svg width="14" height="14" viewBox="0 0 18 18" stroke="currentColor" strokeWidth="1.5" aria-hidden>
            <path d="M4.5 4.5l9 9M13.5 4.5l-9 9" />
          </svg>
        </button>
      </div>
      <div className="condition-fields">
        {def.fields.map((f) => (
          <label key={f.key}>
            <span>{f.label}</span>
            {f.kind === 'select' ? (
              <select value={String(params[f.key])} onChange={(e) => set(f.key, e.target.value)}>
                {f.options.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            ) : f.kind === 'bool' ? (
              <input type="checkbox" checked={Boolean(params[f.key])} onChange={(e) => set(f.key, e.target.checked)} />
            ) : (
              <input
                type="number"
                value={Number(params[f.key])}
                min={f.min}
                max={f.max}
                step={f.step ?? (f.kind === 'int' ? 1 : 0.1)}
                onChange={(e) => set(f.key, Number(e.target.value))}
              />
            )}
          </label>
        ))}
      </div>
    </div>
  )
}
