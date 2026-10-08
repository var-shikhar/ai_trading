import type { Candle } from '../api/client'
import type { Tick } from './liveClient'

const DAY = 86400

/** Start of the bar a time falls in, matching the server's bucketing:
 * intraday bars count from the session open (09:15 NSE, 09:00 MCX). */
export function barStart(time: number, tf: string, sessionStart: string): number | null {
  const day = Math.floor(time / DAY) * DAY
  const minutes: Record<string, number> = { '1m': 1, '5m': 5, '15m': 15, '30m': 30, '1h': 60, '2h': 120, '4h': 240 }
  const m = minutes[tf]
  if (m) {
    const [h, mi] = sessionStart.split(':').map(Number)
    const origin = day + h * 3600 + mi * 60
    if (time < origin) return null // pre-open
    return origin + Math.floor((time - origin) / (m * 60)) * m * 60
  }
  if (tf === '1W') {
    const weekday = (new Date(day * 1000).getUTCDay() + 6) % 7 // Monday = 0
    return day - weekday * DAY
  }
  if (tf === '1M') {
    const d = new Date(day * 1000)
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000
  }
  return day
}

/** Running state of the bar being formed from ticks. */
export interface LiveBar {
  bar: Candle
  /** Cumulative day volume at the first tick seen in this bar, and the bar's
   * volume at that moment, so bar volume = base + (now - start). */
  volStart: number | null
  volBase: number
}

/** Apply a tick to the current live bar (or the last loaded bar). Returns
 * the new state and whether a new bar started. */
export function applyTick(
  prev: LiveBar | null,
  last: Candle | undefined,
  tick: Tick,
  tf: string,
  sessionStart: string,
): { state: LiveBar; newBar: boolean } | null {
  const start = barStart(tick.time, tf, sessionStart)
  if (start === null) return null
  const current = prev && (!last || prev.bar.time >= last.time) ? prev : null
  const ref = current?.bar ?? last
  if (ref && start < ref.time) return null // tick for an older bar
  const daily = tf === '1D'
  const dayVolume = tick.volume ?? null

  if (ref && start === ref.time) {
    const state = current ?? { bar: ref, volStart: dayVolume, volBase: ref.volume }
    const b = state.bar
    const volume =
      daily && dayVolume !== null
        ? dayVolume
        : dayVolume !== null && state.volStart !== null
          ? state.volBase + Math.max(0, dayVolume - state.volStart)
          : b.volume
    return {
      newBar: false,
      state: {
        ...state,
        bar: {
          ...b,
          // Daily bars take the exchange's day high/low/open directly.
          open: daily && tick.open ? tick.open : b.open,
          high: Math.max(b.high, tick.ltp, daily && tick.high ? tick.high : -Infinity),
          low: Math.min(b.low, tick.ltp, daily && tick.low ? tick.low : Infinity),
          close: tick.ltp,
          volume,
        },
      },
    }
  }
  return {
    newBar: true,
    state: {
      bar: {
        time: start,
        open: daily && tick.open ? tick.open : tick.ltp,
        high: daily && tick.high ? Math.max(tick.high, tick.ltp) : tick.ltp,
        low: daily && tick.low ? Math.min(tick.low, tick.ltp) : tick.ltp,
        close: tick.ltp,
        volume: daily && dayVolume !== null ? dayVolume : 0,
      },
      volStart: dayVolume,
      volBase: 0,
    },
  }
}

/** Loaded candles with the live bar replacing or extending the last one. */
export function withLiveBar(candles: Candle[], live: Candle | null): Candle[] {
  if (!live || !candles.length) return candles
  const last = candles[candles.length - 1]
  if (live.time < last.time) return candles
  if (live.time === last.time) return [...candles.slice(0, -1), live]
  return [...candles, live]
}
