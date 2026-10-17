import { useEffect, useMemo, useRef, useState } from 'react'
import { api, type InstrumentHit, type Strategy } from '../api/client'
import type { ChartTheme } from '../chart/theme'
import { formatBarTime } from '../chart/format'
import { usePref } from '../prefs'
import { ConditionCard } from '../scanner/ScannerPanel'
import { CONDITION_DEFS, type ScanCondition } from '../scanner/types'
import { EquityChart } from './EquityChart'
import { StrategyTemplates } from './templates'
import type {
  BacktestCatalog,
  BacktestHistoryItem,
  BacktestJob,
  BacktestRequest,
  BacktestResult,
  BacktestSummary,
  BacktestTrade,
  StrategyRules,
} from './types'

type Tab = 'setup' | 'results' | 'trades' | 'history'

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
  const [tab, setTab] = useState<Tab>('setup')
  const [req, setReq] = usePref<BacktestRequest>('backtestSetup', defaultRequest)
  const [catalog, setCatalog] = useState<BacktestCatalog | null>(null)
  const [job, setJob] = useState<BacktestJob | null>(null)
  const [result, setResult] = useState<BacktestResult | null>(null)
  const [history, setHistory] = useState<BacktestHistoryItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const poll = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    api.backtestCatalog().then(setCatalog, (e: Error) => setError(e.message))
    api.backtests().then(setHistory, () => {})
    return () => {
      if (poll.current) clearInterval(poll.current)
    }
  }, [])

  const set = (patch: Partial<BacktestRequest>) => setReq((r) => ({ ...r, ...patch }))
  const running = job?.status === 'loading' || job?.status === 'simulating'

  const run = async () => {
    setError(null)
    try {
      const body = { ...req, symbol: req.universe === 'symbol' ? chartSymbol.symbol : null }
      const started = await api.runBacktest(body)
      setJob(started)
      if (poll.current) clearInterval(poll.current)
      poll.current = setInterval(async () => {
        try {
          const next = await api.backtestJob(started.id)
          setJob(next)
          if (next.status === 'done' && next.result_id) {
            clearInterval(poll.current!)
            setResult(await api.backtestResult(next.result_id))
            setHistory(await api.backtests())
            setTab('results')
          } else if (next.status !== 'loading' && next.status !== 'simulating') {
            clearInterval(poll.current!)
          }
        } catch (e) {
          setError((e as Error).message)
          clearInterval(poll.current!)
        }
      }, 1200)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <section className="tester lab" aria-label="Strategy Lab">
      <div className="tester-head">
        <h1 className="page-title">Strategy Lab</h1>
        <div className="tabs inline" role="tablist">
          {(['setup', 'results', 'trades', 'history'] as Tab[]).map((t) => (
            <button key={t} role="tab" className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {t === 'setup' ? 'Setup' : t === 'results' ? 'Results' : t === 'trades' ? `Trades${result ? ` (${result.trades.length})` : ''}` : 'History'}
            </button>
          ))}
        </div>
        <span className="spacer" />
        {job && running && (
          <span className="status small">
            {job.status === 'loading' ? `Loading data ${job.loaded}/${job.total}` : 'Simulating…'} · {job.elapsed_seconds}s
          </span>
        )}
        {job && job.status === 'error' && <span className="status err small">{job.message}</span>}
        {running ? (
          <button className="secondary-button" onClick={() => job && api.cancelBacktest(job.id)}>
            Cancel
          </button>
        ) : (
          <button className="primary-button" onClick={run} disabled={!req.entry.length}>
            Run backtest
          </button>
        )}
      </div>
      {error && <p className="status err tester-error">{error}</p>}
      <div className="tester-body">
        {tab === 'setup' && catalog && <Setup req={req} set={set} catalog={catalog} chartSymbol={chartSymbol} />}
        {tab === 'results' &&
          (result ? <Results result={result} theme={theme} /> : <p className="status">Run a backtest to see results.</p>)}
        {tab === 'trades' &&
          (result ? (
            <Trades trades={result.trades} tf={result.request.tf} onOpen={(tr) => onOpenTrade(tr, result.trades)} />
          ) : (
            <p className="status">No trades yet.</p>
          ))}
        {tab === 'history' && (
          <History
            items={history}
            onOpen={async (id) => {
              setResult(await api.backtestResult(id))
              setTab('results')
            }}
            onReuse={(item) => {
              setReq(item.request)
              setTab('setup')
            }}
            onDelete={async (id) => {
              await api.deleteBacktest(id)
              setHistory((h) => h.filter((x) => x.id !== id))
            }}
          />
        )}
      </div>
    </section>
  )
}

