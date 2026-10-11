import { useEffect, useMemo, useRef, useState } from 'react'
import { api, type InstrumentHit } from '../api/client'
import type { ChartTheme } from '../chart/theme'
import { formatBarTime } from '../chart/format'
import { usePref } from '../prefs'
import { ConditionCard } from '../scanner/ScannerPanel'
import { CONDITION_DEFS, type ScanCondition } from '../scanner/types'
import { EquityChart } from './EquityChart'
import type {
  BacktestCatalog,
  BacktestHistoryItem,
  BacktestJob,
  BacktestRequest,
  BacktestResult,
  BacktestSummary,
  BacktestTrade,
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
  cost_pct: 0.1,
  slippage_pct: 0.05,
})

/** TradingView-style "Strategy Tester" panel under the charts. */
export function StrategyTester({
  chartSymbol,
  theme,
  onOpenTrade,
  onClose,
}: {
  chartSymbol: InstrumentHit
  theme: ChartTheme
  onOpenTrade: (trade: BacktestTrade, all: BacktestTrade[]) => void
  onClose: () => void
}) {
  const [tab, setTab] = useState<Tab>('setup')
  const [req, setReq] = usePref<BacktestRequest>('backtestSetup', defaultRequest)
  const [catalog, setCatalog] = useState<BacktestCatalog | null>(null)
  const [job, setJob] = useState<BacktestJob | null>(null)
  const [result, setResult] = useState<BacktestResult | null>(null)
  const [history, setHistory] = useState<BacktestHistoryItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [height, setHeight] = usePref<number>('testerHeight', 360)
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

  // Drag the top edge to resize.
  const startResize = (e: React.MouseEvent) => {
    const startY = e.clientY
    const startH = height
    const move = (ev: MouseEvent) => setHeight(Math.min(window.innerHeight - 160, Math.max(180, startH + startY - ev.clientY)))
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  return (
    <section className="tester" style={{ height }} aria-label="Strategy tester">
      <div className="tester-resize" onMouseDown={startResize} role="separator" aria-orientation="horizontal" />
      <div className="tester-head">
        <b>Strategy Tester</b>
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
        <button className="icon-button" aria-label="Close strategy tester" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 18 18" stroke="currentColor" strokeWidth="1.5" aria-hidden>
            <path d="M4.5 4.5l9 9M13.5 4.5l-9 9" />
          </svg>
        </button>
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
  const usable = catalog.conditions.filter((c) => CONDITION_DEFS[c])
  const conditionList = (key: 'entry' | 'exit_conditions', label: string, hint: string) => (
    <div className="tester-section">
      <h3>{label}</h3>
      <p className="note">{hint}</p>
      {req[key].map((c, i) => (
        <ConditionCard
          key={i}
          condition={c}
          onChange={(next) => set({ [key]: req[key].map((x, j) => (j === i ? next : x)) } as Partial<BacktestRequest>)}
          onRemove={() => set({ [key]: req[key].filter((_, j) => j !== i) } as Partial<BacktestRequest>)}
        />
      ))}
      <select
        className="add-condition"
        value=""
        onChange={(e) => {
          const def = CONDITION_DEFS[e.target.value]
          if (def)
            set({ [key]: [...req[key], { type: e.target.value, params: { ...def.defaults } } as ScanCondition] } as Partial<BacktestRequest>)
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

  const num = (key: keyof BacktestRequest, label: string, step = 0.1, min = 0) => (
    <label>
      <span>{label}</span>
      <input
        type="number"
        step={step}
        min={min}
        value={(req[key] as number | null) ?? ''}
        onChange={(e) => set({ [key]: e.target.value === '' ? null : Number(e.target.value) } as Partial<BacktestRequest>)}
      />
    </label>
  )

  return (
    <div className="tester-setup">
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
          <label>
            <span>Direction</span>
            <select value={req.side} onChange={(e) => set({ side: e.target.value as 'long' | 'short' })}>
              <option value="long">Long</option>
              <option value="short">Short</option>
            </select>
          </label>
        </div>
      </div>

      {conditionList('entry', 'Entry', 'Signal on a bar’s close; the trade opens at the next bar’s open.')}

      <div className="tester-section">
        <h3>Exits</h3>
        <div className="form-row">
          <label>
            <span>Stop</span>
            <select value={req.stop_type} onChange={(e) => set({ stop_type: e.target.value as BacktestRequest['stop_type'] })}>
              <option value="none">None</option>
              <option value="pct">% below entry</option>
              <option value="atr">ATR(14) multiple</option>
            </select>
          </label>
          {req.stop_type !== 'none' && num('stop_value', req.stop_type === 'pct' ? 'Stop %' : 'Stop × ATR')}
          <label>
            <span>Target</span>
            <select value={req.target_type} onChange={(e) => set({ target_type: e.target.value as BacktestRequest['target_type'] })}>
              <option value="none">None</option>
              <option value="pct">% from entry</option>
              <option value="r">R multiple (× stop distance)</option>
            </select>
          </label>
          {req.target_type !== 'none' && num('target_value', req.target_type === 'pct' ? 'Target %' : 'Target R')}
          <label>
            <span>Trailing stop</span>
            <select value={req.trail_type} onChange={(e) => set({ trail_type: e.target.value as BacktestRequest['trail_type'] })}>
              <option value="none">None</option>
              <option value="pct">% from high</option>
              <option value="atr">ATR multiple</option>
            </select>
          </label>
          {req.trail_type !== 'none' && num('trail_value', req.trail_type === 'pct' ? 'Trail %' : 'Trail × ATR')}
          {num('max_bars', 'Exit after bars (blank = never)', 1, 1)}
        </div>
      </div>
      {conditionList('exit_conditions', 'Exit rules', 'Optional: exit at the next open when all of these hold.')}

      <div className="tester-section">
        <h3>Money</h3>
        <div className="form-row">
          {num('capital', 'Capital ₹', 10000, 1000)}
          <label>
            <span>Position size</span>
            <select value={req.sizing} onChange={(e) => set({ sizing: e.target.value as BacktestRequest['sizing'] })}>
              <option value="pct_equity">% of equity</option>
              <option value="risk">% of equity risked (needs a stop)</option>
              <option value="fixed">Fixed ₹ per trade</option>
            </select>
          </label>
          {num('size_value', req.sizing === 'fixed' ? '₹ per trade' : req.sizing === 'risk' ? 'Risk %' : '% of equity', req.sizing === 'fixed' ? 1000 : 0.5)}
          {num('max_positions', 'Max open positions', 1, 1)}
          {num('cost_pct', 'Costs % per side', 0.01)}
          {num('slippage_pct', 'Slippage % per side', 0.01)}
        </div>
        <p className="note">
          Costs cover brokerage, STT and exchange charges (≈0.1% per side for delivery). Index lists use today’s members, so older
          years carry survivorship bias. Support/resistance zones can’t be backtested; chart patterns trigger on their breakout bar.
        </p>
      </div>
    </div>
  )
}

// --- results ---------------------------------------------------------------------------

const pct = (v: number | null | undefined, sign = true) =>
  v === null || v === undefined ? '–' : `${sign && v > 0 ? '+' : ''}${v.toFixed(2)}%`
const num = (v: number | null | undefined, d = 2) => (v === null || v === undefined ? '–' : v.toFixed(d))
const inr = (v: number | null | undefined) =>
  v === null || v === undefined ? '–' : `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'pos' | 'neg' }) {
  return (
    <div className="kpi">
      <span className="kpi-label">{label}</span>
      <span className={`kpi-value ${tone ?? ''}`}>{value}</span>
    </div>
  )
}

const tone = (v: number | null | undefined): 'pos' | 'neg' | undefined =>
  v === null || v === undefined || v === 0 ? undefined : v > 0 ? 'pos' : 'neg'

function Results({ result, theme }: { result: BacktestResult; theme: ChartTheme }) {
  const s: BacktestSummary = result.summary
  if (!s.trades) {
    return <p className="status">No trades: the entry conditions never matched in this period. Loosen them or widen the period.</p>
  }
  return (
    <div className="tester-results">
      <div className="kpis">
        <Kpi label="Net return" value={pct(s.total_return_pct)} tone={tone(s.total_return_pct)} />
        <Kpi label="CAGR" value={pct(s.cagr_pct)} tone={tone(s.cagr_pct)} />
        <Kpi label="NIFTY 50 (same period)" value={pct(s.benchmark_return_pct)} />
        <Kpi label="Max drawdown" value={pct(s.max_drawdown_pct)} tone={tone(s.max_drawdown_pct)} />
        <Kpi label="Sharpe" value={num(s.sharpe)} />
        <Kpi label="Trades" value={String(s.trades)} />
        <Kpi label="Win rate" value={pct(s.win_rate_pct, false)} />
        <Kpi label="Profit factor" value={num(s.profit_factor)} />
        <Kpi label="Avg R" value={num(s.avg_r)} tone={tone(s.avg_r)} />
        <Kpi label="Avg trade (₹)" value={inr(s.expectancy)} tone={tone(s.expectancy)} />
        <Kpi label="Avg bars held" value={num(s.avg_bars, 1)} />
        <Kpi label="Time in market" value={pct(s.exposure_pct, false)} />
      </div>
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

function Trades({ trades, tf, onOpen }: { trades: BacktestTrade[]; tf: string; onOpen: (t: BacktestTrade) => void }) {
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
  const intraday = tf !== '1D' && tf !== '1W'
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
