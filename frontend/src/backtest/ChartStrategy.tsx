import { useEffect, useMemo, useRef, useState } from 'react'
import type { SeriesMarker, Time, UTCTimestamp } from 'lightweight-charts'
import { api, ApiError } from '../api/client'
import type { ChartTheme } from '../chart/theme'
import { usePref } from '../prefs'
import { EquityChart } from './EquityChart'
import { inr, Kpi, num, NumberField, pct, RulesEditor, StrategyBar, tone, Trades } from './StrategyTester'
import type { BacktestTrade, ChartBacktestResult, ChartStrategy } from './types'

export const defaultChartStrategy = (): ChartStrategy => ({
  enabled: false,
  strategy_id: null,
  name: 'Breakout swing',
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
  sizing: 'pct_equity',
  size_value: 100,
  capital: 100_000,
  cost_pct: 0.12, // ≈0.25% round trip for delivery, see the Strategy Lab
  slippage_pct: 0.05,
  bars: 2000,
})

// Rule fields the chart strategy owns: a saved strategy's timeframe and
// position count don't apply (it runs on the chart's interval, one symbol).
const CHART_RULE_KEYS = [
  'side', 'entry', 'exit_conditions', 'stop_type', 'stop_value', 'target_type', 'target_value',
  'trail_type', 'trail_value', 'max_bars', 'sizing', 'size_value', 'cost_pct', 'slippage_pct',
] as const

export interface ChartStrategyState {
  result: ChartBacktestResult | null
  loading: boolean
  error: string | null
}

/** Reruns the chart's strategy (debounced) whenever its rules, the chart
 * symbol or the interval change, like a strategy added to a TradingView chart. */
export function useChartStrategy(strategy: ChartStrategy, symbol: string, tf: string, ready: boolean): ChartStrategyState {
  const [state, setState] = useState<ChartStrategyState>({ result: null, loading: false, error: null })
  const seq = useRef(0)
  const { enabled, name: _name, strategy_id: _id, ...rules } = strategy
  const key = JSON.stringify({ ...rules, symbol, tf })

  useEffect(() => {
    const id = ++seq.current
    if (!enabled || !ready) return
    if (!strategy.entry.length) {
      setState({ result: null, loading: false, error: 'Add an entry condition.' })
      return
    }
    setState((s) => ({ ...s, loading: true, error: null }))
    const timer = setTimeout(() => {
      api.chartBacktest({ ...strategy, symbol, tf }).then(
        (result) => id === seq.current && setState({ result, loading: false, error: null }),
        (e: Error) =>
          id === seq.current &&
          setState((s) => ({ ...s, loading: false, error: e instanceof ApiError ? e.message : 'Backtest failed' })),
      )
    }, 450)
    return () => clearTimeout(timer)
  }, [key, enabled, ready]) // eslint-disable-line react-hooks/exhaustive-deps

  return state
}

/** Entry/exit arrows for backtest trades: entries below (long) or above
 * (short) the bar, exits on the other side, colored by the trade's result. */
export function tradeMarkers(trades: BacktestTrade[], theme: { up: string; down: string; muted: string }): SeriesMarker<Time>[] {
  const out: SeriesMarker<Time>[] = []
  for (const t of trades) {
    const long = t.side === 'long'
    out.push({
      time: t.entry_time as UTCTimestamp,
      position: long ? 'belowBar' : 'aboveBar',
      shape: long ? 'arrowUp' : 'arrowDown',
      color: theme.muted,
      text: `${long ? 'Buy' : 'Sell'} ${t.entry_price.toFixed(2)}`,
    })
    out.push({
      time: t.exit_time as UTCTimestamp,
      position: long ? 'aboveBar' : 'belowBar',
      shape: long ? 'arrowDown' : 'arrowUp',
      color: t.pnl >= 0 ? theme.up : theme.down,
      text: `${t.reason} ${t.pnl_pct >= 0 ? '+' : ''}${t.pnl_pct.toFixed(1)}%`,
    })
  }
  return out.sort((a, b) => (a.time as number) - (b.time as number))
}

