import { useEffect, useState } from 'react'
import type { ScaleMode } from '../chart/PriceChart'

/** TradingView's bottom range buttons: each picks a timeframe and a span. */
export const RANGES: { label: string; tf: string; days: number | 'ytd' | 'all'; title: string }[] = [
  { label: '1D', tf: '1m', days: 1, title: '1 day in 1 minute intervals' },
  { label: '5D', tf: '5m', days: 5, title: '5 days in 5 minute intervals' },
  { label: '1M', tf: '30m', days: 30, title: '1 month in 30 minute intervals' },
  { label: '3M', tf: '1h', days: 91, title: '3 months in 1 hour intervals' },
  { label: '6M', tf: '2h', days: 182, title: '6 months in 2 hour intervals' },
  { label: 'YTD', tf: '1D', days: 'ytd', title: 'Year to date in 1 day intervals' },
  { label: '1Y', tf: '1D', days: 365, title: '1 year in 1 day intervals' },
  { label: '5Y', tf: '1W', days: 1826, title: '5 years in 1 week intervals' },
  { label: 'All', tf: '1M', days: 'all', title: 'All data in 1 month intervals' },
]

export function BottomBar({
  activeRange,
  onRange,
  onGoTo,
  intraday,
  scaleMode,
  onScaleMode,
  status,
}: {
  activeRange: string | null
  onRange: (label: string) => void
  onGoTo: (epoch: number) => void
  intraday: boolean
  scaleMode: ScaleMode
  onScaleMode: (m: ScaleMode) => void
  status: string
}) {
  const [goOpen, setGoOpen] = useState(false)
  return (
    <footer className="bottombar">
      {RANGES.map((r) => (
        <button
          key={r.label}
          className={`tool-button small ${activeRange === r.label ? 'selected' : ''}`}
          title={r.title}
          onClick={() => onRange(r.label)}
        >
          {r.label}
        </button>
      ))}
      <span className="divider" />
      <div className="goto">
        <button className="tool-button small" title="Go to date" onClick={() => setGoOpen((o) => !o)}>
          <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
            <rect x="2.5" y="3.5" width="13" height="12" rx="1.5" />
            <path d="M2.5 7h13M6 2v3M12 2v3" />
          </svg>
        </button>
        {goOpen && (
          <GoToDate
            intraday={intraday}
            onGo={(e) => {
              onGoTo(e)
              setGoOpen(false)
            }}
            onClose={() => setGoOpen(false)}
          />
        )}
      </div>
      <span className="spacer" />
      <span className="status small">{status}</span>
      <span className="divider" />
      <Clock />
      <span className="divider" />
      <button
        className={`tool-button small ${scaleMode === 'percent' ? 'selected' : ''}`}
        title="Percentage scale"
        onClick={() => onScaleMode(scaleMode === 'percent' ? 'normal' : 'percent')}
      >
        %
      </button>
      <button
        className={`tool-button small ${scaleMode === 'log' ? 'selected' : ''}`}
        title="Logarithmic scale"
        onClick={() => onScaleMode(scaleMode === 'log' ? 'normal' : 'log')}
      >
        log
      </button>
      <button
        className={`tool-button small ${scaleMode === 'normal' ? 'selected' : ''}`}
        title="Regular scale"
        onClick={() => onScaleMode('normal')}
      >
        auto
      </button>
    </footer>
  )
}

function GoToDate({
  intraday,
  onGo,
  onClose,
}: {
  intraday: boolean
  onGo: (epoch: number) => void
  onClose: () => void
}) {
  const [today] = useState(() => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10))
  const [date, setDate] = useState(today)
  const [time, setTime] = useState('09:15')
  return (
    <form
      className="popover goto-popover"
      onSubmit={(e) => {
        e.preventDefault()
        // Bars use IST wall time as UTC epoch.
        const iso = `${date}T${intraday ? time : '00:00'}:00Z`
        const epoch = Date.parse(iso) / 1000
        if (Number.isFinite(epoch)) onGo(epoch)
      }}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div className="popover-title">Go to</div>
      <input type="date" value={date} max={today} min="2000-01-01" onChange={(e) => setDate(e.target.value)} autoFocus />
      {intraday && <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />}
      <div className="popover-actions">
        <button type="button" className="secondary-button" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="primary-button">
          Go to
        </button>
      </div>
    </form>
  )
}

function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  const ist = new Date(now.getTime() + 5.5 * 3600 * 1000).toISOString().slice(11, 19)
  return (
    <span className="clock" title="India Standard Time">
      {ist} (UTC+5:30)
    </span>
  )
}
