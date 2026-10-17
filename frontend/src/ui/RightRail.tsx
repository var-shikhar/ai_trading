import type { ReactNode } from 'react'
import { cx } from './kit'

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
  // The strategy on the chart ('strategy' dock) is hidden for now; its panel
  // and report still work if it was switched on before.
]

const MOBILE_TABS: { id: Dock | null; label: string }[] = [
  { id: null, label: 'Chart' },
  { id: 'patterns', label: 'Patterns' },
  { id: 'alerts', label: 'Alerts' },
]

/** Phones: the stock screen's tabs under the chart (instead of the right
 * rail). Each opens its panel as a sheet over the lower part of the chart. */
export function MobileChartTabs({
  dock,
  onDock,
  badges,
}: {
  dock: Dock | null
  onDock: (d: Dock | null) => void
  badges: Partial<Record<Dock, string | number | null>>
}) {
  return (
    <div className="flex shrink-0 border-t border-line bg-surface" role="tablist" aria-label="Stock">
      {MOBILE_TABS.map((t) => (
        <button
          key={t.label}
          role="tab"
          aria-selected={dock === t.id}
          className={cx(
            'relative flex flex-1 cursor-pointer items-center justify-center gap-1.5 border-t-2 px-1 py-2.5 text-[13px] font-medium transition',
            dock === t.id ? 'border-accent text-accent' : 'border-transparent text-muted active:bg-hover',
          )}
          onClick={() => onDock(t.id === dock ? null : t.id)}
        >
          {t.label}
          {t.id && badges[t.id] != null && (
            <span className="rounded-full bg-accent px-1.5 text-[10px] leading-4 font-semibold text-accent-fg">{badges[t.id]}</span>
          )}
        </button>
      ))}
    </div>
  )
}

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
    <nav
      className="flex w-[46px] shrink-0 flex-col items-center gap-1 border-l border-line bg-surface py-1.5 max-md:w-[42px]"
      aria-label="Chart panels"
    >
      {ITEMS.map((i) => (
        <button
          key={i.id}
          className={cx(
            'relative inline-flex size-9 cursor-pointer items-center justify-center rounded-md transition max-md:size-[34px]',
            dock === i.id ? 'bg-selected text-accent' : 'text-muted hover:bg-hover hover:text-fg',
          )}
          title={i.title}
          aria-label={i.title}
          aria-pressed={dock === i.id}
          onClick={() => onDock(dock === i.id ? null : i.id)}
        >
          {i.icon}
          {badges[i.id] != null && (
            <span className="absolute top-px right-px min-w-3.5 rounded-full bg-accent px-[3px] text-center text-[9px] leading-3.5 font-semibold text-accent-fg">
              {badges[i.id]}
            </span>
          )}
        </button>
      ))}
    </nav>
  )
}