/** Right-dock panel: the strategy's rules, edited live. */
export function ChartStrategyPanel({
  strategy,
  onChange,
  state,
  ticker,
  tf,
}: {
  strategy: ChartStrategy
  onChange: (patch: Partial<ChartStrategy>) => void
  state: ChartStrategyState
  ticker: string
  tf: string
}) {
  const [conditions, setConditions] = useState<string[]>([])
  useEffect(() => {
    api.backtestCatalog().then((c) => setConditions(c.conditions), () => {})
  }, [])
  const s = state.result?.summary

  return (
    <aside className="pattern-panel strategy-panel" aria-label="Chart strategy">
      <div className="watch-head">
        <b>Strategy on chart</b>
        <span className="spacer" />
        <label className="switch" title={strategy.enabled ? 'Remove from chart' : 'Apply to chart'}>
          <input type="checkbox" checked={strategy.enabled} onChange={(e) => onChange({ enabled: e.target.checked })} />
          <span>{strategy.enabled ? 'On' : 'Off'}</span>
        </label>
      </div>
      <p className="strategy-status">
        {!strategy.enabled
          ? 'Turn it on to backtest the rules below on the active chart. It reruns as you change them.'
          : state.error
            ? <span className="status err">{state.error}</span>
            : state.loading
              ? `Testing on ${ticker} · ${tf}…`
              : s
                ? <>
                    {ticker} · {tf}: <b>{s.trades}</b> trades,{' '}
                    <b className={tone(s.total_return_pct) ?? ''}>{pct(s.total_return_pct)}</b> (buy &amp; hold{' '}
                    {pct(s.buy_hold_return_pct)})
                  </>
                : ''}
      </p>
      <div className="panel-body strategy-form">
        <StrategyBar value={strategy} set={onChange} keys={CHART_RULE_KEYS} />
        <div className="tester-section">
          <h3>Test</h3>
          <div className="form-row">
            <NumberField label="Capital ₹" value={strategy.capital} step={10000} min={1000} onChange={(v) => onChange({ capital: v ?? 100000 })} />
            <NumberField label="Bars to test" value={strategy.bars} step={100} min={100} onChange={(v) => onChange({ bars: Math.min(5000, Math.max(100, v ?? 2000)) })} />
          </div>
          <p className="note">Runs on the active chart’s symbol and interval, on its last {strategy.bars} bars.</p>
        </div>
        <RulesEditor rules={strategy} set={onChange} conditions={conditions} />
      </div>
    </aside>
  )
}

type ReportTab = 'overview' | 'trades'

/** TradingView-style Strategy Tester under the chart: results of the
 * strategy applied to the active chart. */
