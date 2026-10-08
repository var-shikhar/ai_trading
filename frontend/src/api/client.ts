export interface Candle {
  time: number // IST wall time as UTC epoch seconds
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface LinePoint {
  time: number
  value: number
}

export type IndicatorKey = 'ema20' | 'ema50' | 'ema200' | 'rsi14'

export interface ChartData {
  candles: Candle[]
  indicators: Record<IndicatorKey, LinePoint[]>
  has_more: boolean
}

export type Direction = 'bullish' | 'bearish' | 'neutral'

export interface PatternInfo {
  id: string
  name: string
  label: string
  kind: 'reversal' | 'continuation' | 'indecision'
  bars: number
  common: boolean
}

export interface PatternCatalog {
  patterns: PatternInfo[]
  trend_lookback: number
  outcome_bars: number
}

export interface PatternHit {
  time: number
  pattern: string
  direction: Direction
  confirmed: boolean
  prior_trend: 'up' | 'down' | 'flat' | null
  in_context: boolean
  move_pct: number | null // % move OUTCOME_BARS later; null if too recent
}

export interface PatternStat {
  pattern: string
  direction: Direction
  count: number
  win_rate: number | null
  avg_move_pct: number
}

export interface PatternResult {
  hits: PatternHit[]
  stats: PatternStat[]
}

export interface PatternQuery {
  patterns?: string[] // explicit ids; omitted = common set (or all with allPatterns)
  allPatterns?: boolean
  inContext: boolean
}

export interface Health {
  status: string
  candles: number
  instruments: number
}

export interface AuthStatus {
  fyers: { configured: boolean; authenticated: boolean; login_url: string }
}

export interface InstrumentHit {
  symbol: string
  ticker: string
  name: string
  kind: 'EQ' | 'ETF' | 'INDEX'
}

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function get<T>(path: string, params?: Record<string, string | number>): Promise<T> {
  const query = params
    ? '?' + new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))
    : ''
  const res = await fetch(`/api${path}${query}`)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new ApiError(res.status, body.detail ?? res.statusText)
  }
  return res.json() as Promise<T>
}

export const api = {
  health: () => get<Health>('/health'),
  authStatus: () => get<AuthStatus>('/auth/status'),
  timeframes: () => get<string[]>('/timeframes'),
  search: (q: string) => get<InstrumentHit[]>('/instruments/search', { q, limit: 10 }),
  candles: (symbol: string, tf: string, limit = 500) =>
    get<Candle[]>('/candles', { symbol, tf, limit }),
  chart: (symbol: string, tf: string, limit = 500) =>
    get<ChartData>('/chart', { symbol, tf, limit }),
  patternCatalog: () => get<PatternCatalog>('/patterns/candlestick/catalog'),
  patterns: (symbol: string, tf: string, limit: number, q: PatternQuery) =>
    get<PatternResult>('/patterns/candlestick', {
      symbol,
      tf,
      limit,
      in_context: String(q.inContext),
      ...(q.patterns ? { patterns: q.patterns.join(',') } : {}),
      ...(q.allPatterns ? { all_patterns: 'true' } : {}),
    }),
}
