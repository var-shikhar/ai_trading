import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type InstrumentHit, type Strategy } from '../api/client'
import type { ChartTheme } from '../chart/theme'
import { formatBarTime } from '../chart/format'
import { usePref } from '../prefs'
import { AddCondition, ConditionCard, NumberInput } from '../scanner/ScannerPanel'
import { useToasts } from '../state/ui'
import { Button, cx, EmptyState, ErrorText, Field, Input, Segmented, Select, Skeleton, Tabs } from '../ui/kit'
import { EquityChart } from './EquityChart'
import { StrategyTemplates } from './templates'
import {
  num,
  pct,
  RULE_KEYS,
  tone,
  toneClass,
  type BacktestHistoryItem,
  type BacktestJob,
  type BacktestRequest,
  type BacktestResult,
  type BacktestSummary,
  type BacktestTrade,
  type StrategyRules,
  inr,
} from './types'

type Tab = 'setup' | 'results' | 'trades' | 'history'

const HISTORY = ['backtests', 'history']
const STRATEGIES = ['strategies']
const isRunning = (j: BacktestJob | undefined) => j?.status === 'loading' || j?.status === 'simulating'

const defaultRequest = (): BacktestRequest => ({
  name: 'Breakout swing',
  universe: 'nifty50',
  symbol: null,
  custom: [],
  tf: '1D',
  start: `${new Date().getFullYear() - 5}-01-01`,
  end: null,
  side: 'long',
  entry: [
    { type: 'breakout', params: { direction: 'up', bars: 15, pct: 6 } },
    { type: 'price_vs_ma', params: { op: 'above', ma: 'ema', length: 200 } },
  ],
  exit_conditions: [],
  stop_type: 'atr',
  stop_value: 2,
  target_type: 'r',
  target_value: 2,
  trail_type: 'none',
  trail_value: 0,
  max_bars: 40,
  sizing: 'risk',
  size_value: 1,
  capital: 1_000_000,
  max_positions: 10,
  // ≈0.25% round trip for delivery (STT 0.1% each side, stamp duty,
  // exchange/SEBI fees, GST, brokerage, DP charge), plus slippage.
  cost_pct: 0.12,
  slippage_pct: 0.05,
})

/** Strategy Lab: portfolio backtests over a list of symbols, saved to history.
 * (One chart's strategy runs live on the chart instead: see ChartStrategy.) */
