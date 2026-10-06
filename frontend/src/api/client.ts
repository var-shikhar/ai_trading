export interface Candle {
  time: number // IST wall time as UTC epoch seconds
  open: number
  high: number
  low: number
  close: number
  volume: number
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
}
