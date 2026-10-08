import { useMemo, useState } from 'react'
import type { Direction, PatternCatalog, PatternHit, PatternInfo, PatternResult } from '../api/client'
import { ChartPatternSection } from './ChartPatternSection'
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
}

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
}

const KIND_LABELS: Record<PatternInfo['kind'], string> = {
  reversal: 'Reversal',
  continuation: 'Continuation',
  indecision: 'Indecision',
}

// Stats from fewer hits than this are shown but flagged as unreliable.
const MIN_RELIABLE = 5

const ARROW: Record<Direction, string> = { bullish: '▲', bearish: '▼', neutral: '●' }

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
}: Props) {
  const mode = patternMode(settings)
  const modeTabs = (
    <div className="tabs mode-tabs" role="tablist" aria-label="Pattern type">
      <button role="tab" className={mode === 'candles' ? 'active' : ''} onClick={() => onSettings({ ...settings, mode: 'candles' })}>
        Candlestick
      </button>
      <button role="tab" className={mode === 'chart' ? 'active' : ''} onClick={() => onSettings({ ...settings, mode: 'chart' })}>
        Chart patterns
      </button>
    </div>
  )
  if (mode === 'chart') {
    return (
      <aside className="pattern-panel">
        {modeTabs}
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
      </aside>
    )
  }
  return <CandlestickSection {...{ catalog, settings, onSettings, result, loading, error, intraday, onFocus, modeTabs }} />
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
  modeTabs,
}: Pick<Props, 'catalog' | 'settings' | 'onSettings' | 'result' | 'loading' | 'error' | 'intraday' | 'onFocus'> & {
  modeTabs: React.ReactNode
}) {
  const [tab, setTab] = useState<'hits' | 'stats' | 'pick'>('hits')
  const byId = useMemo(() => Object.fromEntries(catalog.patterns.map((p) => [p.id, p])), [catalog])
  const hits = useMemo(() => [...(result?.hits ?? [])].reverse(), [result])

  const set = (patch: Partial<PatternSettings>) => onSettings({ ...settings, ...patch })

  return (
    <aside className="pattern-panel">
      {modeTabs}
      <div className="panel-head">
        <div className="segmented small" role="group" aria-label="Pattern set">
          {(['common', 'all', 'custom'] as const).map((p) => (
            <button
              key={p}
              className={settings.preset === p ? 'active' : ''}
              onClick={() => {
                set({ preset: p })
                if (p === 'custom') setTab('pick')
              }}
            >
              {p === 'common' ? 'Common' : p === 'all' ? `All ${catalog.patterns.length}` : 'Custom'}
            </button>
          ))}
        </div>
        <label
          className="check"
          title={`Reversals need a prior trend over ${catalog.trend_lookback} bars: bullish after a decline, bearish after a rise`}
        >
          <input
            type="checkbox"
            checked={settings.inContext}
            onChange={(e) => set({ inContext: e.target.checked })}
          />
          Only in trend context
        </label>
      </div>

      <div className="tabs" role="tablist">
        <button role="tab" className={tab === 'hits' ? 'active' : ''} onClick={() => setTab('hits')}>
          Hits {result ? `(${result.hits.length})` : ''}
        </button>
        <button role="tab" className={tab === 'stats' ? 'active' : ''} onClick={() => setTab('stats')}>
          Stats
        </button>
        <button role="tab" className={tab === 'pick' ? 'active' : ''} onClick={() => setTab('pick')}>
          Patterns
          {settings.preset === 'custom' ? ` (${settings.custom.length})` : ''}
        </button>
      </div>

      <div className="panel-body">
        {error && <p className="status err">{error}</p>}
        {loading && !result && <p className="status">Scanning…</p>}

        {tab === 'hits' && result && (
          <>
            {hits.length === 0 && <p className="status">No patterns on the loaded bars.</p>}
            <ul className="hit-list">
              {hits.map((h) => (
                <HitRow
                  key={`${h.time}-${h.pattern}`}
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

        {tab === 'stats' && result && (
          <>
            <p className="note">
              What happened {catalog.outcome_bars} bars after each hit on the loaded bars. "Win" = price
              moved the way the pattern predicts. Rows under {MIN_RELIABLE} hits are faded: too few to
              trust.
            </p>
            <table className="stats">
              <thead>
                <tr>
                  <th>Pattern</th>
                  <th className="num">Hits</th>
                  <th className="num">Win %</th>
                  <th className="num">Avg move</th>
                </tr>
              </thead>
              <tbody>
                {result.stats.map((s) => (
                  <tr key={`${s.pattern}-${s.direction}`} className={s.count < MIN_RELIABLE ? 'faded' : ''}>
                    <td>
                      <span className={`dir ${s.direction}`}>{ARROW[s.direction]}</span>{' '}
                      {byId[s.pattern]?.name ?? s.pattern}
                    </td>
                    <td className="num">{s.count}</td>
                    <td className="num">{s.win_rate === null ? '–' : `${s.win_rate}%`}</td>
                    <td className="num">
                      {s.direction === 'neutral' ? '±' : s.avg_move_pct >= 0 ? '+' : ''}
                      {s.avg_move_pct.toFixed(2)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {result.stats.length === 0 && <p className="status">Not enough completed hits yet.</p>}
          </>
        )}

        {tab === 'pick' && (
          <PatternPicker
            catalog={catalog}
            selected={settings.custom}
            onChange={(custom) => set({ custom, preset: 'custom' })}
          />
        )}
      </div>
    </aside>
  )
}

function HitRow({
  hit,
  info,
  intraday,
  outcomeBars,
  onFocus,
}: {
  hit: PatternHit
  info: PatternInfo | undefined
  intraday: boolean
  outcomeBars: number
  onFocus: (time: number) => void
}) {
  const predicted = hit.direction === 'bullish' ? 1 : hit.direction === 'bearish' ? -1 : 0
  const worked = hit.move_pct === null || predicted === 0 ? null : hit.move_pct * predicted > 0
  return (
    <li>
      <button onClick={() => onFocus(hit.time)}>
        <span className={`dir ${hit.direction}`}>{ARROW[hit.direction]}</span>
        <span className="hit-name">
          {info?.name ?? hit.pattern}
          {!hit.in_context && <em title="Prior trend doesn't fit this pattern"> · against trend</em>}
        </span>
        <span className="hit-time">{formatBarTime(hit.time, intraday)}</span>
        <span
          className={`hit-move ${worked === null ? '' : worked ? 'win' : 'loss'}`}
          title={`Move ${outcomeBars} bars later`}
        >
          {hit.move_pct === null ? 'pending' : `${hit.move_pct >= 0 ? '+' : ''}${hit.move_pct.toFixed(2)}%`}
        </span>
      </button>
    </li>
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
  const groups = (['reversal', 'continuation', 'indecision'] as const).map((kind) => ({
    kind,
    items: catalog.patterns.filter(
      (p) => p.kind === kind && p.name.toLowerCase().includes(filter.trim().toLowerCase()),
    ),
  }))

  const toggle = (id: string, on: boolean) => {
    const next = new Set(chosen)
    if (on) next.add(id)
    else next.delete(id)
    onChange(catalog.patterns.map((p) => p.id).filter((i) => next.has(i)))
  }

  return (
    <div className="picker">
      <div className="picker-tools">
        <input placeholder="Filter patterns…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button onClick={() => onChange(catalog.patterns.filter((p) => p.common).map((p) => p.id))}>
          Common
        </button>
        <button onClick={() => onChange([])}>Clear</button>
      </div>
      {groups.map(
        (g) =>
          g.items.length > 0 && (
            <fieldset key={g.kind}>
              <legend>{KIND_LABELS[g.kind]}</legend>
              {g.items.map((p) => (
                <label key={p.id} className="check">
                  <input type="checkbox" checked={chosen.has(p.id)} onChange={(e) => toggle(p.id, e.target.checked)} />
                  {p.name}
                  {!p.common && <span className="muted"> · rare/noisy</span>}
                </label>
              ))}
            </fieldset>
          ),
      )}
    </div>
  )
}
