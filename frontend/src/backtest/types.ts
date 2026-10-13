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