// --- setup ---------------------------------------------------------------------------

function Setup({
  req,
  set,
  catalog,
  chartSymbol,
}: {
  req: BacktestRequest
  set: (p: Partial<BacktestRequest>) => void
  catalog: BacktestCatalog
  chartSymbol: InstrumentHit
}) {
  return (
    <div className="tester-setup">
      <StrategyTemplates current={req.name} onPick={(t) => set({ ...t.rules, name: t.name, strategy_id: null })} />
      <StrategyBar value={req} set={set} keys={RULE_KEYS} />
      <div className="tester-section">
        <h3>Market</h3>
        <div className="form-row">
          <label>
            <span>Name</span>
            <input value={req.name} onChange={(e) => set({ name: e.target.value })} />
          </label>
          <label>
            <span>Symbols</span>
            <select value={req.universe} onChange={(e) => set({ universe: e.target.value })}>
              {catalog.universes.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.id === 'symbol' ? `Chart symbol (${chartSymbol.ticker})` : u.name}
                </option>
              ))}
            </select>
          </label>
          {req.universe === 'custom' && (
            <label className="wide">
              <span>Tickers</span>
              <input
                value={req.custom.join(', ')}
                placeholder="SBIN, TCS, NIFTY1!"
                onChange={(e) => set({ custom: e.target.value.split(/[\s,]+/).filter(Boolean) })}
              />
            </label>
          )}
          <label>
            <span>Timeframe</span>
            <select value={req.tf} onChange={(e) => set({ tf: e.target.value as '1D' | '1W' })}>
              <option value="1D">Daily</option>
              <option value="1W">Weekly</option>
            </select>
          </label>
          <label>
            <span>From</span>
            <input type="date" value={req.start} min="2000-01-01" onChange={(e) => set({ start: e.target.value })} />
          </label>
          <label>
            <span>To (blank = today)</span>
            <input type="date" value={req.end ?? ''} onChange={(e) => set({ end: e.target.value || null })} />
          </label>
          <NumberField label="Capital ₹" value={req.capital} step={10000} min={1000} onChange={(capital) => set({ capital: capital ?? 0 })} />
          <NumberField
            label="Max open positions"
            value={req.max_positions}
            step={1}
            min={1}
            onChange={(max_positions) => set({ max_positions: max_positions ?? 1 })}
          />
        </div>
        <p className="note">Index lists use today’s members, so older years carry survivorship bias.</p>
      </div>
      <RulesEditor rules={req} set={set} conditions={catalog.conditions} />
    </div>
  )
}

export function NumberField({
  label,
  value,
  onChange,
  step = 0.1,
  min = 0,
}: {
  label: string
  value: number | null
  onChange: (v: number | null) => void
  step?: number
  min?: number
}) {
  return (
    <label>
      <span>{label}</span>
      <input
        type="number"
        step={step}
        min={min}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      />
    </label>
  )
}

/** Entry/exit conditions, stops, targets, sizing and costs: the rules of a
 * strategy. Shared by the Strategy Lab and the strategy applied to the chart. */