export function StrategyTester({
  chartSymbol,
  theme,
  onOpenTrade,
}: {
  chartSymbol: InstrumentHit
  theme: ChartTheme
  onOpenTrade: (trade: BacktestTrade, all: BacktestTrade[]) => void
}) {
  const qc = useQueryClient()
  const toast = useToasts((t) => t.push)
  const [tab, setTab] = useState<Tab>('setup')
  const [req, setReq] = usePref<BacktestRequest>('backtestSetup', defaultRequest)
  const [jobId, setJobId] = useState<string | null>(null)
  const [resultId, setResultId] = useState<string | null>(null)
  // Jobs whose finish was already handled (a refetch of a done job mustn't jump tabs again).
  const finished = useRef(new Set<string>())

  const catalog = useQuery({ queryKey: ['backtests', 'catalog'], queryFn: api.backtestCatalog, staleTime: Infinity })
  const history = useQuery({ queryKey: HISTORY, queryFn: api.backtests })
  const result = useQuery({
    queryKey: ['backtests', 'result', resultId],
    queryFn: () => api.backtestResult(resultId!),
    enabled: !!resultId,
    staleTime: Infinity,
  })
  const job = useQuery({
    queryKey: ['backtests', 'job', jobId],
    queryFn: async () => {
      const j = await api.backtestJob(jobId!)
      if (j.status === 'done' && j.result_id && !finished.current.has(j.id)) {
        finished.current.add(j.id)
        setResultId(j.result_id)
        setTab('results')
        qc.invalidateQueries({ queryKey: HISTORY })
      }
      return j
    },
    enabled: !!jobId,
    // Poll only while the job runs; a failed poll stops it (shown as an error).
    refetchInterval: (q) => (q.state.status !== 'error' && isRunning(q.state.data) ? 1200 : false),
  })
  const run = useMutation({
    mutationFn: () => api.runBacktest({ ...req, symbol: req.universe === 'symbol' ? chartSymbol.symbol : null }),
    onSuccess: (started) => {
      qc.setQueryData(['backtests', 'job', started.id], started)
      setJobId(started.id)
    },
  })
  const cancel = useMutation({
    mutationFn: (id: string) => api.cancelBacktest(id),
    onSettled: () => job.refetch(),
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteBacktest(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: HISTORY })
      const prev = qc.getQueryData<BacktestHistoryItem[]>(HISTORY)
      qc.setQueryData<BacktestHistoryItem[]>(HISTORY, (h) => h?.filter((x) => x.id !== id))
      return { prev }
    },
    onError: (e, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(HISTORY, ctx.prev)
      toast(`Couldn’t delete: ${e.message}`, 'err')
    },
    onSettled: () => qc.invalidateQueries({ queryKey: HISTORY }),
  })

  const set = (patch: Partial<BacktestRequest>) => setReq((r) => ({ ...r, ...patch }))
  const j = job.data
  const running = isRunning(j) && job.status !== 'error'
  const r = result.data
  const error = (run.error ?? job.error ?? cancel.error ?? catalog.error)?.message

  const resultsBody = (content: (r: BacktestResult) => ReactNode, empty: ReactNode) =>
    r ? (
      content(r)
    ) : resultId && result.isPending ? (
      <ResultsSkeleton />
    ) : result.error ? (
      <ErrorText>{result.error.message}</ErrorText>
    ) : running ? (
      <RunningCard job={j!} />
    ) : (
      empty
    )

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-bg" aria-label="Strategy Lab">
      <header className="shrink-0 border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 pt-3 md:px-6">
          <h1 className="text-[20px] font-semibold text-fg">Strategy Lab</h1>
          <span className="flex-1" />
          {running && j && (
            <span className="text-[12px] text-muted tabular-nums">
              {j.status === 'loading' ? `Loading data ${j.loaded}/${j.total}` : 'Simulating…'} · {j.elapsed_seconds}s
            </span>
          )}
          {j?.status === 'cancelled' && <span className="text-[12px] text-muted">Cancelled</span>}
          {running && j ? (
            <Button size="sm" loading={cancel.isPending} onClick={() => cancel.mutate(j.id)}>
              Cancel
            </Button>
          ) : (
            <Button size="sm" variant="primary" loading={run.isPending} disabled={!req.entry.length} onClick={() => run.mutate()}>
              Run backtest
            </Button>
          )}
        </div>
        <Tabs
          className="mx-auto max-w-6xl px-2 md:px-4"
          value={tab}
          onChange={setTab}
          items={[
            { id: 'setup', label: 'Setup' },
            { id: 'results', label: 'Results' },
            { id: 'trades', label: 'Trades', badge: r ? r.trades.length : undefined },
            { id: 'history', label: 'History', badge: history.data?.length || undefined },
          ]}
        />
        {running && j && (
          <div className="h-0.5 w-full overflow-hidden bg-hover">
            <div
              className={cx('h-full bg-accent transition-all', j.status === 'simulating' && 'animate-pulse')}
              style={{ width: j.status === 'simulating' ? '100%' : `${(j.loaded / Math.max(1, j.total)) * 100}%` }}
            />
          </div>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4 md:px-6 md:py-5">
          {error && <ErrorText>{error}</ErrorText>}
          {j?.status === 'error' && <ErrorText>{j.message || 'The backtest failed.'}</ErrorText>}

          {tab === 'setup' &&
            (catalog.data ? (
              <Setup req={req} set={set} conditions={catalog.data.conditions} universes={catalog.data.universes} chartSymbol={chartSymbol} />
            ) : catalog.isPending ? (
              <SetupSkeleton />
            ) : null)}

          {tab === 'results' &&
            resultsBody(
              (r) => <Results result={r} theme={theme} />,
              <EmptyState
                title="No results yet"
                action={
                  <Button variant="primary" size="sm" loading={run.isPending} disabled={!req.entry.length} onClick={() => run.mutate()}>
                    Run backtest
                  </Button>
                }
              >
                Run a backtest, or open one from History.
              </EmptyState>,
            )}

          {tab === 'trades' &&
            resultsBody(
              (r) => <Trades trades={r.trades} tf={r.request.tf} onOpen={(tr) => onOpenTrade(tr, r.trades)} />,
              <EmptyState title="No trades yet">Run a backtest to list its trades.</EmptyState>,
            )}

          {tab === 'history' && (
            <History
              items={history.data}
              loading={history.isPending}
              error={history.error?.message}
              activeId={resultId}
              onOpen={(id) => {
                setResultId(id)
                setTab('results')
              }}
              onReuse={(item) => {
                setReq({ ...defaultRequest(), ...item.request })
                setTab('setup')
              }}
              onDelete={(id) => remove.mutate(id)}
            />
          )}
        </div>
      </div>
    </section>
  )
}

