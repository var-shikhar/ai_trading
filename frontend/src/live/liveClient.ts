import { useEffect, useState } from 'react'

export interface Tick {
  symbol: string
  ltp: number
  time: number // IST wall time as UTC epoch, like bars
  volume: number | null // cumulative for the day
  open: number | null
  high: number | null
  low: number | null
  prev_close: number | null
  ch: number | null
  chp: number | null
}

export type LiveStatus = 'idle' | 'connecting' | 'connected' | 'closed' | 'error'

type TickListener = (t: Tick) => void

/**
 * One WebSocket to the backend for the whole page. Components subscribe to
 * symbols; the client keeps the server's subscription equal to the union
 * and reconnects with backoff if the connection drops.
 */
class LiveClient {
  private ws: WebSocket | null = null
  private listeners = new Map<string, Set<TickListener>>()
  private statusListeners = new Set<(s: LiveStatus, msg: string) => void>()
  private retry = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  status: LiveStatus = 'idle'
  message = ''
  last = new Map<string, Tick>()

  subscribe(symbol: string, fn: TickListener): () => void {
    let set = this.listeners.get(symbol)
    if (!set) this.listeners.set(symbol, (set = new Set()))
    set.add(fn)
    const known = this.last.get(symbol)
    if (known) fn(known)
    this.sync()
    return () => {
      set!.delete(fn)
      if (!set!.size) this.listeners.delete(symbol)
      this.sync()
    }
  }

  onStatus(fn: (s: LiveStatus, msg: string) => void): () => void {
    this.statusListeners.add(fn)
    fn(this.status, this.message)
    return () => this.statusListeners.delete(fn)
  }

  private setStatus(s: LiveStatus, msg = '') {
    this.status = s
    this.message = msg
    for (const fn of this.statusListeners) fn(s, msg)
  }

  private sync() {
    if (!this.listeners.size && !this.ws) return
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED) return this.connect()
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ subscribe: [...this.listeners.keys()] }))
  }

  private connect() {
    if (this.timer) clearTimeout(this.timer)
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}/api/live`)
    this.ws = ws
    this.setStatus('connecting')
    ws.onopen = () => {
      this.retry = 0
      ws.send(JSON.stringify({ subscribe: [...this.listeners.keys()] }))
    }
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data)
      if (msg.type === 'status') return this.setStatus(msg.status, msg.message ?? '')
      if (msg.type !== 'tick') return
      const tick = msg as Tick
      this.last.set(tick.symbol, tick)
      if (this.status !== 'connected') this.setStatus('connected')
      for (const fn of this.listeners.get(tick.symbol) ?? []) fn(tick)
    }
    ws.onclose = () => {
      this.ws = null
      this.setStatus('closed')
      if (!this.listeners.size) return
      // Reconnect: 1s, 2s, 4s ... up to 30s.
      const delay = Math.min(30000, 1000 * 2 ** this.retry++)
      this.timer = setTimeout(() => this.connect(), delay)
    }
  }
}

export const live = new LiveClient()

export function useLiveStatus(): { status: LiveStatus; message: string } {
  const [state, setState] = useState({ status: live.status, message: live.message })
  useEffect(() => live.onStatus((status, message) => setState({ status, message })), [])
  return state
}

/** Latest tick per symbol for a set of symbols (for lists like the watchlist). */
export function useTicks(symbols: string[]): Record<string, Tick> {
  const [ticks, setTicks] = useState<Record<string, Tick>>({})
  const key = symbols.join('|')
  useEffect(() => {
    const offs = symbols.map((s) => live.subscribe(s, (t) => setTicks((prev) => ({ ...prev, [s]: t }))))
    return () => offs.forEach((off) => off())
    // key covers the symbol list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return ticks
}
