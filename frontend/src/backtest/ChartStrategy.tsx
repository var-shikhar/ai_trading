import { useEffect, useMemo, useRef, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { SeriesMarker, Time, UTCTimestamp } from 'lightweight-charts'
import { api, ApiError } from '../api/client'
import type { ChartTheme } from '../chart/theme'
import { usePref } from '../prefs'
import { Button, cx, EmptyState, ErrorText, IconButton, Skeleton, Spinner, Switch, Tabs } from '../ui/kit'
import { EquityChart } from './EquityChart'
import { Kpi, KPI_GRID, NumberField, RulesEditor, StrategyBar, Swatch, Trades } from './StrategyTester'
import { inr, num, pct, tone, toneClass, type BacktestTrade, type ChartBacktestResult, type ChartStrategy } from './types'

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

/** `value`, once it has stopped changing for `ms`. */
function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return v
}

/** Reruns the chart's strategy (debounced) whenever its rules, the chart
 * symbol or the interval change, like a strategy added to a TradingView chart.
 * Results are cached per setup, so switching back to a symbol is instant. */
export function useChartStrategy(strategy: ChartStrategy, symbol: string, tf: string, ready: boolean): ChartStrategyState {
  const { enabled, name, strategy_id, ...rules } = strategy
  const key = JSON.stringify({ ...rules, symbol, tf })
  const debounced = useDebounced(key, 450)
  const hasEntry = strategy.entry.length > 0
  const q = useQuery({
    queryKey: ['backtests', 'chart', debounced],
    queryFn: () =>
      api.chartBacktest({ enabled: true, name, strategy_id, ...(JSON.parse(debounced) as typeof rules & { symbol: string; tf: string }) }),
    enabled: enabled && ready && hasEntry,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    // Bad rules (4xx) won't pass on a retry.
    retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 1,
  })
  if (!enabled) return { result: q.data ?? null, loading: false, error: null }
  if (!hasEntry) return { result: null, loading: false, error: 'Add an entry condition.' }
  return {
    result: q.data ?? null,
    loading: ready && (q.isFetching || key !== debounced),
    error: q.error ? (q.error instanceof ApiError ? q.error.message : 'Backtest failed') : null,
  }
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
  const catalog = useQuery({ queryKey: ['backtests', 'catalog'], queryFn: api.backtestCatalog, staleTime: Infinity })
  const s = state.result?.summary

  return (
    <aside className="flex min-h-0 flex-1 flex-col" aria-label="Chart strategy">
      <div className="flex shrink-0 flex-col gap-2 border-b border-line px-4 py-3">
        <Switch
          checked={strategy.enabled}
          onChange={(enabled) => onChange({ enabled })}
          label={<span className="font-medium">{strategy.enabled ? 'On the chart' : 'Apply to chart'}</span>}
        />
        <div className="min-h-[18px] text-[12px] leading-snug text-muted">
          {!strategy.enabled ? (
            'Turn it on to backtest the rules below on the active chart. It reruns as you change them.'
          ) : state.error ? (
            <span className="text-down">{state.error}</span>
          ) : state.loading ? (
            <span className="inline-flex items-center gap-1.5">
              <Spinner size={12} /> Testing on {ticker} · {tf}…
            </span>
          ) : s ? (
            <>
              {ticker} · {tf}: <b className="text-fg">{s.trades}</b> trades,{' '}
              <b className={toneClass(s.total_return_pct) || 'text-fg'}>{pct(s.total_return_pct)}</b> (buy &amp; hold {pct(s.buy_hold_return_pct)})
            </>
          ) : null}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <StrategyBar value={strategy} set={onChange} keys={CHART_RULE_KEYS} flat />
        <section className="@container border-b border-line px-4 py-3">
          <h3 className="text-[13px] font-semibold text-fg">Test</h3>
          <p className="mt-0.5 text-[12px] leading-snug text-muted">Runs on the active chart’s symbol and interval, on its last {strategy.bars} bars.</p>
          <div className="mt-2.5 grid grid-cols-1 gap-3 @[300px]:grid-cols-2">
            <NumberField label="Capital ₹" value={strategy.capital} step={10000} min={1000} onChange={(v) => v !== null && v > 0 && onChange({ capital: v })} />
            <NumberField
              label="Bars to test"
              value={strategy.bars}
              step={100}
              min={100}
              onChange={(v) => v !== null && onChange({ bars: Math.min(5000, Math.max(100, Math.round(v))) })}
            />
          </div>
        </section>
        {catalog.data ? (
          <RulesEditor rules={strategy} set={onChange} conditions={catalog.data.conditions} flat />
        ) : catalog.error ? (
          <div className="p-4">
            <ErrorText>{catalog.error.message}</ErrorText>
          </div>
        ) : (
          <div className="flex flex-col gap-3 p-4" aria-busy>
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))}
          </div>
        )}
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
  const drag = useRef<{ y: number; h: number } | null>(null)
  const r = state.result
  const s = r?.summary

  // Pointer capture keeps the drag on the handle (mouse and touch) without
  // window listeners that could outlive the component.
  const resize = {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId)
      drag.current = { y: e.clientY, h: height }
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      const d = drag.current
      if (d) setHeight(Math.round(Math.min(window.innerHeight - 200, Math.max(160, d.h + d.y - e.clientY))))
    },
    onPointerUp: () => (drag.current = null),
    onPointerCancel: () => (drag.current = null),
  }
  const ticker = r ? (r.request.symbol.split(':')[1]?.replace(/-[A-Z]+$/, '') ?? r.request.symbol) : ''
  const buyHold = useMemo(() => r?.buy_hold ?? null, [r])

  return (
    <section
      aria-label="Strategy tester"
      style={open ? { height } : undefined}
      className={cx(
        'relative flex shrink-0 flex-col border-t border-line bg-surface',
        open && 'max-h-[calc(100dvh-200px)] min-h-[160px] max-md:max-h-[45dvh]',
      )}
    >
      {open && (
        <div
          {...resize}
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize"
          className="group absolute inset-x-0 -top-1.5 z-10 flex h-3 cursor-ns-resize touch-none justify-center"
        >
          <span className="mt-1 h-1 w-10 rounded-full bg-line opacity-0 transition group-hover:opacity-100 max-md:opacity-100" />
        </div>
      )}
      <div className="flex min-h-10 shrink-0 items-center gap-1 border-b border-line px-2 md:gap-2">
        <IconButton label={open ? 'Minimize' : 'Expand'} aria-expanded={open} onClick={() => setOpen(!open)}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
            <path d={open ? 'M3 5l4 4 4-4' : 'M3 9l4-4 4 4'} />
          </svg>
        </IconButton>
        <b className="hidden text-[13px] font-semibold text-fg md:inline">Strategy Tester</b>
        <button
          onClick={onSettings}
          title="Edit the rules"
          className="max-w-[30vw] cursor-pointer truncate rounded-md px-1.5 py-1 text-[13px] font-medium text-accent hover:bg-accent-soft md:max-w-[240px]"
        >
          {strategy.name}
        </button>
        {open && (
          <Tabs
            className="min-w-0"
            value={tab}
            onChange={setTab}
            items={[
              { id: 'overview', label: 'Overview' },
              { id: 'trades', label: 'Trades', badge: r ? r.trades.length : undefined },
            ]}
          />
        )}
        <span className="flex-1" />
        {state.loading && <Spinner size={14} className="mx-1 text-muted" />}
        {state.error && <span className="hidden max-w-[40%] truncate text-[12px] text-down sm:inline">{state.error}</span>}
        {!open && s && (
          <span className="truncate text-[12px] text-muted tabular-nums">
            {s.trades} trades · <span className={toneClass(s.total_return_pct)}>{pct(s.total_return_pct)}</span> · max DD {pct(s.max_drawdown_pct)}
          </span>
        )}
        <IconButton label="Remove strategy from chart" title="Remove from chart" onClick={onRemove}>
          <svg width="16" height="16" viewBox="0 0 18 18" stroke="currentColor" strokeWidth="1.5" aria-hidden>
            <path d="M4.5 4.5l9 9M13.5 4.5l-9 9" />
          </svg>
        </IconButton>
      </div>
      {open && (
        <div className={cx('min-h-0 flex-1 overflow-auto p-3 transition-opacity', state.loading && r && 'opacity-60')}>
          {state.error && <ErrorText className="mb-3 sm:hidden">{state.error}</ErrorText>}
          {!r && !state.error &&
            (state.loading ? (
              <div className="flex flex-col gap-3" aria-busy>
                <div className={KPI_GRID}>
                  {Array.from({ length: 6 }, (_, i) => (
                    <Skeleton key={i} className="h-[62px] rounded-xl" />
                  ))}
                </div>
                <Skeleton className="h-[200px] rounded-xl" />
              </div>
            ) : (
              <EmptyState title="No result yet" action={<Button size="sm" onClick={onSettings}>Edit rules</Button>} />
            ))}
          {r && tab === 'overview' &&
            (s && s.trades ? (
              <div className="flex flex-col gap-3">
                <div className={KPI_GRID}>
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
                <div className="flex flex-col gap-2 rounded-xl border border-line p-2.5">
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
                    <Swatch color={theme.series[0]}>Strategy equity</Swatch>
                    <Swatch color={theme.muted} dashed>
                      {ticker} buy &amp; hold
                    </Swatch>
                    <span>
                      {r.bars_tested} bars · {r.request.tf}
                    </span>
                  </div>
                  <EquityChart equity={r.equity} benchmark={buyHold} theme={theme} benchmarkLabel={ticker} className="h-[240px]" />
                </div>
              </div>
            ) : (
              <EmptyState title="No trades on this chart">The entry conditions never matched in these {r.bars_tested} bars.</EmptyState>
            ))}
          {r && tab === 'trades' && <Trades trades={r.trades} tf={r.request.tf} onOpen={onOpenTrade} />}
        </div>
      )}
    </section>
  )
}
