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
}

async function get<T>(path: string, params?: Record<string, string | number>): Promise<T> {
  const query = params
    ? '?' + new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))
    : ''
  const res = await fetch(`/api${path}${query}`)
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  return res.json() as Promise<T>
}

export const api = {
  health: () => get<Health>('/health'),
  timeframes: () => get<string[]>('/timeframes'),
  candles: (symbol: string, tf: string, limit = 1000) =>
    get<Candle[]>('/candles', { symbol, tf, limit }),
}