function RunningCard({ job }: { job: BacktestJob }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-[13px] text-muted">
        {job.status === 'loading' ? `Loading data for ${job.loaded} of ${job.total} symbols…` : 'Simulating trades…'}
      </div>
      <ResultsSkeleton />
    </div>
  )
}

function ResultsSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy>
      <div className={KPI_GRID}>
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-[62px] rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-[300px] rounded-2xl" />
    </div>
  )
}

function SetupSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" aria-busy>
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} className="h-44 rounded-2xl" />
      ))}
    </div>
  )
}

// --- setup ---------------------------------------------------------------------------

/** A titled card of the setup form. */
function Card({ title, hint, children, className }: { title: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('@container rounded-2xl border border-line bg-surface p-4 shadow-card', className)}>
      <h3 className="text-[14px] font-semibold text-fg">{title}</h3>
      {hint && <p className="mt-0.5 text-[12px] leading-snug text-muted">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}

/** Form fields: one column in narrow panels, up to three when there's room. */
const FORM_GRID = 'grid grid-cols-1 gap-3 @[300px]:grid-cols-2 @[560px]:grid-cols-3'

function Setup({
  req,
  set,
  conditions,
  universes,
  chartSymbol,
}: {
  req: BacktestRequest
  set: (p: Partial<BacktestRequest>) => void
  conditions: string[]
  universes: { id: string; name: string }[]
  chartSymbol: InstrumentHit
}) {
  return (
    <div className="flex flex-col gap-4">
      <StrategyTemplates current={req.name} onPick={(t) => set({ ...t.rules, name: t.name, strategy_id: null })} />
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <StrategyBar value={req} set={set} keys={RULE_KEYS} />
          <Card title="Market" hint="Index lists use today’s members, so older years carry survivorship bias.">
            <div className={FORM_GRID}>
              <Field label="Name">
                <Input value={req.name} onChange={(e) => set({ name: e.target.value })} />
              </Field>
              <Field label="Symbols">
                <Select value={req.universe} onChange={(e) => set({ universe: e.target.value })}>
                  {universes.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.id === 'symbol' ? `Chart symbol (${chartSymbol.ticker})` : u.name}
                    </option>
                  ))}
                </Select>
              </Field>
              {req.universe === 'custom' && (
                <Field label="Tickers" className="@[300px]:col-span-2">
                  <Input
                    defaultValue={req.custom.join(', ')}
                    placeholder="SBIN, TCS, NIFTY1!"
                    onChange={(e) => set({ custom: e.target.value.split(/[\s,]+/).filter(Boolean) })}
                  />
                </Field>
              )}
              {/* Not a <label>: clicking its caption would press the first button. */}
              <div className="flex min-w-0 flex-col gap-1.5">
                <span className="text-[12px] font-medium text-muted">Timeframe</span>
                <Segmented
                  value={req.tf}
                  onChange={(tf) => set({ tf })}
                  options={[
                    ['1D', 'Daily'],
                    ['1W', 'Weekly'],
                  ]}
                  className="h-10 w-full items-stretch"
                />
              </div>
              <Field label="From">
                <Input type="date" value={req.start} min="2000-01-01" onChange={(e) => e.target.value && set({ start: e.target.value })} />
              </Field>
              <Field label="To (blank = today)">
                <Input type="date" value={req.end ?? ''} onChange={(e) => set({ end: e.target.value || null })} />
              </Field>
              <NumberField label="Capital ₹" value={req.capital} step={10000} min={1000} onChange={(capital) => capital !== null && set({ capital })} />
              <NumberField
                label="Max open positions"
                value={req.max_positions}
                step={1}
                min={1}
                onChange={(v) => v !== null && set({ max_positions: Math.max(1, Math.round(v)) })}
              />
            </div>
          </Card>
        </div>
        <div className="flex flex-col gap-4">
          <RulesEditor rules={req} set={set} conditions={conditions} />
        </div>
      </div>
    </div>
  )
}

export function NumberField({
  label,
  value,
  onChange,
  step = 0.1,
  min = 0,
  allowEmpty = false,
}: {
  label: string
  value: number | null
  onChange: (v: number | null) => void
  step?: number
  min?: number
  /** Report a cleared box as null (e.g. "blank = never"); otherwise a blank isn't reported. */
  allowEmpty?: boolean
}) {
  return (
    <Field label={label}>
      <NumberInput value={value} step={step} min={min} allowEmpty={allowEmpty} onChange={onChange} />
    </Field>
  )
}