export function RulesEditor<T extends StrategyRules>({
  rules,
  set,
  conditions,
}: {
  rules: T
  set: (p: Partial<T>) => void
  conditions: string[]
}) {
  const usable = conditions.filter((c) => CONDITION_DEFS[c])
  const patch = (p: Partial<StrategyRules>) => set(p as Partial<T>)
  const conditionList = (key: 'entry' | 'exit_conditions', label: string, hint: string) => (
    <div className="tester-section">
      <h3>{label}</h3>
      <p className="note">{hint}</p>
      {rules[key].map((c, i) => (
        <ConditionCard
          key={i}
          condition={c}
          onChange={(next) => patch({ [key]: rules[key].map((x, j) => (j === i ? next : x)) })}
          onRemove={() => patch({ [key]: rules[key].filter((_, j) => j !== i) })}
        />
      ))}
      <select
        className="add-condition"
        value=""
        onChange={(e) => {
          const def = CONDITION_DEFS[e.target.value]
          if (def) patch({ [key]: [...rules[key], { type: e.target.value, params: { ...def.defaults } } as ScanCondition] })
        }}
        aria-label={`Add ${label.toLowerCase()} condition`}
      >
        <option value="">+ Add condition (all must match)</option>
        {usable.map((c) => (
          <option key={c} value={c}>
            {CONDITION_DEFS[c].name}
          </option>
        ))}
      </select>
    </div>
  )
  const num = (key: keyof StrategyRules, label: string, step = 0.1, min = 0) => (
    <NumberField
      label={label}
      value={rules[key] as number | null}
      step={step}
      min={min}
      onChange={(v) => patch({ [key]: v } as Partial<StrategyRules>)}
    />
  )

  return (
    <>
      <div className="tester-section">
        <h3>Direction</h3>
        <div className="segmented small" role="group" aria-label="Direction">
          {(['long', 'short'] as const).map((side) => (
            <button key={side} className={rules.side === side ? 'active' : ''} onClick={() => patch({ side })}>
              {side === 'long' ? 'Long' : 'Short'}
            </button>
          ))}
        </div>
      </div>
      {conditionList('entry', 'Entry', 'Signal on a bar’s close; the trade opens at the next bar’s open.')}

      <div className="tester-section">
        <h3>Exits</h3>
        <div className="form-row">
          <label>
            <span>Stop</span>
            <select value={rules.stop_type} onChange={(e) => patch({ stop_type: e.target.value as StrategyRules['stop_type'] })}>
              <option value="none">None</option>
              <option value="pct">% from entry</option>
              <option value="atr">ATR(14) multiple</option>
            </select>
          </label>
          {rules.stop_type !== 'none' && num('stop_value', rules.stop_type === 'pct' ? 'Stop %' : 'Stop × ATR')}
          <label>
            <span>Target</span>
            <select value={rules.target_type} onChange={(e) => patch({ target_type: e.target.value as StrategyRules['target_type'] })}>
              <option value="none">None</option>
              <option value="pct">% from entry</option>
              <option value="r">R multiple (× stop distance)</option>
            </select>
          </label>
          {rules.target_type !== 'none' && num('target_value', rules.target_type === 'pct' ? 'Target %' : 'Target R')}
          <label>
            <span>Trailing stop</span>
            <select value={rules.trail_type} onChange={(e) => patch({ trail_type: e.target.value as StrategyRules['trail_type'] })}>
              <option value="none">None</option>
              <option value="pct">% from high</option>
              <option value="atr">ATR multiple</option>
            </select>
          </label>
          {rules.trail_type !== 'none' && num('trail_value', rules.trail_type === 'pct' ? 'Trail %' : 'Trail × ATR')}
          {num('max_bars', 'Exit after bars (blank = never)', 1, 1)}
        </div>
      </div>
      {conditionList('exit_conditions', 'Exit rules', 'Optional: exit at the next open when all of these hold.')}

      <div className="tester-section">
        <h3>Sizing &amp; costs</h3>
        <div className="form-row">
          <label>
            <span>Position size</span>
            <select value={rules.sizing} onChange={(e) => patch({ sizing: e.target.value as StrategyRules['sizing'] })}>
              <option value="pct_equity">% of equity</option>
              <option value="risk">% of equity risked (needs a stop)</option>
              <option value="fixed">Fixed ₹ per trade</option>
            </select>
          </label>
          {num(
            'size_value',
            rules.sizing === 'fixed' ? '₹ per trade' : rules.sizing === 'risk' ? 'Risk %' : '% of equity',
            rules.sizing === 'fixed' ? 1000 : 0.5,
          )}
          {num('cost_pct', 'Costs % per side', 0.01)}
          {num('slippage_pct', 'Slippage % per side', 0.01)}
        </div>
        <p className="note">
          Costs cover brokerage, STT and exchange charges (≈0.1% per side for delivery). Support/resistance zones can’t be
          backtested; chart patterns trigger on their breakout bar.
        </p>
      </div>
    </>
  )
}

// --- results ---------------------------------------------------------------------------

export const pct = (v: number | null | undefined, sign = true) =>
  v === null || v === undefined ? '–' : `${sign && v > 0 ? '+' : ''}${v.toFixed(2)}%`
export const num = (v: number | null | undefined, d = 2) => (v === null || v === undefined ? '–' : v.toFixed(d))
export const inr = (v: number | null | undefined) =>
  v === null || v === undefined ? '–' : `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`

export function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'pos' | 'neg' }) {
  return (
    <div className="kpi">
      <span className="kpi-label">{label}</span>
      <span className={`kpi-value ${tone ?? ''}`}>{value}</span>
    </div>
  )
}

