import type { ReactNode } from 'react'
import { Badge, Checkbox, cx, EmptyState, ErrorText, Segmented, Skeleton, Spinner } from '../ui/kit'
import { patternKey, zoneKey, type ChartPattern, type ChartPatternResult, type ChartPatternSettings, type PatternStatus } from './chartPatterns'
import { formatBarTime } from './PatternPanel'

const STATUS_ORDER = { forming: 0, confirmed: 1, failed: 2 }
const STATUS_TONE: Record<PatternStatus, 'warn' | 'up' | 'neutral'> = { forming: 'warn', confirmed: 'up', failed: 'neutral' }
const SENSITIVITY_HINT = { low: 'Major swings only (3× ATR)', medium: 'Swing trading (2× ATR)', high: 'Minor swings too (1.3× ATR)' }
const fmtPrice = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 2 })

/** Chart patterns tab of the Patterns side panel. */
export function ChartPatternSection({
  settings,
  onSettings,
  result,
  loading,
  error,
  intraday,
  highlight,
  onPick,
}: {
  settings: ChartPatternSettings
  onSettings: (s: ChartPatternSettings) => void
  result: ChartPatternResult | null
  loading: boolean
  error: string | null
  intraday: boolean
  highlight: string | null
  onPick: (p: ChartPattern) => void
}) {
  const set = (patch: Partial<ChartPatternSettings>) => onSettings({ ...settings, ...patch })
  const patterns = [...(result?.patterns ?? [])]
    .filter((p) => settings.showFailed || p.status !== 'failed')
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.end_time - a.end_time)
  const hidden = new Set(settings.hidden ?? [])
  // Keep only keys of patterns still found, so the list doesn't grow forever.
  const current = new Set((result?.patterns ?? []).map(patternKey))
  const setHidden = (keys: Iterable<string>) => set({ hidden: [...keys].filter((k) => current.has(k)) })
  const toggle = (k: string) => {
    const next = new Set(hidden)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    setHidden(next)
  }
  const shownKeys = new Set(patterns.map(patternKey))
  const hiddenCount = patterns.filter((p) => hidden.has(patternKey(p))).length
  const allHidden = patterns.length > 0 && hiddenCount === patterns.length

  return (
    <>
      <div className="flex shrink-0 flex-col gap-2.5 border-b border-line px-3 py-3">
        <div className="flex items-center gap-2" title={SENSITIVITY_HINT[settings.sensitivity]}>
          <span className="text-[12px] font-medium text-muted">Sensitivity</span>
          <Segmented
            size="sm"
            className="flex-1"
            value={settings.sensitivity}
            onChange={(sensitivity) => set({ sensitivity })}
            options={[
              ['low', 'Low'],
              ['medium', 'Medium'],
              ['high', 'High'],
            ]}
          />
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          <Checkbox checked={settings.showZones} onChange={(showZones) => set({ showZones })} label="Support / resistance" />
          <Checkbox checked={settings.showFailed} onChange={(showFailed) => set({ showFailed })} label="Show failed" />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {error && <ErrorText className="m-3">{error}</ErrorText>}
        {loading && !result && !error && <ListSkeleton />}
        {result && patterns.length === 0 && (
          <EmptyState title="No chart patterns">
            None on the loaded bars{settings.sensitivity !== 'high' ? '. Try a higher sensitivity or scroll back for more history.' : '.'}
          </EmptyState>
        )}
        {patterns.length > 0 && (
          <VisibilityBar
            shown={patterns.length - hiddenCount}
            total={patterns.length}
            allHidden={allHidden}
            loading={loading}
            onToggleAll={() => setHidden(allHidden ? [...hidden].filter((k) => !shownKeys.has(k)) : [...hidden, ...shownKeys])}
          />
        )}
        <ul>
          {patterns.map((p) => {
            const k = patternKey(p)
            return (
              <EyeRow
                key={k}
                hidden={hidden.has(k)}
                onToggle={() => toggle(k)}
                onClick={() => onPick(p)}
                picked={highlight === k}
                mark={<DirMark direction={p.direction} />}
                title={
                  <>
                    <span className="truncate">{p.name}</span>
                    <Badge tone={STATUS_TONE[p.status]} className="shrink-0 capitalize">
                      {p.status}
                    </Badge>
                  </>
                }
                sub={`${formatBarTime(p.start_time, intraday)} → ${formatBarTime(p.end_time, intraday)}`}
                right={
                  p.target !== null && p.status !== 'failed' ? (
                    <span className="flex flex-col items-end leading-tight">
                      <span className="text-[10px] text-muted">Target</span>
                      <span className="font-medium text-fg">{fmtPrice(p.target)}</span>
                    </span>
                  ) : null
                }
              />
            )
          })}
        </ul>
        {result && settings.showZones && result.zones.length > 0 && <ZoneList zones={result.zones} settings={settings} set={set} />}
      </div>
    </>
  )
}

export function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <path d="M1.5 9s2.8-5 7.5-5 7.5 5 7.5 5-2.8 5-7.5 5-7.5-5-7.5-5z" />
      <circle cx="9" cy="9" r="2.2" />
      {off && <path d="M3 15L15 3" />}
    </svg>
  )
}

