import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type InstrumentHit } from '../api/client'
import { usePref } from '../prefs'
import { useToasts } from '../state/ui'
import {
  Badge,
  Button,
  Checkbox,
  cx,
  Dropdown,
  EmptyState,
  ErrorText,
  Field,
  IconButton,
  inputClass,
  MenuHeading,
  MenuItem,
  Segmented,
  Select,
  Skeleton,
} from '../ui/kit'
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
import { kindOf } from '../symbols'

type SortKey = 'ticker' | 'close' | 'change_pct'

interface Setup {
  universe: string
  tf: string
  custom: string
  presetId: string | null
  conditions: ScanCondition[]
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
const formatEta = (seconds: number) => (seconds < 60 ? `${seconds}s` : `${Math.ceil(seconds / 60)} min`)
const tfLabel = (t: string) => (t === '1D' ? 'Daily' : t === '1W' ? 'Weekly' : t)

/** Screener in three steps: pick a scan (or build one), pick the stocks,
 * run. Results open on the chart. */
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
    // Stop polling once the job ends, or if the job can't be read any more
    // (e.g. the server restarted) instead of retrying forever.
    refetchInterval: (q) => (q.state.status !== 'error' && q.state.data?.status === 'running' ? 1500 : false),
  })
  const run = useMutation({
    mutationFn: () =>
      api.runScan(setup.universe, setup.tf, setup.conditions, setup.custom.split(/[\s,]+/).filter(Boolean)),
    onSuccess: (started) => setJobId(started.id),
  })
  const cancel = useMutation({
    mutationFn: (id: string) => api.cancelScan(id),
    onSettled: () => job.refetch(),
  })
  const current: ScanJob | undefined = job.data
  // A job that can't be read any more (server restarted, network gone) has
  // ended as far as this screen goes: show the error and offer Run again.
  const jobRunning = current?.status === 'running' && !job.isError
  const running = jobRunning || run.isPending
  // Between "Run" and the job's first progress report.
  const starting = run.isPending || (!!jobId && job.isPending)

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
      <div className="min-h-0 flex-1 overflow-y-auto bg-bg">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-4 md:px-6 md:py-6">
          {catalogQuery.error ? (
            <EmptyState
              title="Couldn’t load the screener"
              action={
                <Button size="sm" onClick={() => catalogQuery.refetch()} loading={catalogQuery.isFetching}>
                  Try again
                </Button>
              }
            >
              {catalogQuery.error.message}
            </EmptyState>
          ) : (
            <>
              <Skeleton className="h-7 w-40" />
              <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
                <Skeleton className="mb-4 h-5 w-48" />
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {Array.from({ length: 6 }, (_, i) => (
                    <Skeleton key={i} className="h-[76px] rounded-xl" />
                  ))}
                </div>
              </div>
              <Skeleton className="h-28 rounded-2xl" />
            </>
          )}
        </div>
      </div>
    )

  const preset = catalog.presets.find((p) => p.id === setup.presetId)
  const groups = [...new Set(catalog.presets.map((p) => p.group ?? 'Other'))]
  const error = (run.error ?? job.error ?? cancel.error)?.message

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-bg">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-4 md:px-6 md:py-6">
        <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h1 className="text-[20px] font-semibold text-fg">Screener</h1>
          <span className="text-[12px] text-muted">{tfLabel(setup.tf)} bars · results open on the chart</span>
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
              <Button size="sm" variant={customizing ? 'soft' : 'ghost'} onClick={() => setCustomizing(!customizing)}>
                {customizing ? 'Done' : 'Customize'}
              </Button>
            </div>
            {!customizing && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {setup.conditions.map((c, i) => (
                  <span key={i} className="rounded-full bg-accent-soft px-2.5 py-1 text-[12px] font-medium text-accent">
                    {describeCondition(c)}
                  </span>
                ))}
                {!setup.conditions.length && <span className="text-[12px] text-muted">No conditions: Customize to add some.</span>}
              </div>
            )}
            {customizing && (
              <div className="mt-3 flex flex-col gap-2">
                {setup.conditions.map((c, i) => (
                  <ConditionCard
                    key={i}
                    condition={c}
                    onChange={(next) => setConditions(setup.conditions.map((x, j) => (j === i ? next : x)))}
                    onRemove={() => setConditions(setup.conditions.filter((_, j) => j !== i))}
                  />
                ))}
                <AddCondition available={catalog.conditions} onAdd={(c) => setConditions([...setup.conditions, c])} />
              </div>
            )}
          </div>
        </Section>

        {/* 2. Stocks */}
        <Section step={2} title="Stocks to scan">
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={setup.universe}
              onChange={(e) => set({ universe: e.target.value })}
              aria-label="Stocks to scan"
              className="flex-1 basis-56"
            >
              {catalog.universes.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
            <Segmented
              value={setup.tf}
              onChange={(tf) => set({ tf })}
              options={catalog.timeframes.map((t) => [t, tfLabel(t)] as const)}
            />
          </div>
          {setup.universe === 'custom' && (
            <textarea
              rows={2}
              placeholder="Tickers, e.g. SBIN, TCS, NIFTY1!, CRUDEOIL1!"
              value={setup.custom}
              onChange={(e) => set({ custom: e.target.value })}
              className={cx(inputClass, 'mt-2 h-auto resize-y py-2')}
            />
          )}
          {setup.universe === MARKET_UNIVERSE && <MarketData />}
        </Section>

        {/* 3. Run */}
        <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-3 border-t border-line bg-bg/95 px-4 py-3 backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:p-0">
          {jobRunning ? (
            <Button size="lg" className="rounded-full px-6" loading={cancel.isPending} onClick={() => cancel.mutate(current.id)}>
              Cancel
            </Button>
          ) : (
            <Button
              size="lg"
              variant="primary"
              className="rounded-full px-6"
              disabled={!setup.conditions.length || running}
              loading={run.isPending}
              onClick={() => run.mutate()}
            >
              {run.isPending ? 'Starting…' : 'Run scan'}
            </Button>
          )}
          {current && (
            <span className="min-w-0 text-[13px] text-muted tabular-nums">
              {jobRunning
                ? `Scanning ${current.done} of ${current.total}${current.eta_seconds !== null ? ` · ~${formatEta(current.eta_seconds)} left` : ''}`
                : current.status === 'done'
                  ? `${current.matches.length} of ${current.total} matched · ${current.elapsed_seconds}s`
                  : current.message || current.status}
            </span>
          )}
          {jobRunning && (
            <div className="h-1 w-full overflow-hidden rounded-full bg-hover">
              <div className="h-full bg-accent transition-all" style={{ width: `${(current.done / Math.max(1, current.total)) * 100}%` }} />
            </div>
          )}
          {error && <ErrorText className="w-full">{error}</ErrorText>}
        </div>

        {/* Results */}
        {(results.length > 0 || starting || jobRunning) && (
          // No overflow-hidden here: the "Add to watchlist" menu opens past the card's edge.
          <div className="rounded-2xl border border-line bg-surface shadow-card">
            <div className="flex min-h-12 items-center gap-2 border-b border-line px-4 py-2">
              {results.length ? (
                <b className="text-[14px] text-fg">{results.length} matches</b>
              ) : (
                <span className="text-[13px] text-muted">Looking for matches…</span>
              )}
              <span className="ml-auto" />
              {current && !jobRunning && results.length > 0 && <AddToWatchlist matches={results} />}
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
                {results.length === 0 &&
                  Array.from({ length: 6 }, (_, i) => (
                    <tr key={i} className="border-t border-line">
                      <td className="px-4 py-3">
                        <Skeleton className="h-3.5 w-24" />
                        <Skeleton className="mt-1.5 h-2.5 w-44 max-w-full" />
                      </td>
                      <td className="px-4 py-3">
                        <Skeleton className="ml-auto h-3.5 w-14" />
                      </td>
                      <td className="px-4 py-3">
                        <Skeleton className="ml-auto h-3.5 w-12" />
                      </td>
                    </tr>
                  ))}
                {results.map((m) => (
                  <tr
                    key={m.symbol}
                    onClick={() => open(m)}
                    className={cx('cursor-pointer border-t border-line transition-colors hover:bg-hover', picked === m.symbol && 'bg-selected')}
                  >
                    <td className="px-4 py-2.5 align-top">
                      <b className="font-semibold text-fg">{m.ticker}</b>
                      {m.industry && <span className="text-muted"> · {m.industry}</span>}
                      {m.details.length > 0 && <div className="mt-0.5 text-[12px] text-muted">{m.details.join(' · ')}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-right align-top text-fg tabular-nums">
                      {m.close.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                    </td>
                    <td className={cx('px-4 py-2.5 text-right align-top font-medium tabular-nums', m.change_pct >= 0 ? 'text-up' : 'text-down')}>
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
          <EmptyState title="No matches" className="rounded-2xl border border-dashed border-line">
            Try another scan, a bigger list, or Customize to loosen a condition.
          </EmptyState>
        )}
        {current && current.errors.length > 0 && (
          <details className="text-[12px] text-muted">
            <summary className="cursor-pointer">{current.errors.length} symbols skipped</summary>
            <div className="mt-1 flex flex-col gap-0.5">
              {current.errors.map((e) => (
                <div key={e}>{e}</div>
              ))}
            </div>
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
      className={cx(
        'flex cursor-pointer flex-col gap-1 rounded-xl border p-3 text-left transition-colors',
        active ? 'border-accent bg-accent-soft' : 'border-line bg-bg hover:border-muted',
      )}
    >
      <span className="flex items-center gap-2">
        <b className={cx('text-[14px] font-semibold', active ? 'text-accent' : 'text-fg')}>{preset.name}</b>
        {preset.evidence && (
          <span title={preset.evidence} className="ml-auto shrink-0">
            <Badge tone={research ? 'up' : 'neutral'} className="text-[10px]">
              {research ? 'Research' : 'Practice'}
            </Badge>
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
      className={cx('cursor-pointer px-4 py-2 font-medium select-none hover:text-fg', num && 'text-right', on && 'text-fg')}
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
  const box = 'mt-3 rounded-xl px-3 py-2.5 text-[13px]'
  if (!s) return status.isPending ? <Skeleton className="mt-3 h-10 rounded-xl" /> : null
  if (s.status === 'running')
    return (
      <div className={cx(box, 'bg-accent-soft text-fg')}>
        <div className="flex flex-wrap justify-between gap-x-3">
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
  const failed = (start.error || s.status === 'error') && (
    <span className="w-full text-[12px] text-down">{start.error?.message ?? s.message}</span>
  )
  if (!s.stored)
    return (
      <div className={cx(box, 'flex flex-wrap items-center gap-3 border border-dashed border-line')}>
        <span className="min-w-0 flex-1 basis-60 text-muted">
          To scan all {s.equities.toLocaleString('en-IN')} NSE stocks, their daily prices are downloaded once (~25 min), then kept current automatically.
        </span>
        <Button size="sm" variant="primary" className="rounded-full" loading={start.isPending} onClick={() => start.mutate()}>
          Download NSE data
        </Button>
        {failed}
      </div>
    )
  return (
    <div className={cx(box, 'flex flex-wrap items-center gap-x-3 gap-y-1 text-muted')}>
      <span>
        <b className="text-fg">{s.liquid.toLocaleString('en-IN')}</b> liquid stocks (price ≥ ₹20, ≥ ₹1 Cr traded a day) of{' '}
        {s.equities.toLocaleString('en-IN')}
        {s.latest_bar && <> · prices to {fmtDate(s.latest_bar)}</>}
      </span>
      <Button size="sm" variant="ghost" className="h-7 px-2 text-accent" loading={start.isPending} onClick={() => start.mutate()}>
        Update now
      </Button>
      {failed}
    </div>
  )
}

/** Append scan results to a watchlist (optimistic, through the shared cache). */
function AddToWatchlist({ matches }: { matches: ScanMatch[] }) {
  const lists = useWatchlists().data ?? []
  const actions = useWatchlistActions()
  const toast = useToasts((t) => t.push)
  const addAll = (id: string, name: string) => {
    actions.addMany(
      id,
      matches.map((m) => ({ symbol: m.symbol, ticker: m.ticker, name: m.name, kind: kindOf(m.symbol) })),
    )
    toast(`Added ${matches.length} to ${name}`)
  }
  return (
    <Dropdown align="right" label={`Add ${matches.length} to watchlist`} title="Add results to a watchlist" buttonClassName="text-accent">
      {(close) => (
        <>
          <MenuHeading>Watchlists</MenuHeading>
          {lists.map((l) => (
            <MenuItem key={l.id} onClick={() => (close(), addAll(l.id, l.name))}>
              {l.name}
            </MenuItem>
          ))}
          <MenuItem
            onClick={async () => {
              close()
              const name = window.prompt('New watchlist name', 'Scan results')?.trim()
              if (!name) return
              try {
                const created = await actions.create(name)
                addAll(created.id, created.name)
              } catch (e) {
                toast((e as Error).message || 'Couldn’t create the list', 'err')
              }
            }}
          >
            <span className="text-accent">+ New list…</span>
          </MenuItem>
        </>
      )}
    </Dropdown>
  )
}

/** "+ Add condition" picker: adds the chosen condition with its defaults. */
export function AddCondition({
  available,
  onAdd,
  label = '+ Add condition',
  className,
}: {
  available: string[]
  onAdd: (c: ScanCondition) => void
  label?: string
  className?: string
}) {
  return (
    <Select
      value=""
      aria-label="Add condition"
      onChange={(e) => {
        const def = CONDITION_DEFS[e.target.value]
        if (def) onAdd({ type: e.target.value, params: { ...def.defaults } })
      }}
      className={cx('border-dashed bg-transparent font-medium text-accent hover:border-accent', className)}
    >
      <option value="">{label}</option>
      {available
        .filter((c) => CONDITION_DEFS[c])
        .map((c) => (
          <option key={c} value={c}>
            {CONDITION_DEFS[c].name}
          </option>
        ))}
    </Select>
  )
}

/** A number box that lets you type freely (blank, "1.", "-") and only
 * reports valid numbers; it shows the stored value again when you leave it. */
export function NumberInput({
  value,
  onChange,
  allowEmpty = false,
  className,
  ...rest
}: {
  value: number | null
  onChange: (v: number | null) => void
  allowEmpty?: boolean
  min?: number
  max?: number
  step?: number
  className?: string
  'aria-label'?: string
}) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <input
      {...rest}
      type="number"
      inputMode="decimal"
      value={draft ?? (value ?? '')}
      onChange={(e) => {
        const raw = e.target.value
        setDraft(raw)
        if (raw === '') {
          if (allowEmpty) onChange(null)
        } else if (Number.isFinite(Number(raw))) onChange(Number(raw))
      }}
      onBlur={() => setDraft(null)}
      className={cx(inputClass, 'tabular-nums', className)}
    />
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
    <div className="@container rounded-xl border border-line bg-surface p-3 shadow-card">
      <div className="mb-2 flex items-center gap-2">
        <b className="min-w-0 flex-1 truncate text-[13px] font-semibold text-fg">{def.name}</b>
        <IconButton label={`Remove ${def.name}`} className="-my-1 -mr-1 size-7 hover:text-down" onClick={onRemove}>
          <svg width="14" height="14" viewBox="0 0 18 18" stroke="currentColor" strokeWidth="1.6" aria-hidden>
            <path d="M4.5 4.5l9 9M13.5 4.5l-9 9" />
          </svg>
        </IconButton>
      </div>
      {def.fields.length > 0 && (
        <div className="grid grid-cols-1 gap-x-3 gap-y-2.5 @[300px]:grid-cols-2">
          {def.fields.map((f) =>
            f.kind === 'bool' ? (
              <div key={f.key} className="flex items-end pb-2.5">
                <Checkbox label={f.label} checked={Boolean(params[f.key])} onChange={(v) => set(f.key, v)} />
              </div>
            ) : (
              <Field key={f.key} label={f.label}>
                {f.kind === 'select' ? (
                  <Select value={String(params[f.key])} onChange={(e) => set(f.key, e.target.value)} className="h-9">
                    {f.options.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <NumberInput
                    value={Number(params[f.key])}
                    min={f.min}
                    max={f.max}
                    step={f.step ?? (f.kind === 'int' ? 1 : 0.1)}
                    onChange={(v) => v !== null && set(f.key, v)}
                    className="h-9"
                  />
                )}
              </Field>
            ),
          )}
        </div>
      )}
    </div>
  )
}
