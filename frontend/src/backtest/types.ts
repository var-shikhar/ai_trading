import type { ScanCondition } from '../scanner/types'

export interface BacktestRequest {
  name: string
  strategy_id?: string | null
  universe: string
  symbol?: string | null
  custom: string[]
  tf: '1D' | '1W'
  start: string
  end?: string | null
  side: 'long' | 'short'
  entry: ScanCondition[]
  exit_conditions: ScanCondition[]
  stop_type: 'none' | 'pct' | 'atr'
  stop_value: number
  target_type: 'none' | 'pct' | 'r'
  target_value: number
  trail_type: 'none' | 'pct' | 'atr'
  trail_value: number
  max_bars: number | null
  sizing: 'fixed' | 'pct_equity' | 'risk'
  size_value: number
  capital: number
  max_positions: number
  cost_pct: number
  slippage_pct: number
}

export interface BacktestSummary {
  trades: number
  final_equity?: number
  total_return_pct?: number
  cagr_pct?: number
  max_drawdown_pct?: number
  sharpe?: number | null
  win_rate_pct?: number | null
  profit_factor?: number | null
  avg_win_pct?: number | null
  avg_loss_pct?: number | null
  avg_r?: number | null
  expectancy?: number | null
  avg_bars?: number | null
  best_trade_pct?: number | null
  worst_trade_pct?: number | null
  exposure_pct?: number | null
  benchmark_return_pct?: number
  exit_reasons?: Record<string, number>
}

export interface BacktestTrade {
  symbol: string
  ticker: string
  side: string
  entry_time: number
  entry_price: number
  exit_time: number
  exit_price: number
  qty: number
  pnl: number
  pnl_pct: number
  r: number | null
  bars: number
  reason: string
}

export interface BacktestResult {
  id: string
  request: BacktestRequest
  summary: BacktestSummary
  equity: [number, number][]
  benchmark: [number, number][] | null
  yearly: { year: number; return_pct: number }[]
  per_symbol: { symbol: string; trades: number; pnl: number; win_rate_pct: number }[]
  trades: BacktestTrade[]
  skipped: string[]
  symbols_tested: number
}

export interface BacktestJob {
  id: string
  status: 'loading' | 'simulating' | 'done' | 'error' | 'cancelled'
  message: string
  total: number
  loaded: number
  result_id: string | null
  errors: string[]
  elapsed_seconds: number
}

export interface BacktestHistoryItem {
  id: string
  name: string
  created: string
  request: BacktestRequest
  summary: BacktestSummary
}

export interface BacktestCatalog {
  conditions: string[]
  not_backtestable: Record<string, string>
  universes: { id: string; name: string }[]
}

/** A strategy's rules (what a saved strategy stores), without where/when it's tested. */
export type StrategyRules = Pick<
  BacktestRequest,
  | 'side'
  | 'entry'
  | 'exit_conditions'
  | 'stop_type'
  | 'stop_value'
  | 'target_type'
  | 'target_value'
  | 'trail_type'
  | 'trail_value'
  | 'max_bars'
  | 'sizing'
  | 'size_value'
  | 'cost_pct'
  | 'slippage_pct'
>

/** The strategy applied to the chart (TradingView-style): reruns on the
 * active chart's symbol and timeframe whenever either or a rule changes. */
export interface ChartStrategy extends StrategyRules {
  enabled: boolean
  strategy_id: string | null
  name: string
  capital: number
  bars: number
}

export interface ChartBacktestResult {
  request: ChartStrategy & { symbol: string; tf: string }
  summary: BacktestSummary & { buy_hold_return_pct?: number }
  equity: [number, number][]
  buy_hold: [number, number][]
  trades: BacktestTrade[]
  bars_tested: number
  from: number
  to: number
}

// --- shared formatting ------------------------------------------------------------------------

export const pct = (v: number | null | undefined, sign = true) =>
  v === null || v === undefined ? '–' : `${sign && v > 0 ? '+' : ''}${v.toFixed(2)}%`
export const num = (v: number | null | undefined, d = 2) => (v === null || v === undefined ? '–' : v.toFixed(d))
export const inr = (v: number | null | undefined) =>
  v === null || v === undefined ? '–' : `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
export const tone = (v: number | null | undefined): 'pos' | 'neg' | undefined =>
  v === null || v === undefined || v === 0 ? undefined : v > 0 ? 'pos' : 'neg'
/** Text color for a tone (profit green, loss red). */
export const toneClass = (v: number | null | undefined) => {
  const t = tone(v)
  return t === 'pos' ? 'text-up' : t === 'neg' ? 'text-down' : ''
}

// The rule part of a Lab setup: what a strategy is, independent of which
// symbols or dates it's tested on (an agent can later create or tune these).
export const RULE_KEYS = [
  'tf', 'side', 'entry', 'exit_conditions', 'stop_type', 'stop_value', 'target_type', 'target_value',
  'trail_type', 'trail_value', 'max_bars', 'sizing', 'size_value', 'max_positions', 'cost_pct', 'slippage_pct',
] as const
