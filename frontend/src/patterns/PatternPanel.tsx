import { useMemo, useState, type ReactNode } from 'react'
import type { PatternCatalog, PatternHit, PatternInfo, PatternResult } from '../api/client'
import { Badge, Button, Checkbox, cx, EmptyState, ErrorText, Input, Segmented, Skeleton, Switch, Tabs } from '../ui/kit'
import { ChartPatternSection, DirMark, EyeRow, ListSkeleton, VisibilityBar } from './ChartPatternSection'
import {
  DEFAULT_CHART_PATTERN_SETTINGS,
  type ChartPattern,
  type ChartPatternResult,
  type ChartPatternSettings,
} from './chartPatterns'

export type PatternPreset = 'common' | 'all' | 'custom'

export interface PatternSettings {
  preset: PatternPreset
  custom: string[] // pattern ids used when preset is 'custom'
  inContext: boolean
  mode?: 'candles' | 'chart' // older saved settings lack these
  chart?: ChartPatternSettings
  /** Candlestick hits (hitKey) the user hid from the chart. */
  hiddenHits?: string[]
}

export const hitKey = (h: { time: number; pattern: string }) => `${h.time}-${h.pattern}`

export const patternMode = (s: PatternSettings) => s.mode ?? 'candles'
export const chartSettings = (s: PatternSettings) => ({ ...DEFAULT_CHART_PATTERN_SETTINGS, ...s.chart })

interface Props {
  catalog: PatternCatalog
  settings: PatternSettings
  onSettings: (s: PatternSettings) => void
  result: PatternResult | null
  loading: boolean
  error: string | null
  intraday: boolean
  onFocus: (time: number) => void
  chartResult: ChartPatternResult | null
  chartLoading: boolean
  chartError: string | null
  highlight: string | null
  onPickPattern: (p: ChartPattern) => void
  /** Patterns drawn on the chart. Independent of this panel being open. */
  shown: boolean
  onShown: (shown: boolean) => void
}

const KIND_LABELS: Record<PatternInfo['kind'], string> = {
  reversal: 'Reversal',
  continuation: 'Continuation',
  indecision: 'Indecision',
}

// Stats from fewer hits than this are shown but flagged as unreliable.
const MIN_RELIABLE = 5

export function formatBarTime(time: number, intraday: boolean): string {
  // Times are IST wall-clock encoded as UTC.
  const iso = new Date(time * 1000).toISOString()
  return intraday ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso.slice(0, 10)
}

export function PatternPanel({
  catalog,
  settings,
  onSettings,
  result,
  loading,
  error,
  intraday,
  onFocus,
  chartResult,
  chartLoading,
  chartError,
  highlight,
  onPickPattern,
  shown,
  onShown,
}: Props) {
  const mode = patternMode(settings)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2.5">
        {/* Master switch for all of them; each row's eye hides just that one. */}
        <Switch checked={shown} onChange={onShown} label={<span className="font-medium">Patterns on chart</span>} />
        <span className="flex-1" />
        {!shown && <span className="text-[11px] text-muted">Hidden from the chart</span>}
      </div>
      <Tabs
        className="shrink-0 border-b border-line px-1"
        value={mode}
        onChange={(m) => onSettings({ ...settings, mode: m })}
        items={[
          { id: 'candles', label: 'Candlestick' },
          { id: 'chart', label: 'Chart patterns' },
        ]}
      />
      <div className="flex min-h-0 flex-1 flex-col">
        {mode === 'chart' ? (
          <ChartPatternSection
            settings={chartSettings(settings)}
            onSettings={(chart) => onSettings({ ...settings, chart })}
            result={chartResult}
            loading={chartLoading}
            error={chartError}
            intraday={intraday}
            highlight={highlight}
            onPick={onPickPattern}
          />
        ) : !shown && !result ? (
          // Switched off, nothing is scanned: say so instead of an empty list.
          <EmptyState
            title="Patterns are off"
            action={
              <Button variant="primary" size="sm" onClick={() => onShown(true)}>
                Show patterns
              </Button>
            }
          >
            Turn them on to find candlestick patterns on this chart.
          </EmptyState>
        ) : (
          <CandlestickSection {...{ catalog, settings, onSettings, result, loading, error, intraday, onFocus }} />
        )}
      </div>
    </div>
  )
}

