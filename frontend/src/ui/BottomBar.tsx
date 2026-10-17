import { useEffect, useRef, useState, type ButtonHTMLAttributes } from 'react'
import type { ScaleMode } from '../chart/PriceChart'
import { Button, cx, inputClass } from './kit'

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

function BarButton({ selected, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return (
    <button
      {...rest}
      aria-pressed={selected}
      className={cx(
        'inline-flex h-[26px] shrink-0 cursor-pointer items-center justify-center rounded px-[7px] text-[12px] font-medium whitespace-nowrap transition hover:bg-hover',
        selected ? 'text-accent' : 'text-fg',
        className,
      )}
    />
  )
}

const Divider = ({ className }: { className?: string }) => <span className={cx('mx-1 h-[18px] w-px shrink-0 bg-line', className)} />

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
  const goRef = useRef<HTMLDivElement>(null)
  // Close the go-to popover on a click anywhere else.
  useEffect(() => {
    if (!goOpen) return
    const onDown = (e: PointerEvent) => !goRef.current?.contains(e.target as Node) && setGoOpen(false)
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [goOpen])
  return (
    <footer className="flex h-[34px] shrink-0 items-center gap-0.5 border-t border-line bg-surface px-2 max-md:overflow-x-auto max-md:[scrollbar-width:none]">
      {RANGES.map((r) => (
        <BarButton key={r.label} selected={activeRange === r.label} title={r.title} onClick={() => onRange(r.label)}>
          {r.label}
        </BarButton>
      ))}
      <Divider />
      {/* Static on phones: the bar scrolls sideways, which would clip an absolute popover. */}
      <div ref={goRef} className="relative max-md:static">
        <BarButton title="Go to date" aria-label="Go to date" selected={goOpen} onClick={() => setGoOpen((o) => !o)}>
          <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
            <rect x="2.5" y="3.5" width="13" height="12" rx="1.5" />
            <path d="M2.5 7h13M6 2v3M12 2v3" />
          </svg>
        </BarButton>
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
      <span className="flex-1" />
      <span className="min-w-0 truncate text-[12px] whitespace-nowrap text-muted max-md:hidden">{status}</span>
      <Divider className="max-md:hidden" />
      <Clock />
      <Divider className="max-md:hidden" />
      <BarButton
        selected={scaleMode === 'percent'}
        title="Percentage scale"
        onClick={() => onScaleMode(scaleMode === 'percent' ? 'normal' : 'percent')}
      >
        %
      </BarButton>
      <BarButton
        selected={scaleMode === 'log'}
        title="Logarithmic scale"
        onClick={() => onScaleMode(scaleMode === 'log' ? 'normal' : 'log')}
      >
        log
      </BarButton>
      <BarButton selected={scaleMode === 'normal'} title="Regular scale" onClick={() => onScaleMode('normal')}>
        auto
      </BarButton>
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
      className="absolute bottom-[calc(100%+6px)] left-0 z-50 flex w-[260px] animate-pop flex-col gap-2.5 rounded-xl border border-line bg-raised p-3.5 shadow-[var(--shadow)] max-md:fixed max-md:right-3 max-md:bottom-[calc(120px+env(safe-area-inset-bottom))] max-md:left-3 max-md:w-auto"
      onSubmit={(e) => {
        e.preventDefault()
        // Bars use IST wall time as UTC epoch.
        const iso = `${date}T${intraday ? time : '00:00'}:00Z`
        const epoch = Date.parse(iso) / 1000
        if (Number.isFinite(epoch)) onGo(epoch)
      }}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div className="text-[14px] font-semibold text-fg">Go to</div>
      <input
        type="date"
        className={cx(inputClass, 'h-9')}
        value={date}
        max={today}
        min="2000-01-01"
        onChange={(e) => setDate(e.target.value)}
        autoFocus
      />
      {intraday && <input type="time" className={cx(inputClass, 'h-9')} value={time} onChange={(e) => setTime(e.target.value)} />}
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" size="sm" variant="primary">
          Go to
        </Button>
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
    <span className="px-1.5 text-[12px] whitespace-nowrap text-fg tabular-nums max-md:hidden" title="India Standard Time">
      {ist} (UTC+5:30)
    </span>
  )
}