export function ChartStrategyReport({
  strategy,
  state,
  theme,
  onSettings,
  onRemove,
  onOpenTrade,
}: {
  strategy: ChartStrategy
  state: ChartStrategyState
  theme: ChartTheme
  onSettings: () => void
  onRemove: () => void
  onOpenTrade: (t: BacktestTrade) => void
}) {
  const [tab, setTab] = useState<ReportTab>('overview')
  const [height, setHeight] = usePref<number>('strategyReportHeight', 300)
  const [open, setOpen] = usePref<boolean>('strategyReportOpen', true)
  const r = state.result
  const s = r?.summary

  const startResize = (e: React.MouseEvent) => {
    const startY = e.clientY
    const startH = height
    const move = (ev: MouseEvent) => setHeight(Math.min(window.innerHeight - 200, Math.max(160, startH + startY - ev.clientY)))
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  const ticker = r ? r.request.symbol.split(':')[1]?.replace(/-[A-Z]+$/, '') ?? r.request.symbol : ''
  const buyHold = useMemo(() => r?.buy_hold ?? null, [r])

  return (
    <section className={`tester strategy-report ${open ? '' : 'collapsed'}`} style={open ? { height } : undefined} aria-label="Strategy tester">
      {open && <div className="tester-resize" onMouseDown={startResize} role="separator" aria-orientation="horizontal" />}
      <div className="tester-head">
        <button className="icon-button" aria-label={open ? 'Minimize' : 'Expand'} aria-expanded={open} onClick={() => setOpen(!open)}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
            <path d={open ? 'M3 5l4 4 4-4' : 'M3 9l4-4 4 4'} />
          </svg>
        </button>
        <b className="report-title">Strategy Tester</b>
        <button className="link-button" onClick={onSettings} title="Edit the rules">
          {strategy.name}
        </button>
        {open && (
          <div className="tabs inline" role="tablist">
            {(['overview', 'trades'] as ReportTab[]).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
                {t === 'overview' ? 'Overview' : `List of trades${r ? ` (${r.trades.length})` : ''}`}
              </button>
            ))}
          </div>
        )}
        <span className="spacer" />
        {state.loading && <span className="status small">Updating…</span>}
        {state.error && <span className="status err small">{state.error}</span>}
        {!open && s && (
          <span className="status small">
            {s.trades} trades · <span className={tone(s.total_return_pct) ?? ''}>{pct(s.total_return_pct)}</span> · max DD{' '}
            {pct(s.max_drawdown_pct)}
          </span>
        )}
        <button className="icon-button" aria-label="Remove strategy from chart" title="Remove from chart" onClick={onRemove}>
          <svg width="16" height="16" viewBox="0 0 18 18" stroke="currentColor" strokeWidth="1.5" aria-hidden>
            <path d="M4.5 4.5l9 9M13.5 4.5l-9 9" />
          </svg>
        </button>
      </div>
      {open && (
        <div className={`tester-body ${state.loading ? 'stale' : ''}`}>
          {!r && !state.error && <p className="status">{state.loading ? 'Running…' : 'No result yet.'}</p>}
          {r && tab === 'overview' &&
            (s && s.trades ? (
              <div className="tester-results">
                <div className="kpis">
                  <Kpi label="Net profit" value={pct(s.total_return_pct)} tone={tone(s.total_return_pct)} />
                  <Kpi label={`Buy & hold ${ticker}`} value={pct(s.buy_hold_return_pct)} />
                  <Kpi label="Max drawdown" value={pct(s.max_drawdown_pct)} tone={tone(s.max_drawdown_pct)} />
                  <Kpi label="Trades" value={String(s.trades)} />
                  <Kpi label="Win rate" value={pct(s.win_rate_pct, false)} />
                  <Kpi label="Profit factor" value={num(s.profit_factor)} />
                  <Kpi label="Avg R" value={num(s.avg_r)} tone={tone(s.avg_r)} />
                  <Kpi label="Avg trade (₹)" value={inr(s.expectancy)} tone={tone(s.expectancy)} />
                  <Kpi label="Sharpe" value={num(s.sharpe)} />
                  <Kpi label="Avg bars held" value={num(s.avg_bars, 1)} />
                  <Kpi label="Time in market" value={pct(s.exposure_pct, false)} />
                </div>
                <div className="legend-inline">
                  <span>
                    <i className="swatch" style={{ background: theme.series[0] }} /> Strategy equity
                  </span>
                  <span>
                    <i className="swatch dashed" style={{ borderColor: theme.muted }} /> {ticker} buy &amp; hold
                  </span>
                  <span className="muted">
                    {r.bars_tested} bars · {r.request.tf}
                  </span>
                </div>
                <EquityChart equity={r.equity} benchmark={buyHold} theme={theme} benchmarkLabel={ticker} />
              </div>
            ) : (
              <p className="status">No trades on this chart: the entry conditions never matched in these {r.bars_tested} bars.</p>
            ))}
          {r && tab === 'trades' && <Trades trades={r.trades} tf={r.request.tf} onOpen={onOpenTrade} />}
        </div>
      )}
    </section>
  )
}