function SelectField<V extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: V
  onChange: (v: V) => void
  options: [V, string][]
}) {
  return (
    <Field label={label}>
      <Select value={value} onChange={(e) => onChange(e.target.value as V)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </Select>
    </Field>
  )
}

/** Entry/exit conditions, stops, targets, sizing and costs: the rules of a
 * strategy. Shared by the Strategy Lab and the strategy applied to the chart. */
export function RulesEditor<T extends StrategyRules>({
  rules,
  set,
  conditions,
  flat = false,
}: {
  rules: T
  set: (p: Partial<T>) => void
  conditions: string[]
  /** Sections as plain blocks with dividers (narrow side panels) instead of cards. */
  flat?: boolean
}) {
  const patch = (p: Partial<StrategyRules>) => set(p as Partial<T>)
  const Section = flat ? FlatSection : Card
  const conditionList = (key: 'entry' | 'exit_conditions', label: string, hint: string) => (
    <Section title={label} hint={hint}>
      <div className="flex flex-col gap-2">
        {rules[key].map((c, i) => (
          <ConditionCard
            key={i}
            condition={c}
            onChange={(next) => patch({ [key]: rules[key].map((x, j) => (j === i ? next : x)) })}
            onRemove={() => patch({ [key]: rules[key].filter((_, j) => j !== i) })}
          />
        ))}
        <AddCondition
          available={conditions}
          label="+ Add condition (all must match)"
          onAdd={(c) => patch({ [key]: [...rules[key], c] })}
        />
      </div>
    </Section>
  )
  const numField = (key: keyof StrategyRules, label: string, step = 0.1, min = 0, allowEmpty = false) => (
    <NumberField
      label={label}
      value={rules[key] as number | null}
      step={step}
      min={min}
      allowEmpty={allowEmpty}
      onChange={(v) => (allowEmpty || v !== null) && patch({ [key]: v } as Partial<StrategyRules>)}
    />
  )

  return (
    <>
      <Section title="Direction">
        <Segmented
          value={rules.side}
          onChange={(side) => patch({ side })}
          options={[
            ['long', 'Long'],
            ['short', 'Short'],
          ]}
        />
      </Section>
      {conditionList('entry', 'Entry', 'Signal on a bar’s close; the trade opens at the next bar’s open.')}

      <Section title="Exits">
        <div className={FORM_GRID}>
          <SelectField
            label="Stop"
            value={rules.stop_type}
            onChange={(stop_type) => patch({ stop_type })}
            options={[
              ['none', 'None'],
              ['pct', '% from entry'],
              ['atr', 'ATR(14) multiple'],
            ]}
          />
          {rules.stop_type !== 'none' && numField('stop_value', rules.stop_type === 'pct' ? 'Stop %' : 'Stop × ATR')}
          <SelectField
            label="Target"
            value={rules.target_type}
            onChange={(target_type) => patch({ target_type })}
            options={[
              ['none', 'None'],
              ['pct', '% from entry'],
              ['r', 'R multiple (× stop distance)'],
            ]}
          />
          {rules.target_type !== 'none' && numField('target_value', rules.target_type === 'pct' ? 'Target %' : 'Target R')}
          <SelectField
            label="Trailing stop"
            value={rules.trail_type}
            onChange={(trail_type) => patch({ trail_type })}
            options={[
              ['none', 'None'],
              ['pct', '% from high'],
              ['atr', 'ATR multiple'],
            ]}
          />
          {rules.trail_type !== 'none' && numField('trail_value', rules.trail_type === 'pct' ? 'Trail %' : 'Trail × ATR')}
          {numField('max_bars', 'Exit after bars (blank = never)', 1, 1, true)}
        </div>
      </Section>
      {conditionList('exit_conditions', 'Exit rules', 'Optional: exit at the next open when all of these hold.')}

      <Section
        title="Sizing & costs"
        hint="Costs cover brokerage, STT and exchange charges (≈0.1% per side for delivery). Support/resistance zones can’t be backtested; chart patterns trigger on their breakout bar."
      >
        <div className={FORM_GRID}>
          <SelectField
            label="Position size"
            value={rules.sizing}
            onChange={(sizing) => patch({ sizing })}
            options={[
              ['pct_equity', '% of equity'],
              ['risk', '% of equity risked (needs a stop)'],
              ['fixed', 'Fixed ₹ per trade'],
            ]}
          />
          {numField(
            'size_value',
            rules.sizing === 'fixed' ? '₹ per trade' : rules.sizing === 'risk' ? 'Risk %' : '% of equity',
            rules.sizing === 'fixed' ? 1000 : 0.5,
          )}
          {numField('cost_pct', 'Costs % per side', 0.01)}
          {numField('slippage_pct', 'Slippage % per side', 0.01)}
        </div>
      </Section>
    </>
  )
}

function FlatSection({ title, hint, children }: { title: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="@container border-b border-line px-4 py-3">
      <h3 className="text-[13px] font-semibold text-fg">{title}</h3>
      {hint && <p className="mt-0.5 text-[12px] leading-snug text-muted">{hint}</p>}
      <div className="mt-2.5">{children}</div>
    </section>
  )
}

// --- results ---------------------------------------------------------------------------

export const KPI_GRID = 'grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2 sm:grid-cols-[repeat(auto-fill,minmax(136px,1fr))]'

export function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'pos' | 'neg' }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-xl border border-line bg-surface px-3 py-2.5 shadow-card">
      <span className="truncate text-[11px] font-medium text-muted" title={label}>
        {label}
      </span>
      <span
        className={cx(
          'truncate text-[16px] font-semibold tabular-nums md:text-[18px]',
          tone === 'pos' ? 'text-up' : tone === 'neg' ? 'text-down' : 'text-fg',
        )}
      >
        {value}
      </span>
    </div>
  )
}