function CandlestickSection({
  catalog,
  settings,
  onSettings,
  result,
  loading,
  error,
  intraday,
  onFocus,
}: Pick<Props, 'catalog' | 'settings' | 'onSettings' | 'result' | 'loading' | 'error' | 'intraday' | 'onFocus'>) {
  const [tab, setTab] = useState<'hits' | 'stats' | 'pick'>('hits')
  const byId = useMemo(() => Object.fromEntries(catalog.patterns.map((p) => [p.id, p])), [catalog])
  const hits = useMemo(() => [...(result?.hits ?? [])].reverse(), [result])

  const set = (patch: Partial<PatternSettings>) => onSettings({ ...settings, ...patch })
  const hidden = new Set(settings.hiddenHits ?? [])
  // Keep only keys of hits still found, so the list doesn't grow forever.
  const setHidden = (keys: Iterable<string>) => {
    const current = new Set(hits.map(hitKey))
    set({ hiddenHits: [...keys].filter((k) => current.has(k)) })
  }
  const toggle = (k: string) => {
    const next = new Set(hidden)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    setHidden(next)
  }
  const hiddenCount = hits.filter((h) => hidden.has(hitKey(h))).length
  const allHidden = hits.length > 0 && hiddenCount === hits.length
  const waiting = loading && !result && !error

  return (
    <>
      <div className="flex shrink-0 flex-col gap-2.5 border-b border-line px-3 py-3">
        <Segmented
          size="sm"
          className="w-full"
          value={settings.preset}
          onChange={(p) => {
            set({ preset: p })
            if (p === 'custom') setTab('pick')
          }}
          options={[
            ['common', 'Common'],
            ['all', `All ${catalog.patterns.length}`],
            ['custom', 'Custom'],
          ]}
        />
        <span title={`Reversals need a prior trend over ${catalog.trend_lookback} bars: bullish after a decline, bearish after a rise`}>
          <Checkbox checked={settings.inContext} onChange={(inContext) => set({ inContext })} label="Only in trend context" />
        </span>
      </div>

      <Tabs
        className="shrink-0 border-b border-line px-1"
        value={tab}
        onChange={setTab}
        items={[
          { id: 'hits', label: 'Hits', badge: result ? result.hits.length : undefined },
          { id: 'stats', label: 'Stats' },
          { id: 'pick', label: 'Patterns', badge: settings.preset === 'custom' ? settings.custom.length : undefined },
        ]}
      />

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {error && tab !== 'pick' && <ErrorText className="m-3">{error}</ErrorText>}

        {tab === 'hits' && waiting && <ListSkeleton />}
        {tab === 'hits' && result && (
          <>
            {hits.length === 0 ? (
              <EmptyState title="No patterns found">
                {settings.preset === 'custom' && settings.custom.length === 0
                  ? 'No patterns are picked. Choose some under Patterns.'
                  : settings.inContext
                    ? 'None on the loaded bars. Try turning off "Only in trend context".'
                    : 'None on the loaded bars.'}
              </EmptyState>
            ) : (
              <VisibilityBar
                shown={hits.length - hiddenCount}
                total={hits.length}
                allHidden={allHidden}
                loading={loading}
                onToggleAll={() => setHidden(allHidden ? [] : hits.map(hitKey))}
              />
            )}
            <ul>
              {hits.map((h) => (
                <HitRow
                  key={hitKey(h)}
                  hidden={hidden.has(hitKey(h))}
                  onToggle={() => toggle(hitKey(h))}
                  hit={h}
                  info={byId[h.pattern]}
                  intraday={intraday}
                  outcomeBars={catalog.outcome_bars}
                  onFocus={onFocus}
                />
              ))}
            </ul>
          </>
        )}

        {tab === 'stats' && waiting && <StatsSkeleton />}
        {tab === 'stats' && result && (
          <>
            <p className="px-3 pt-3 pb-2 text-[12px] leading-relaxed text-muted">
              What happened {catalog.outcome_bars} bars after each hit on the loaded bars. "Win" = price moved the way the pattern
              predicts. Rows under {MIN_RELIABLE} hits are faded: too few to trust.
            </p>
            {result.stats.length === 0 ? (
              <EmptyState title="No stats yet">
                Not enough completed hits yet.
              </EmptyState>
            ) : (
              <table className="w-full border-collapse text-[12px] tabular-nums">
                <thead>
                  <tr className="border-b border-line text-[11px] tracking-wide text-muted uppercase">
                    <th className="px-3 py-2 text-left font-medium">Pattern</th>
                    <th className="px-1 py-2 text-right font-medium">Hits</th>
                    <th className="px-1 py-2 text-right font-medium">Win %</th>
                    <th className="py-2 pr-3 pl-1 text-right font-medium">Avg move</th>
                  </tr>
                </thead>
                <tbody>
                  {result.stats.map((s) => {
                    const good = s.win_rate !== null && s.win_rate >= 50
                    return (
                      <tr key={`${s.pattern}-${s.direction}`} className={cx('border-b border-line', s.count < MIN_RELIABLE && 'opacity-50')}>
                        <td className="px-3 py-2.5">
                          <span className="flex min-w-0 items-center gap-1.5 text-fg">
                            <DirMark direction={s.direction} neutral="●" />
                            <span className="truncate">{byId[s.pattern]?.name ?? s.pattern}</span>
                          </span>
                        </td>
                        <td className="px-1 py-2.5 text-right text-muted">{s.count}</td>
                        <td className={cx('px-1 py-2.5 text-right font-medium', s.win_rate === null ? 'text-muted' : good ? 'text-up' : 'text-down')}>
                          {s.win_rate === null ? '–' : `${s.win_rate}%`}
                        </td>
                        <td className="py-2.5 pr-3 pl-1 text-right text-fg">
                          {s.direction === 'neutral' ? '±' : s.avg_move_pct >= 0 ? '+' : ''}
                          {s.avg_move_pct.toFixed(2)}%
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </>
        )}

        {tab === 'pick' && (
          <PatternPicker catalog={catalog} selected={settings.custom} onChange={(custom) => set({ custom, preset: 'custom' })} />
        )}
      </div>
    </>
  )
}

function StatsSkeleton() {
  return (
    <div aria-busy className="flex flex-col gap-3 p-3">
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-3/4" />
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-3 flex-1" />
          <Skeleton className="h-3 w-8" />
          <Skeleton className="h-3 w-10" />
          <Skeleton className="h-3 w-12" />
        </div>
      ))}
    </div>
  )
}

function HitRow({
  hit,
  info,
  intraday,
  outcomeBars,
  onFocus,
  hidden,
  onToggle,
}: {
  hidden: boolean
  onToggle: () => void
  hit: PatternHit
  info: PatternInfo | undefined
  intraday: boolean
  outcomeBars: number
  onFocus: (time: number) => void
}) {
  const predicted = hit.direction === 'bullish' ? 1 : hit.direction === 'bearish' ? -1 : 0
  const worked = hit.move_pct === null || predicted === 0 ? null : hit.move_pct * predicted > 0
  return (
    <EyeRow
      hidden={hidden}
      onToggle={onToggle}
      onClick={() => onFocus(hit.time)}
      mark={<DirMark direction={hit.direction} neutral="●" />}
      title={
        <>
          <span className="truncate">{info?.name ?? hit.pattern}</span>
          {!hit.in_context && (
            <span title="Prior trend doesn't fit this pattern" className="shrink-0">
              <Badge tone="warn">against trend</Badge>
            </span>
          )}
        </>
      }
      sub={formatBarTime(hit.time, intraday)}
      right={
        <span
          title={`Move ${outcomeBars} bars later`}
          className={cx('font-medium', worked === null ? 'text-muted' : worked ? 'text-up' : 'text-down')}
        >
          {hit.move_pct === null ? 'pending' : `${hit.move_pct >= 0 ? '+' : ''}${hit.move_pct.toFixed(2)}%`}
        </span>
      }
    />
  )
}

function PatternPicker({
  catalog,
  selected,
  onChange,
}: {
  catalog: PatternCatalog
  selected: string[]
  onChange: (ids: string[]) => void
}) {
  const [filter, setFilter] = useState('')
  const chosen = new Set(selected)
  const q = filter.trim().toLowerCase()
  const groups = (['reversal', 'continuation', 'indecision'] as const).map((kind) => ({
    kind,
    items: catalog.patterns.filter((p) => p.kind === kind && p.name.toLowerCase().includes(q)),
  }))

  const toggle = (id: string, on: boolean) => {
    const next = new Set(chosen)
    if (on) next.add(id)
    else next.delete(id)
    onChange(catalog.patterns.map((p) => p.id).filter((i) => next.has(i)))
  }

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-10 flex items-center gap-1.5 border-b border-line bg-surface p-3">
        <Input placeholder="Filter patterns…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <Button onClick={() => onChange(catalog.patterns.filter((p) => p.common).map((p) => p.id))}>
          Common
        </Button>
        <Button variant="ghost" onClick={() => onChange([])}>
          Clear
        </Button>
      </div>
      {groups.every((g) => g.items.length === 0) && (
        <EmptyState title="No match">
          No pattern name contains “{filter.trim()}”.
        </EmptyState>
      )}
      {groups.map(
        (g) =>
          g.items.length > 0 && (
            <section key={g.kind}>
              <h3 className="flex items-center justify-between bg-bg px-3 py-1.5 text-[11px] font-semibold tracking-wider text-muted uppercase">
                {KIND_LABELS[g.kind]}
                <span className="font-medium normal-case tabular-nums">
                  {g.items.filter((p) => chosen.has(p.id)).length}/{g.items.length}
                </span>
              </h3>
              {g.items.map((p) => (
                <PickRow key={p.id}>
                  <Checkbox
                    checked={chosen.has(p.id)}
                    onChange={(on) => toggle(p.id, on)}
                    label={
                      <>
                        {p.name}
                        {!p.common && <span className="ml-1.5 text-[11px] text-muted">rare/noisy</span>}
                      </>
                    }
                  />
                </PickRow>
              ))}
            </section>
          ),
      )}
    </div>
  )
}

// The checkbox label fills the row, so the whole 40px row is the tap target.
function PickRow({ children }: { children: ReactNode }) {
  return <div className="flex min-h-10 items-stretch border-b border-line px-3 hover:bg-hover [&>label]:flex-1 [&>label]:gap-2.5">{children}</div>
}
