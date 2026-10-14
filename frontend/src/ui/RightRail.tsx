import type { ReactNode } from 'react'

export type Dock = 'watchlist' | 'alerts' | 'patterns' | 'strategy'

const icon = (d: ReactNode) => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
    {d}
  </svg>
)

const ITEMS: { id: Dock; title: string; icon: ReactNode }[] = [
  { id: 'watchlist', title: 'Watchlist', icon: icon(<path d="M4 5h12M4 10h12M4 15h8" />) },
  { id: 'alerts', title: 'Alerts', icon: icon(<path d="M6 14V9a4 4 0 0 1 8 0v5l1.5 1.5h-11zM8.5 17.5h3" />) },
  {
    id: 'patterns',
    title: 'Candlestick & chart patterns',
    icon: icon(
      <>
        <path d="M6 3v3M6 14v3M14 5v2M14 13v3" />
        <rect x="4" y="6" width="4" height="8" rx=".5" />
        <rect x="12" y="7" width="4" height="6" rx=".5" />
      </>,
    ),
  },
  { id: 'strategy', title: 'Strategy on chart (backtest live)', icon: icon(<path d="M3 16h14M5 13l3-4 3 2 5-6" />) },
]

/** Icon strip on the chart's right edge (as TradingView): each opens a panel
 * docked beside the chart, which stays until it's clicked again. */
export function RightRail({
  dock,
  onDock,
  badges,
}: {
  dock: Dock | null
  onDock: (d: Dock | null) => void
  badges: Partial<Record<Dock, string | number | null>>
}) {
  return (
    <nav className="right-rail" aria-label="Chart panels">
      {ITEMS.map((i) => (
        <button
          key={i.id}
          className={`rail-button ${dock === i.id ? 'active' : ''}`}
          title={i.title}
          aria-label={i.title}
          aria-pressed={dock === i.id}
          onClick={() => onDock(dock === i.id ? null : i.id)}
        >
          {i.icon}
          {badges[i.id] != null && <em className="rail-badge">{badges[i.id]}</em>}
        </button>
      ))}
    </nav>
  )
}
