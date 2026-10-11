import type { Drawing } from '../drawings/types'
import type { ChartPatternResult, Sensitivity } from '../patterns/chartPatterns'
import type { ScanCatalog, ScanCondition, ScanJob } from '../scanner/types'
import type { Alert, AlertEvent, AlertIn, AlertList } from '../alerts/types'
import type {
  BacktestCatalog,
  BacktestHistoryItem,
  BacktestJob,
  BacktestRequest,
  BacktestResult,
} from '../backtest/types'

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

export interface StudyInputDef {
  key: string
  name: string
  type: 'int' | 'float' | 'source'
  default: number | string
  min?: number
  max?: number
  step?: number
  options?: string[]
}

export interface StudyOutputDef {
  key: string
  name: string
  style: 'line' | 'histogram' | 'dots'
  signed: boolean
}

export interface StudyDef {
  id: string
  name: string
  short: string
  category: string
  overlay: boolean
  levels: number[]
  needs_volume: boolean
  inputs: StudyInputDef[]
  outputs: StudyOutputDef[]
}

export type StudyParams = Record<string, number | string>

export interface StudyResult {
  params: StudyParams
  outputs: Record<string, LinePoint[]>
}

export interface StudyChartData {
  candles: Candle[]
  studies: Record<string, StudyResult>
  has_more: boolean
  session?: { start: string; end: string }
}

export interface Quote {
  ltp: number
  ch: number | null
  chp: number | null
  open: number | null
  high: number | null
  low: number | null
  prev_close: number | null
  volume: number | null
  time: number | null
}

export interface WatchItem {
  symbol: string
  ticker: string
  name: string
  kind: InstrumentKind
  exchange?: string | null
}

export interface Watchlist {
  id: string
  name: string
  items: WatchItem[]
  position: number
}

export interface UserInfo {
  username: string
  role: 'admin' | 'user'
  email: string | null
  disabled: boolean
  created: string
  last_login: string | null
  created_by: string | null
}

export interface Health {
  status: string
  candles: number
  instruments: number
}

export interface AuthStatus {
  fyers: { configured: boolean; authenticated: boolean; login_url: string }
}

export type InstrumentKind = 'EQ' | 'ETF' | 'INDEX' | 'FUT' | 'COM'

export interface InstrumentHit {
  symbol: string
  ticker: string
  name: string
  kind: InstrumentKind
  exchange?: string
  expiry?: string | null
}

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

// The app session ended (expired or signed out): the AuthGate shows the login
// page. Distinct from "Fyers login required", which is also a 401.
const signedOutListeners = new Set<() => void>()
export function onSignedOut(fn: () => void): () => void {
  signedOutListeners.add(fn)
  return () => {
    signedOutListeners.delete(fn)
  }
}
function checkSession(status: number, detail: unknown) {
  if (status === 401 && detail === 'Not signed in') signedOutListeners.forEach((fn) => fn())
}

async function get<T>(path: string, params?: Record<string, string | number>): Promise<T> {
  const query = params
    ? '?' + new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))
    : ''
  const res = await fetch(`/api${path}${query}`)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    checkSession(res.status, body.detail)
    throw new ApiError(res.status, body.detail ?? res.statusText)
  }
  return res.json() as Promise<T>
}

async function post<T>(path: string, body: unknown, method = 'POST'): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    checkSession(res.status, data.detail)
    throw new ApiError(res.status, typeof data.detail === 'string' ? data.detail : res.statusText)
  }
  return res.json() as Promise<T>
}