export const tone = (v: number | null | undefined): 'pos' | 'neg' | undefined =>
  v === null || v === undefined || v === 0 ? undefined : v > 0 ? 'pos' : 'neg'

function Results({ result, theme }: { result: BacktestResult; theme: ChartTheme }) {
  const s: BacktestSummary = result.summary
  if (!s.trades) {
    return <p className="status">No trades: the entry conditions never matched in this period. Loosen them or widen the period.</p>
  }
  return (
    <div className="tester-results">
      {/* The numbers that decide whether a strategy is worth it, first;
          the rest on demand. */}
      <div className="kpis">
        <Kpi label="Net return (after costs)" value={pct(s.total_return_pct)} tone={tone(s.total_return_pct)} />
        <Kpi label="NIFTY 50, same period" value={pct(s.benchmark_return_pct)} />
        <Kpi label="Max drawdown" value={pct(s.max_drawdown_pct)} tone={tone(s.max_drawdown_pct)} />
        <Kpi label="Trades" value={String(s.trades)} />
        <Kpi label="Win rate" value={pct(s.win_rate_pct, false)} />
        <Kpi label="Profit factor" value={num(s.profit_factor)} />
      </div>
      <details className="more-stats">
        <summary>More stats</summary>
        <div className="kpis">
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
      <div className="tester-columns">
        <div className="equity-wrap">
          <div className="legend-inline">
            <span>
              <i className="swatch" style={{ background: theme.series[0] }} /> Strategy equity
            </span>
            {result.benchmark && (
              <span>
                <i className="swatch dashed" style={{ borderColor: theme.muted }} /> NIFTY 50 buy &amp; hold
              </span>
            )}
            <span>
              <i className="swatch" style={{ background: theme.down }} /> Drawdown %
            </span>
          </div>
          <EquityChart equity={result.equity} benchmark={result.benchmark} theme={theme} />
        </div>
        <div className="side-tables">
          <table className="stats">
            <caption>Year by year</caption>
            <thead>
              <tr>
                <th>Year</th>
                <th className="num">Return</th>
              </tr>
            </thead>
            <tbody>
              {result.yearly.map((y) => (
                <tr key={y.year}>
                  <td>{y.year}</td>
                  <td className={`num ${tone(y.return_pct) ?? ''}`}>{pct(y.return_pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="stats">
            <caption>Exits</caption>
            <tbody>
              {Object.entries(s.exit_reasons ?? {}).map(([k, v]) => (
                <tr key={k}>
                  <td>{k}</td>
                  <td className="num">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="note">
            {result.symbols_tested} symbols tested{result.skipped.length ? `, ${result.skipped.length} skipped` : ''}.
          </p>
        </div>
      </div>
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
  const intraday = !['1D', '1W', '1M'].includes(tf)
  const th = (key: keyof BacktestTrade, label: string, numeric = false) => (
    <th
      className={`sortable ${numeric ? 'num' : ''}`}
      aria-sort={sort.key === key ? (sort.desc ? 'descending' : 'ascending') : 'none'}
      onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : true }))}
    >
      {label}
      {sort.key === key ? (sort.desc ? ' ▾' : ' ▴') : ''}
    </th>
  )
  return (
    <table className="stats trades-table">
      <thead>
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
          <tr key={`${t.symbol}-${t.entry_time}-${i}`} onClick={() => onOpen(t)} title="Show on chart">
            <td>
              <b>{t.ticker}</b>
            </td>
            <td>{formatBarTime(t.entry_time, intraday)}</td>
            <td>{formatBarTime(t.exit_time, intraday)}</td>
            <td className="num">{t.entry_price.toFixed(2)}</td>
            <td className="num">{t.exit_price.toFixed(2)}</td>
            <td className="num">{t.qty}</td>
            <td className={`num ${tone(t.pnl) ?? ''}`}>{t.pnl.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
            <td className={`num ${tone(t.pnl_pct) ?? ''}`}>{pct(t.pnl_pct)}</td>
            <td className="num">{num(t.r)}</td>
            <td className="num">{t.bars}</td>
            <td>{t.reason}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// --- history ------------------------------------------------------------------------------

function History({
  items,
  onOpen,
  onReuse,
  onDelete,
}: {
  items: BacktestHistoryItem[]
  onOpen: (id: string) => void
  onReuse: (item: BacktestHistoryItem) => void
  onDelete: (id: string) => void
}) {
  if (!items.length) return <p className="status">No saved backtests yet.</p>
  return (
    <table className="stats">
      <thead>
        <tr>
          <th>Name</th>
          <th>Run</th>
          <th>Symbols</th>
          <th className="num">Return</th>
          <th className="num">Max DD</th>
          <th className="num">Trades</th>
          <th className="num">Win %</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {items.map((h) => (
          <tr key={h.id}>
            <td>
              <button className="link-button" onClick={() => onOpen(h.id)}>
                {h.name}
              </button>
            </td>
            <td>{h.created.replace('T', ' ')}</td>
            <td>
              {h.request.universe === 'symbol' ? h.request.symbol : h.request.universe} · {h.request.tf} · from {h.request.start}
            </td>
            <td className={`num ${tone(h.summary.total_return_pct) ?? ''}`}>{pct(h.summary.total_return_pct)}</td>
            <td className="num">{pct(h.summary.max_drawdown_pct)}</td>
            <td className="num">{h.summary.trades}</td>
            <td className="num">{pct(h.summary.win_rate_pct, false)}</td>
            <td className="num">
              <button className="link-button" onClick={() => onReuse(h)}>
                Edit &amp; rerun
              </button>{' '}
              <button className="link-button danger" onClick={() => window.confirm(`Delete "${h.name}"?`) && onDelete(h.id)}>
                Delete
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// --- saved strategies ------------------------------------------------------------------------

// The rule part of a setup: what a strategy is, independent of which symbols
// or dates it's tested on (an agent can later create or tune these).
export const RULE_KEYS = [
  'tf', 'side', 'entry', 'exit_conditions', 'stop_type', 'stop_value', 'target_type', 'target_value',
  'trail_type', 'trail_value', 'max_bars', 'sizing', 'size_value', 'max_positions', 'cost_pct', 'slippage_pct',
] as const

type Named = { strategy_id?: string | null; name: string }

/** Pick, save and delete saved strategies. `keys` are the rule fields this
 * editor owns: loading a strategy copies only those. */
export function StrategyBar<T extends Named>({
  value,
  set,
  keys,
}: {
  value: T
  set: (p: Partial<T>) => void
  keys: readonly string[]
}) {
  const [list, setList] = useState<Strategy[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const reload = () => api.strategies().then(setList, () => {})
  useEffect(() => {
    reload()
  }, [])
  const current = list.find((s) => s.id === value.strategy_id) ?? null
  const fields = value as unknown as Record<string, unknown>

  const save = async (asNew: boolean) => {
    const name = asNew || !current ? window.prompt('Strategy name', value.name)?.trim() : current.name
    if (!name) return
    // Keep rule fields this editor doesn't own (e.g. the Lab's timeframe).
    const definition = { ...(current?.definition ?? {}), ...Object.fromEntries(keys.map((k) => [k, fields[k]])) }
    const saved = await api.saveStrategy({ id: asNew ? undefined : current?.id, name, definition })
    set({ strategy_id: saved.id, name } as Partial<T>)
    setNotice(`Saved “${saved.name}”`)
    reload()
  }

  return (
    <div className="tester-section strategy-bar">
      <h3>Strategy</h3>
      <div className="inline-fields">
        <select
          value={value.strategy_id ?? ''}
          aria-label="Saved strategy"
          onChange={(e) => {
            const s = list.find((x) => x.id === e.target.value)
            if (!s) return set({ strategy_id: null } as Partial<T>)
            const def = s.definition as Record<string, unknown>
            const picked = Object.fromEntries(keys.filter((k) => k in def).map((k) => [k, def[k]]))
            set({ ...picked, strategy_id: s.id, name: s.name } as Partial<T>)
          }}
        >
          <option value="">Unsaved setup</option>
          {list.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        {current && (
          <button className="secondary-button" onClick={() => save(false)}>
            Save
          </button>
        )}
        <button className="secondary-button" onClick={() => save(true)}>
          Save as new
        </button>
        {current && (
          <button
            className="link-button danger"
            onClick={async () => {
              if (!window.confirm(`Delete strategy “${current.name}”?`)) return
              await api.deleteStrategy(current.id)
              set({ strategy_id: null } as Partial<T>)
              reload()
            }}
          >
            Delete
          </button>
        )}
        {notice && <span className="status ok small">{notice}</span>}
      </div>
      <p className="note">A strategy saves its rules (entry, exits, sizing), for the chart and the Strategy Lab.</p>
    </div>
  )
}