/** A legend entry: a line sample in the series' color (dashed for benchmarks). */
export function Swatch({ color, dashed, children }: { color: string; dashed?: boolean; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <i
        aria-hidden
        className={cx('inline-block w-3.5', dashed ? 'h-0 border-t-2 border-dashed' : 'h-0.5 rounded')}
        style={dashed ? { borderColor: color } : { background: color }}
      />
      {children}
    </span>
  )
}

const TH = 'px-3 py-2 text-left text-[11px] font-semibold tracking-wide text-muted uppercase whitespace-nowrap'
const TD = 'px-3 py-2 whitespace-nowrap'

function Results({ result, theme }: { result: BacktestResult; theme: ChartTheme }) {
  const s: BacktestSummary = result.summary
  if (!s.trades) {
    return (
      <EmptyState title="No trades" className="rounded-2xl border border-dashed border-line">
        The entry conditions never matched in this period. Loosen them or widen the period.
      </EmptyState>
    )
  }
  const exits = Object.entries(s.exit_reasons ?? {})
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-[16px] font-semibold text-fg">{result.request.name}</h2>
        <span className="text-[12px] text-muted">
          {result.symbols_tested} symbols tested{result.skipped.length ? `, ${result.skipped.length} skipped` : ''} · {result.request.tf} · from{' '}
          {result.request.start}
        </span>
      </div>
      {/* The numbers that decide whether a strategy is worth it, first; the rest on demand. */}
      <div className={KPI_GRID}>
        <Kpi label="Net return (after costs)" value={pct(s.total_return_pct)} tone={tone(s.total_return_pct)} />
        <Kpi label="NIFTY 50, same period" value={pct(s.benchmark_return_pct)} />
        <Kpi label="Max drawdown" value={pct(s.max_drawdown_pct)} tone={tone(s.max_drawdown_pct)} />
        <Kpi label="Trades" value={String(s.trades)} />
        <Kpi label="Win rate" value={pct(s.win_rate_pct, false)} />
        <Kpi label="Profit factor" value={num(s.profit_factor)} />
      </div>
      <details className="group">
        <summary className="cursor-pointer list-none text-[13px] font-medium text-accent select-none">
          <span className="inline-block transition group-open:rotate-90">›</span> More stats
        </summary>
        <div className={cx(KPI_GRID, 'mt-2')}>
          <Kpi label="CAGR" value={pct(s.cagr_pct)} tone={tone(s.cagr_pct)} />
          <Kpi label="Sharpe" value={num(s.sharpe)} />
          <Kpi label="Avg R" value={num(s.avg_r)} tone={tone(s.avg_r)} />
          <Kpi label="Avg trade (₹)" value={inr(s.expectancy)} tone={tone(s.expectancy)} />
          <Kpi label="Avg win" value={pct(s.avg_win_pct)} tone={tone(s.avg_win_pct)} />
          <Kpi label="Avg loss" value={pct(s.avg_loss_pct)} tone={tone(s.avg_loss_pct)} />
          <Kpi label="Avg bars held" value={num(s.avg_bars, 1)} />
          <Kpi label="Time in market" value={pct(s.exposure_pct, false)} />
        </div>
      </details>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="flex min-w-0 flex-col gap-2 rounded-2xl border border-line bg-surface p-3 shadow-card">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
            <Swatch color={theme.series[0]}>Strategy equity</Swatch>
            {result.benchmark && (
              <Swatch color={theme.muted} dashed>
                NIFTY 50 buy &amp; hold
              </Swatch>
            )}
            <Swatch color={theme.down}>Drawdown %</Swatch>
          </div>
          <EquityChart equity={result.equity} benchmark={result.benchmark} theme={theme} className="h-[300px] md:h-[360px]" />
        </div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-1 lg:content-start">
          <MiniTable
            title="Year by year"
            rows={result.yearly.map((y) => [String(y.year), <span key="v" className={toneClass(y.return_pct)}>{pct(y.return_pct)}</span>])}
          />
          {exits.length > 0 && <MiniTable title="Exits" rows={exits.map(([k, v]) => [k, String(v)])} />}
        </div>
      </div>
    </div>
  )
}

