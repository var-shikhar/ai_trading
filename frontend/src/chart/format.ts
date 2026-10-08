// Bar times are IST wall-clock encoded as UTC epoch seconds, so read them
// with the UTC getters.
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const pad = (n: number) => String(n).padStart(2, '0')

/** TradingView-style crosshair label: "Tue 07 Oct '26  14:15". */
export function formatCrosshairTime(time: number, intraday: boolean): string {
  const d = new Date(time * 1000)
  const date = `${DAYS[d.getUTCDay()]} ${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} '${pad(d.getUTCFullYear() % 100)}`
  return intraday ? `${date}  ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` : date
}

/** "2026-10-07" or "2026-10-07 14:15". */
export function formatBarTime(time: number, intraday: boolean): string {
  const iso = new Date(time * 1000).toISOString()
  return intraday ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso.slice(0, 10)
}

/** Current IST wall time as the same "UTC" epoch the bars use. */
export function nowIstEpoch(): number {
  return Math.floor(Date.now() / 1000) + 5.5 * 3600
}