/** ▲ / ▼ / ◆ in the direction's color. */
export function DirMark({ direction, neutral = '◆' }: { direction: 'bullish' | 'bearish' | 'neutral'; neutral?: string }) {
  return (
    <span
      aria-label={direction}
      className={cx(
        'inline-flex w-4 shrink-0 justify-center text-[11px]',
        direction === 'bullish' ? 'text-up' : direction === 'bearish' ? 'text-down' : 'text-muted',
      )}
    >
      {direction === 'bullish' ? '▲' : direction === 'bearish' ? '▼' : neutral}
    </span>
  )
}

/** A list row with its own show/hide eye; dimmed while hidden from the chart. */
export function EyeRow({
  hidden,
  onToggle,
  onClick,
  picked,
  mark,
  title,
  sub,
  right,
}: {
  hidden: boolean
  onToggle: () => void
  onClick: () => void
  picked?: boolean
  mark: ReactNode
  title: ReactNode
  sub?: ReactNode
  right?: ReactNode
}) {
  return (
    <li className={cx('flex items-stretch border-b border-line transition-colors', picked ? 'bg-selected' : 'hover:bg-hover')}>
      <button
        aria-pressed={!hidden}
        aria-label={hidden ? 'Show on the chart' : 'Hide from the chart'}
        title={hidden ? 'Show on the chart' : 'Hide from the chart'}
        onClick={onToggle}
        className={cx('flex w-11 shrink-0 items-center justify-center transition hover:text-fg', hidden ? 'text-muted opacity-60' : 'text-accent')}
      >
        <EyeIcon off={hidden} />
      </button>
      <button onClick={onClick} className={cx('flex min-h-12 min-w-0 flex-1 items-center gap-2 py-2 pr-3 text-left transition-opacity', hidden && 'opacity-45')}>
        {mark}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium text-fg">{title}</span>
          {sub && <span className="truncate text-[11px] text-muted tabular-nums">{sub}</span>}
        </span>
        {right != null && <span className="shrink-0 text-right text-[12px] tabular-nums">{right}</span>}
      </button>
    </li>
  )
}

/** "3 of 5 on the chart · Hide all" above an eye list. */
export function VisibilityBar({
  shown,
  total,
  allHidden,
  loading,
  onToggleAll,
  title,
}: {
  shown: number
  total: number
  allHidden: boolean
  loading?: boolean
  onToggleAll: () => void
  title?: ReactNode
}) {
  return (
    <div className="flex h-10 items-center gap-2 border-b border-line bg-bg px-3 text-[12px] text-muted">
      {title ?? (
        <span className="tabular-nums">
          {shown} of {total} on the chart
        </span>
      )}
      {loading && <Spinner size={12} />}
      <span className="flex-1" />
      <button onClick={onToggleAll} className="-mr-1 h-8 rounded-md px-2 text-[12px] font-semibold text-accent transition hover:bg-hover">
        {allHidden ? 'Show all' : 'Hide all'}
      </button>
    </div>
  )
}

export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-busy>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex min-h-12 items-center gap-3 border-b border-line px-3">
          <Skeleton className="size-4 rounded-full" />
          <span className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-2.5 w-20" />
          </span>
          <Skeleton className="h-3 w-12" />
        </div>
      ))}
    </div>
  )
}

/** Support/resistance levels, strongest first, each with its own eye. */
function ZoneList({
  zones,
  settings,
  set,
}: {
  zones: ChartPatternResult['zones']
  settings: ChartPatternSettings
  set: (patch: Partial<ChartPatternSettings>) => void
}) {
  const hidden = new Set(settings.hiddenZones ?? [])
  const current = new Set(zones.map(zoneKey))
  const setHidden = (keys: Iterable<string>) => set({ hiddenZones: [...keys].filter((k) => current.has(k)) })
  const toggle = (k: string) => {
    const next = new Set(hidden)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    setHidden(next)
  }
  const allHidden = zones.every((z) => hidden.has(zoneKey(z)))
  return (
    <>
      <VisibilityBar
        shown={zones.length - zones.filter((z) => hidden.has(zoneKey(z))).length}
        total={zones.length}
        allHidden={allHidden}
        onToggleAll={() => setHidden(allHidden ? [] : zones.map(zoneKey))}
        title={<b className="text-[12px] font-semibold tracking-wide text-fg uppercase">Support &amp; resistance</b>}
      />
      <ul>
        {zones.map((z) => {
          const k = zoneKey(z)
          const support = z.kind === 'support'
          return (
            <EyeRow
              key={k}
              hidden={hidden.has(k)}
              onToggle={() => toggle(k)}
              onClick={() => toggle(k)}
              mark={
                <span
                  className={cx(
                    'inline-flex size-5 shrink-0 items-center justify-center rounded text-[10px] font-bold',
                    support ? 'bg-up-soft text-up' : 'bg-down-soft text-down',
                  )}
                >
                  {support ? 'S' : 'R'}
                </span>
              }
              title={
                <span className="truncate tabular-nums">
                  {fmtPrice(z.low)} – {fmtPrice(z.high)}
                </span>
              }
              sub={`${support ? 'Support' : 'Resistance'} · ${z.touches} touches`}
            />
          )
        })}
      </ul>
    </>
  )
}