function MiniTable({ title, rows }: { title: string; rows: [string, ReactNode][] }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
      <div className="border-b border-line px-3 py-2 text-[12px] font-semibold text-fg">{title}</div>
      <table className="w-full text-[13px]">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} className="border-t border-line first:border-t-0">
              <td className="truncate px-3 py-1.5 text-muted">{k}</td>
              <td className="px-3 py-1.5 text-right font-medium tabular-nums">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// --- trades ------------------------------------------------------------------------------

export function Trades({ trades, tf, onOpen }: { trades: BacktestTrade[]; tf: string; onOpen: (t: BacktestTrade) => void }) {
  const [sort, setSort] = useState<{ key: keyof BacktestTrade; desc: boolean }>({ key: 'entry_time', desc: true })
  const rows = useMemo(() => {
    const list = [...trades]
    list.sort((a, b) => {
      const x = a[sort.key] ?? 0
      const y = b[sort.key] ?? 0
      const v = typeof x === 'string' ? String(x).localeCompare(String(y)) : (x as number) - (y as number)
      return sort.desc ? -v : v
    })
    return list
  }, [trades, sort])
  if (!trades.length) return <EmptyState title="No trades">The entry conditions never matched.</EmptyState>
  const intraday = !['1D', '1W', '1M'].includes(tf)
  const th = (key: keyof BacktestTrade, label: string, numeric = false) => {
    const on = sort.key === key
    return (
      <th
        aria-sort={on ? (sort.desc ? 'descending' : 'ascending') : 'none'}
        onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : true }))}
        className={cx(TH, 'cursor-pointer select-none hover:text-fg', numeric && 'text-right', on && 'text-fg', key === 'ticker' && 'sticky left-0 z-[1] bg-surface')}
      >
        {label}
        {on ? (sort.desc ? ' ▾' : ' ▴') : ''}
      </th>
    )
  }
  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-surface shadow-card">
      <table className="w-full min-w-[760px] border-collapse text-[12px] md:text-[13px]">
        <thead className="border-b border-line">
          <tr>
            {th('ticker', 'Symbol')}
            {th('entry_time', 'Entry')}
            {th('exit_time', 'Exit')}
            {th('entry_price', 'Entry ₹', true)}
            {th('exit_price', 'Exit ₹', true)}
            {th('qty', 'Qty', true)}
            {th('pnl', 'P&L ₹', true)}
            {th('pnl_pct', 'P&L %', true)}
            {th('r', 'R', true)}
            {th('bars', 'Bars', true)}
            {th('reason', 'Exit by')}
          </tr>
        </thead>
        <tbody>
          {rows.map((t, i) => (
            <tr
              key={`${t.symbol}-${t.entry_time}-${i}`}
              onClick={() => onOpen(t)}
              title="Show on chart"
              className="group cursor-pointer border-t border-line transition-colors hover:bg-hover"
            >
              <td className={cx(TD, 'sticky left-0 bg-surface font-semibold text-fg group-hover:bg-hover')}>
                <span className={cx('mr-1.5 text-[10px]', t.side === 'short' ? 'text-down' : 'text-up')}>{t.side === 'short' ? '▼' : '▲'}</span>
                {t.ticker}
              </td>
              <td className={cx(TD, 'text-muted')}>{formatBarTime(t.entry_time, intraday)}</td>
              <td className={cx(TD, 'text-muted')}>{formatBarTime(t.exit_time, intraday)}</td>
              <td className={cx(TD, 'text-right tabular-nums')}>{t.entry_price.toFixed(2)}</td>
              <td className={cx(TD, 'text-right tabular-nums')}>{t.exit_price.toFixed(2)}</td>
              <td className={cx(TD, 'text-right tabular-nums')}>{t.qty}</td>
              <td className={cx(TD, 'text-right font-medium tabular-nums', toneClass(t.pnl))}>
                {t.pnl.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
              </td>
              <td className={cx(TD, 'text-right font-medium tabular-nums', toneClass(t.pnl_pct))}>{pct(t.pnl_pct)}</td>
              <td className={cx(TD, 'text-right tabular-nums')}>{num(t.r)}</td>
              <td className={cx(TD, 'text-right tabular-nums')}>{t.bars}</td>
              <td className={cx(TD, 'text-muted')}>{t.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// --- history ------------------------------------------------------------------------------

function History({
  items,
  loading,
  error,
  activeId,
  onOpen,
  onReuse,
  onDelete,
}: {
  items: BacktestHistoryItem[] | undefined
  loading: boolean
  error?: string
  activeId: string | null
  onOpen: (id: string) => void
  onReuse: (item: BacktestHistoryItem) => void
  onDelete: (id: string) => void
}) {
  if (loading)
    return (
      <div className="overflow-hidden rounded-2xl border border-line bg-surface" aria-busy>
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="h-2.5 w-64 max-w-full" />
            </div>
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
    )
  if (error) return <ErrorText>{error}</ErrorText>
  if (!items?.length) return <EmptyState title="No saved backtests yet">Every backtest you run is saved here.</EmptyState>

  const where = (h: BacktestHistoryItem) =>
    `${h.request.universe === 'symbol' ? h.request.symbol : h.request.universe} · ${h.request.tf} · from ${h.request.start}`
  const when = (h: BacktestHistoryItem) => h.created.replace('T', ' ').slice(0, 16)
  const del = (h: BacktestHistoryItem) => window.confirm(`Delete "${h.name}"?`) && onDelete(h.id)
  const actions = (h: BacktestHistoryItem) => (
    <>
      <Button size="sm" variant="ghost" className="text-accent" onClick={() => onReuse(h)}>
        Edit &amp; rerun
      </Button>
      <Button size="sm" variant="ghost" className="hover:text-down" onClick={() => del(h)}>
        Delete
      </Button>
    </>
  )

  return (
    <>
      {/* Phones: cards. */}
      <ul className="flex flex-col gap-2 md:hidden">
        {items.map((h) => (
          <li key={h.id} className={cx('rounded-2xl border bg-surface p-3 shadow-card', h.id === activeId ? 'border-accent' : 'border-line')}>
            <button className="flex w-full cursor-pointer flex-col gap-1 text-left" onClick={() => onOpen(h.id)}>
              <span className="flex items-baseline gap-2">
                <b className="min-w-0 flex-1 truncate text-[14px] font-semibold text-fg">{h.name}</b>
                <span className={cx('text-[15px] font-semibold tabular-nums', toneClass(h.summary.total_return_pct))}>
                  {pct(h.summary.total_return_pct)}
                </span>
              </span>
              <span className="truncate text-[12px] text-muted">{where(h)}</span>
              <span className="text-[12px] text-muted tabular-nums">
                {h.summary.trades} trades · win {pct(h.summary.win_rate_pct, false)} · max DD {pct(h.summary.max_drawdown_pct)}
              </span>
            </button>
            <div className="mt-2 flex items-center gap-1 border-t border-line pt-2">
              <span className="flex-1 text-[11px] text-muted">{when(h)}</span>
              {actions(h)}
            </div>
          </li>
        ))}
      </ul>

      {/* Wider screens: a table. */}
      <div className="hidden overflow-x-auto rounded-2xl border border-line bg-surface shadow-card md:block">
        <table className="w-full border-collapse text-[13px]">
          <thead className="border-b border-line">
            <tr>
              <th className={TH}>Name</th>
              <th className={TH}>Run</th>
              <th className={TH}>Symbols</th>
              <th className={cx(TH, 'text-right')}>Return</th>
              <th className={cx(TH, 'text-right')}>Max DD</th>
              <th className={cx(TH, 'text-right')}>Trades</th>
              <th className={cx(TH, 'text-right')}>Win %</th>
              <th className={TH} />
            </tr>
          </thead>
          <tbody>
            {items.map((h) => (
              <tr key={h.id} className={cx('border-t border-line transition-colors hover:bg-hover', h.id === activeId && 'bg-selected')}>
                <td className={TD}>
                  <button className="cursor-pointer font-semibold text-accent hover:underline" onClick={() => onOpen(h.id)}>
                    {h.name}
                  </button>
                </td>
                <td className={cx(TD, 'text-muted tabular-nums')}>{when(h)}</td>
                <td className={cx(TD, 'max-w-[260px] truncate text-muted')}>{where(h)}</td>
                <td className={cx(TD, 'text-right font-medium tabular-nums', toneClass(h.summary.total_return_pct))}>
                  {pct(h.summary.total_return_pct)}
                </td>
                <td className={cx(TD, 'text-right tabular-nums')}>{pct(h.summary.max_drawdown_pct)}</td>
                <td className={cx(TD, 'text-right tabular-nums')}>{h.summary.trades}</td>
                <td className={cx(TD, 'text-right tabular-nums')}>{pct(h.summary.win_rate_pct, false)}</td>
                <td className={cx(TD, 'py-1 text-right')}>{actions(h)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

// --- saved strategies ------------------------------------------------------------------------

type Named = { strategy_id?: string | null; name: string }

/** Pick, save and delete saved strategies. `keys` are the rule fields this
 * editor owns: loading a strategy copies only those. */
export function StrategyBar<T extends Named>({
  value,
  set,
  keys,
  flat = false,
}: {
  value: T
  set: (p: Partial<T>) => void
  keys: readonly string[]
  /** Plain block with a divider (side panels) instead of a card. */
  flat?: boolean
}) {
  const qc = useQueryClient()
  const toast = useToasts((t) => t.push)
  const strategies = useQuery({ queryKey: STRATEGIES, queryFn: api.strategies })
  const list = strategies.data ?? []
  const current = list.find((s) => s.id === value.strategy_id) ?? null
  const fields = value as unknown as Record<string, unknown>

  const save = useMutation({
    mutationFn: api.saveStrategy,
    onSuccess: (saved) => {
      qc.setQueryData<Strategy[]>(STRATEGIES, (l = []) => (l.some((s) => s.id === saved.id) ? l.map((s) => (s.id === saved.id ? saved : s)) : [...l, saved]))
      set({ strategy_id: saved.id, name: saved.name } as Partial<T>)
      toast(`Saved “${saved.name}”`)
    },
    onError: (e) => toast(`Couldn’t save: ${e.message}`, 'err'),
    onSettled: () => qc.invalidateQueries({ queryKey: STRATEGIES }),
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteStrategy(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: STRATEGIES })
      const prev = qc.getQueryData<Strategy[]>(STRATEGIES)
      qc.setQueryData<Strategy[]>(STRATEGIES, (l) => l?.filter((s) => s.id !== id))
      set({ strategy_id: null } as Partial<T>)
      return { prev }
    },
    onError: (e, id, ctx) => {
      if (ctx?.prev) qc.setQueryData(STRATEGIES, ctx.prev)
      set({ strategy_id: id } as Partial<T>)
      toast(`Couldn’t delete: ${e.message}`, 'err')
    },
    onSettled: () => qc.invalidateQueries({ queryKey: STRATEGIES }),
  })

  const doSave = (asNew: boolean) => {
    const name = asNew || !current ? window.prompt('Strategy name', value.name)?.trim() : current.name
    if (!name) return
    // Keep rule fields this editor doesn't own (e.g. the Lab's timeframe).
    const definition = { ...(current?.definition ?? {}), ...Object.fromEntries(keys.map((k) => [k, fields[k]])) }
    save.mutate({ id: asNew ? undefined : current?.id, name, definition })
  }

  const body = (
    <div className="flex flex-col gap-2">
      <Select
        value={current ? current.id : ''}
        aria-label="Saved strategy"
        disabled={strategies.isPending}
        onChange={(e) => {
          const s = list.find((x) => x.id === e.target.value)
          if (!s) return set({ strategy_id: null } as Partial<T>)
          const def = s.definition as Record<string, unknown>
          const picked = Object.fromEntries(keys.filter((k) => k in def).map((k) => [k, def[k]]))
          set({ ...picked, strategy_id: s.id, name: s.name } as Partial<T>)
        }}
      >
        <option value="">{strategies.isPending ? 'Loading strategies…' : 'Unsaved setup'}</option>
        {list.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </Select>
      <div className="flex flex-wrap items-center gap-2">
        {current && (
          <Button size="sm" variant="primary" loading={save.isPending && !!save.variables?.id} disabled={save.isPending} onClick={() => doSave(false)}>
            Save
          </Button>
        )}
        <Button size="sm" loading={save.isPending && !save.variables?.id} disabled={save.isPending} onClick={() => doSave(true)}>
          Save as new
        </Button>
        {current && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto hover:text-down"
            onClick={() => window.confirm(`Delete strategy “${current.name}”?`) && remove.mutate(current.id)}
          >
            Delete
          </Button>
        )}
      </div>
      {strategies.error && <ErrorText>{strategies.error.message}</ErrorText>}
    </div>
  )
  const hint = 'A strategy saves its rules (entry, exits, sizing), for the chart and the Strategy Lab.'
  return flat ? (
    <FlatSection title="Strategy" hint={hint}>
      {body}
    </FlatSection>
  ) : (
    <Card title="Strategy" hint={hint}>
      {body}
    </Card>
  )
}
