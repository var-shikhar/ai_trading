/** When the forming candle closes, by the exchange session (the same
 * bucketing the backend uses for bars). Times are IST wall time as epoch. */

export const IST_OFFSET = 19800
const DAY = 86400
const TF_MINUTES: Record<string, number> = { '1m': 1, '5m': 5, '15m': 15, '30m': 30, '1h': 60, '2h': 120, '4h': 240 }

export interface Session {
  start: number // seconds after midnight IST
  end: number
}
// The same sessions the backend buckets bars by.
export const NSE_SESSION: Session = { start: 9 * 3600 + 15 * 60, end: 15 * 3600 + 30 * 60 }
export const MCX_SESSION: Session = { start: 9 * 3600, end: 23 * 3600 + 30 * 60 }
export const sessionFor = (symbol: string) => (symbol.startsWith('MCX:') ? MCX_SESSION : NSE_SESSION)

/** Seconds until the forming candle closes, or null outside the session.
 * `now` is IST wall time as epoch seconds (how bar times are stored). */
export function secondsToClose(tf: string, now: number, session: Session): number | null {
  const day = now - (now % DAY)
  const weekday = new Date(day * 1000).getUTCDay() // 0 Sunday
  if (weekday === 0 || weekday === 6) return null
  const open = day + session.start
  const end = day + session.end
  if (now < open || now >= end) return null
  const m = TF_MINUTES[tf]
  if (m) {
    const len = m * 60
    const close = open + (Math.floor((now - open) / len) + 1) * len
    return Math.min(close, end) - now // the day's last bar closes with the session
  }
  if (tf === '1D') return end - now
  if (tf === '1W') return end + (5 - weekday) * DAY - now // Friday's close
  if (tf === '1M') {
    const d = new Date(day * 1000)
    let last = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0) / 1000 // last calendar day
    while ([0, 6].includes(new Date(last * 1000).getUTCDay())) last -= DAY // last weekday
    return last + session.end - now
  }
  return null
}

export function formatCountdown(s: number): string {
  const d = Math.floor(s / DAY)
  const h = Math.floor((s % DAY) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const two = (n: number) => String(n).padStart(2, '0')
  if (d) return `${d}d ${two(h)}:${two(m)}`
  return h ? `${h}:${two(m)}:${two(sec)}` : `${two(m)}:${two(sec)}`
}