export const api = {
  login: (username: string, password: string) => post<{ username: string }>('/session/login', { username, password }),
  logout: () => post<{ ok: boolean }>('/session/logout', {}),
  me: () => get<UserInfo>('/session/me'),
  changePassword: (current: string, next: string) => post<{ ok: boolean }>('/session/password', { current, new: next }),
  users: () => get<UserInfo[]>('/admin/users'),
  createUser: (u: { username: string; password: string; email: string | null; role: 'admin' | 'user' }) =>
    post<UserInfo>('/admin/users', u),
  updateUser: (username: string, patch: { role?: 'admin' | 'user'; disabled?: boolean; email?: string | null; set_email?: boolean }) =>
    post<UserInfo>(`/admin/users/${encodeURIComponent(username)}`, patch, 'PATCH'),
  resetUserPassword: (username: string, password: string) =>
    post<{ ok: boolean }>(`/admin/users/${encodeURIComponent(username)}/password`, { password }),
  deleteUser: (username: string) => post<{ ok: boolean }>(`/admin/users/${encodeURIComponent(username)}`, {}, 'DELETE'),
  health: () => get<Health>('/health'),
  authStatus: () => get<AuthStatus>('/auth/status'),
  timeframes: () => get<string[]>('/timeframes'),
  search: (q: string, kind?: InstrumentKind | null, limit = 30) =>
    get<InstrumentHit[]>('/instruments/search', { q, limit, ...(kind ? { kind } : {}) }),
  candles: (symbol: string, tf: string, limit = 500) =>
    get<Candle[]>('/candles', { symbol, tf, limit }),
  chart: (symbol: string, tf: string, limit = 500) =>
    get<ChartData>('/chart', { symbol, tf, limit }),
  studiesCatalog: () => get<StudyDef[]>('/studies/catalog'),
  drawings: (symbol: string) => get<{ drawings: Drawing[] }>('/drawings', { symbol }).then((r) => r.drawings),
  saveDrawings: (symbol: string, drawings: Drawing[]) =>
    post<{ count: number }>(`/drawings?symbol=${encodeURIComponent(symbol)}`, { drawings }, 'PUT'),
  chartWithStudies: (
    symbol: string,
    tf: string,
    limit: number,
    studies: { uid: string; id: string; params: StudyParams }[],
  ) => post<StudyChartData>('/chart', { symbol, tf, limit, studies }),
  chartPatterns: (symbol: string, tf: string, limit: number, sensitivity: Sensitivity) =>
    get<ChartPatternResult>('/patterns/chart', { symbol, tf, limit, sensitivity }),
  quotes: (symbols: string[]) =>
    get<Record<string, Quote | null>>('/quotes', { symbols: symbols.join(',') }),
  watchlists: () => get<Watchlist[]>('/watchlists'),
  createWatchlist: (name: string, items: WatchItem[] = []) => post<Watchlist>('/watchlists', { name, items }),
  updateWatchlist: (id: string, patch: { name?: string; items?: WatchItem[] }) =>
    post<Watchlist>(`/watchlists/${id}`, patch, 'PUT'),
  deleteWatchlist: (id: string) => post<{ ok: boolean }>(`/watchlists/${id}`, {}, 'DELETE'),
  alerts: () => get<AlertList>('/alerts'),
  createAlert: (a: AlertIn) => post<Alert>('/alerts', a),
  updateAlert: (id: string, a: AlertIn) => post<Alert>(`/alerts/${id}`, a, 'PUT'),
  deleteAlert: (id: string) => post<{ ok: boolean }>(`/alerts/${id}`, {}, 'DELETE'),
  alertEvents: () => get<AlertEvent[]>('/alerts/events'),
  testAlert: (channels?: string[]) => post<Record<string, string>>('/alerts/test', channels ?? null),
  backtestCatalog: () => get<BacktestCatalog>('/backtests/catalog'),
  runBacktest: (req: BacktestRequest) => post<BacktestJob>('/backtests', req),
  backtestJob: (id: string) => get<BacktestJob>(`/backtests/jobs/${id}`),
  cancelBacktest: (id: string) => post<{ cancelled: boolean }>(`/backtests/jobs/${id}/cancel`, {}),
  backtests: () => get<BacktestHistoryItem[]>('/backtests'),
  backtestResult: (id: string) => get<BacktestResult>(`/backtests/${id}`),
  deleteBacktest: (id: string) => post<{ ok: boolean }>(`/backtests/${id}`, {}, 'DELETE'),
  scannerCatalog: () => get<ScanCatalog>('/scanner/catalog'),
  runScan: (universe: string, tf: string, conditions: ScanCondition[], custom: string[]) =>
    post<ScanJob>('/scanner/run', { universe, tf, conditions, custom }),
  scanJob: (id: string) => get<ScanJob>(`/scanner/jobs/${id}`),
  cancelScan: (id: string) => post<{ cancelled: boolean }>(`/scanner/jobs/${id}/cancel`, {}),
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
