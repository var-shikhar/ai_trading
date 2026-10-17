import type { SeriesMarker, Time, UTCTimestamp } from 'lightweight-charts'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  api,
  type InstrumentHit,
  type PatternCatalog,
  type PatternResult,
  type StudyChartData,
  type StudyDef,
} from '../api/client'
import { PriceChart, type ChartType, type ScaleMode, type StudyAction } from '../chart/PriceChart'
import type { ChartTheme } from '../chart/theme'
import type { Drawing, DrawingTool } from '../drawings/types'
import { visiblePatterns, type ChartPatternResult } from '../patterns/chartPatterns'
import { chartSettings, patternMode, type PatternSettings } from '../patterns/PatternPanel'
import { defaultStudies, type StudyInstance } from '../studies/model'
import { applyTick, type LiveBar } from '../live/bars'
import { live } from '../live/liveClient'
import { RANGES } from '../ui/BottomBar'

export const PAGE_BARS = 500
const MAX_BARS = 20000
export const DAILY_TIMEFRAMES = new Set(['1D', '1W', '1M'])
const TF_MINUTES: Record<string, number> = { '1m': 1, '5m': 5, '15m': 15, '30m': 30, '1h': 60, '2h': 120, '4h': 240 }
const SESSION_MINUTES = 375

/** Everything that defines one chart in the layout (persisted). */
export interface PanelConfig {
  symbol: InstrumentHit
  tf: string
  chartType: ChartType
  scaleMode: ScaleMode
  showVolume: boolean
  studies: StudyInstance[] | null // null = default set
  showPatterns: boolean
  patternSettings: PatternSettings
}

/** One-shot instructions from the top/bottom bars to the active chart. */
export type PanelCommand =
  | { kind: 'range'; label: string; seq: number }
  | { kind: 'goto'; epoch: number; seq: number }
  | { kind: 'focus'; time: number; seq: number }

export interface PatternState {
  result: PatternResult | null
  loading: boolean
  error: string | null
  chart: ChartPatternResult | null
  chartLoading: boolean
  chartError: string | null
}

const NO_PATTERNS: PatternState = {
  result: null,
  loading: false,
  error: null,
  chart: null,
  chartLoading: false,
  chartError: null,
}

/** Rough number of bars covering `days` calendar days on a timeframe. */
function barsForDays(tf: string, days: number): number {
  const tradingDays = (days * 5) / 7
  if (TF_MINUTES[tf]) return Math.ceil(tradingDays * (SESSION_MINUTES / TF_MINUTES[tf]))
  if (tf === '1W') return Math.ceil(days / 7)
  if (tf === '1M') return Math.ceil(days / 30)
  return Math.ceil(tradingDays)
}

interface Props {
  config: PanelConfig
  onConfig: (patch: Partial<PanelConfig>) => void
  active: boolean
  onActivate: () => void
  command: PanelCommand | null
  theme: ChartTheme
  catalog: StudyDef[]
  catalogById: Record<string, StudyDef>
  patternCatalog: PatternCatalog | null
  authenticated: boolean
  tool: DrawingTool
  onToolDone: () => void
  drawings: Drawing[]
  onDrawingsChange: (symbol: string, drawings: Drawing[]) => void
  onStudySettings: (uid: string) => void
  onStatus: (status: string, activeRange: string | null) => void
  onPatterns: (state: PatternState) => void
  syncCrosshair: number | null | undefined
  onCrosshairTime: (time: number | null) => void
  syncRange: { from: number; to: number } | null
  onVisibleTimeRange?: (range: { from: number; to: number }) => void
  highlightPattern: string | null
  /** Extra markers for this chart's symbol (e.g. backtest entries/exits). */
  extraMarkers?: SeriesMarker<Time>[]
  onDrawingAlert?: (d: Drawing, symbol: InstrumentHit) => void
}

export function ChartPanel(p: Props) {
  const { config, theme, catalog, catalogById, authenticated } = p
  const { symbol, tf } = config
  const isIndex = symbol.kind === 'INDEX'
  const intraday = !DAILY_TIMEFRAMES.has(tf)
  const key = `${symbol.symbol}|${tf}`

  const studies = useMemo(
    () => (config.studies ?? defaultStudies(catalog)).filter((s) => catalogById[s.id]),
    [config.studies, catalog, catalogById],
  )

  const [limit, setLimit] = useState(PAGE_BARS)
  const [chart, setChart] = useState<StudyChartData | null>(null)
  const [chartKey, setChartKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const requestId = useRef(0)
  const [focus, setFocus] = useState<{ time: number; seq: number } | null>(null)
  const [range, setRange] = useState<{ from: number; to: number; seq: number } | null>(null)
  const [activeRange, setActiveRange] = useState<string | null>(null)
  const [pendingRange, setPendingRange] = useState<string | null>(null)
  const [goTo, setGoTo] = useState<number | null>(null)
  const [patterns, setPatterns] = useState<PatternState>(NO_PATTERNS)
  const [liveBar, setLiveBar] = useState<LiveBar | null>(null)
  const [lastTickAt, setLastTickAt] = useState(0)
  const [reloadSeq, setReloadSeq] = useState(0)
  const patternRequestId = useRef(0)

  // A new symbol/timeframe starts from the latest page, unless a range
  // button asked for a specific amount of history.
  const nextLimit = useRef<number | null>(null)
  useEffect(() => {
    setLimit(nextLimit.current ?? PAGE_BARS)
    nextLimit.current = null
    // Keep the range highlight only when a range button caused this switch.
    if (!pendingRange) setActiveRange(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // Only inputs that change the numbers trigger a refetch (not colors/visibility).
  const studyRequest = useMemo(() => studies.map((s) => ({ uid: s.uid, id: s.id, params: s.params })), [studies])
  const requestKey = `${key}|${limit}|${JSON.stringify(studyRequest)}|${reloadSeq}`

  useEffect(() => {
    if (!authenticated) return
    const id = ++requestId.current
    setLoading(true)
    setLoadError(null)
    api
      .chartWithStudies(symbol.symbol, tf, limit, studyRequest)
      .then((data) => {
        if (id !== requestId.current) return
        setChart(data)
        setChartKey(key)
      })
      .catch((e: Error) => {
        if (id === requestId.current) setLoadError(e.message)
      })
      .finally(() => {
        if (id === requestId.current) setLoading(false)
      })
    // requestKey covers symbol/tf/limit/studies
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, requestKey])

  // --- live ticks -> forming bar -------------------------------------------------------
  const chartRef = useRef(chart)
  useEffect(() => {
    chartRef.current = chart
  })
  const sessionStart = chart?.session?.start ?? (symbol.symbol.startsWith('MCX:') ? '09:00' : '09:15')
  const liveRef = useRef<LiveBar | null>(null)
  useEffect(() => {
    liveRef.current = null
    setLiveBar(null)
    if (!authenticated) return
    return live.subscribe(symbol.symbol, (tick) => {
      const data = chartRef.current
      if (!data) return
      setLastTickAt(Date.now())
      const prev = liveRef.current
      const r = applyTick(prev, data.candles[data.candles.length - 1], tick, tf, sessionStart)
      if (!r) return
      liveRef.current = r.state
      setLiveBar(r.state)
      // A bar just closed: refresh so indicators include it.
      if (r.newBar && prev) setReloadSeq((n) => n + 1)
    })
  }, [authenticated, symbol.symbol, tf, sessionStart])

  // While ticks flow, refresh once a minute so indicators follow the live bar.
  const isLive = Date.now() - lastTickAt < 15000
  useEffect(() => {
    if (!lastTickAt) return
    const id = setInterval(() => {
      if (Date.now() - lastTickAt < 60000) setReloadSeq((n) => n + 1)
    }, 60000)
    return () => clearInterval(id)
  }, [lastTickAt > 0]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore = useCallback(() => {
    if (!loading && chart?.has_more && chartKey === key) setLimit((l) => Math.min(l + PAGE_BARS, MAX_BARS))
  }, [loading, chart, chartKey, key])

  // --- commands from the top/bottom bars ---------------------------------------------
  const lastCommand = useRef(0)
  useEffect(() => {
    const c = p.command
    if (!c || c.seq === lastCommand.current) return
    lastCommand.current = c.seq
    if (c.kind === 'focus') setFocus((f) => ({ time: c.time, seq: (f?.seq ?? 0) + 1 }))
    else if (c.kind === 'goto') setGoTo(c.epoch)
    else {
      const r = RANGES.find((x) => x.label === c.label)
      if (!r) return
      const days = r.days === 'all' ? 9000 : r.days === 'ytd' ? 366 : r.days
      const bars = Math.min(MAX_BARS, Math.max(PAGE_BARS, Math.ceil(barsForDays(r.tf, days) * 1.3)))
      setActiveRange(c.label)
      setPendingRange(c.label)
      if (r.tf === tf) setLimit((l) => Math.max(l, bars))
      else {
        nextLimit.current = bars
        p.onConfig({ tf: r.tf })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.command])

  // Range: once data for the range's timeframe arrived, show the span.
  useEffect(() => {
    if (!pendingRange || !chart || chartKey !== key || loading || !chart.candles.length) return
    const r = RANGES.find((x) => x.label === pendingRange)
    if (!r || r.tf !== tf) return
    const candles = chart.candles
    const last = candles[candles.length - 1].time
    let from: number
    if (r.days === 'all') from = candles[0].time
    else if (r.days === 'ytd') from = Date.UTC(new Date(last * 1000).getUTCFullYear(), 0, 1) / 1000
    else if (TF_MINUTES[r.tf]) {
      // Intraday spans count trading sessions back from the last bar.
      const sessions = r.days <= 5 ? r.days : Math.round((r.days * 5) / 7)
      const days = [...new Set(candles.map((c) => Math.floor(c.time / 86400)))]
      from = days[Math.max(0, days.length - sessions)] * 86400
    } else from = last - r.days * 86400
    setRange((prev) => ({ from, to: last, seq: (prev?.seq ?? 0) + 1 }))
    setPendingRange(null)
  }, [pendingRange, chart, chartKey, key, loading, tf])

  // Go to date: load older history until the date is on the chart.
  useEffect(() => {
    if (goTo === null || !chart || chartKey !== key || loading || !chart.candles.length) return
    const first = chart.candles[0].time
    if (goTo < first && chart.has_more && limit < MAX_BARS) {
      const missingDays = (first - goTo) / 86400
      setLimit((l) => Math.min(MAX_BARS, l + Math.max(PAGE_BARS, Math.ceil(barsForDays(tf, missingDays) * 1.2))))
      return
    }
    const bar = chart.candles.find((c) => c.time >= goTo) ?? chart.candles[chart.candles.length - 1]
    setFocus((f) => ({ time: bar.time, seq: (f?.seq ?? 0) + 1 }))
    setGoTo(null)
  }, [goTo, chart, chartKey, key, loading, limit, tf])

  // --- patterns --------------------------------------------------------------------
  const mode = patternMode(config.patternSettings)
  const { sensitivity, showZones, hidden } = chartSettings(config.patternSettings)
  const candleOn = config.showPatterns && mode === 'candles'
  const chartOn = config.showPatterns && mode === 'chart'

  const chartPatternKey = `${key}|${limit}|${sensitivity}`
  const chartRequestId = useRef(0)
  useEffect(() => {
    if (!authenticated || !chartOn) return
    const id = ++chartRequestId.current
    setPatterns((s) => ({ ...s, chartLoading: true, chartError: null }))
    api
      .chartPatterns(symbol.symbol, tf, limit, sensitivity)
      .then((r) => id === chartRequestId.current && setPatterns((s) => ({ ...s, chart: r, chartLoading: false })))
      .catch(
        (e: Error) =>
          id === chartRequestId.current &&
          setPatterns((s) => ({ ...s, chart: null, chartLoading: false, chartError: e.message })),
      )
    // chartPatternKey covers symbol/tf/limit/sensitivity
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, chartOn, chartPatternKey])

  const patternKey = `${key}|${limit}|${JSON.stringify(config.patternSettings)}`
  useEffect(() => {
    if (!authenticated || !candleOn) {
      setPatterns((s) => ({ ...s, result: null, loading: false, error: null }))
      return
    }
    const { preset, custom, inContext } = config.patternSettings
    const id = ++patternRequestId.current
    if (preset === 'custom' && custom.length === 0) {
      setPatterns((s) => ({ ...s, result: { hits: [], stats: [] }, loading: false, error: null }))
      return
    }
    setPatterns((s) => ({ ...s, loading: true, error: null }))
    api
      .patterns(symbol.symbol, tf, limit, {
        inContext,
        ...(preset === 'custom' ? { patterns: custom } : {}),
        ...(preset === 'all' ? { allPatterns: true } : {}),
      })
      .then((r) => id === patternRequestId.current && setPatterns((s) => ({ ...s, result: r, loading: false })))
      .catch(
        (e: Error) =>
          id === patternRequestId.current && setPatterns((s) => ({ ...s, result: null, loading: false, error: e.message })),
      )
    // patternKey covers symbol/tf/limit/settings
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, candleOn, patternKey])

  const markers = useMemo(() => {
    const own = candleOn && patterns.result && p.patternCatalog ? toMarkers(patterns.result, p.patternCatalog, theme) : []
    const extra = p.extraMarkers ?? []
    return extra.length ? [...own, ...extra].sort((a, b) => (a.time as number) - (b.time as number)) : own
  }, [candleOn, patterns.result, p.patternCatalog, theme, p.extraMarkers])

  // --- report up to the app (only the active chart drives the bars) ---------------
  const status = loading
    ? 'Loading…'
    : chart && chartKey === key
      ? `${chart.candles.length.toLocaleString()} bars${chart.has_more ? '' : ' · start of history'}`
      : ''
  const { onStatus, onPatterns, active } = p
  useEffect(() => {
    if (active) onStatus(status, activeRange)
  }, [active, status, activeRange, onStatus])
  useEffect(() => {
    if (active) onPatterns(patterns)
  }, [active, patterns, onPatterns])

  const onStudyAction = (uid: string, action: StudyAction) => {
    if (action === 'settings') return p.onStudySettings(uid)
    const next =
      action === 'toggle'
        ? studies.map((s) => (s.uid === uid ? { ...s, visible: !s.visible } : s))
        : studies.filter((s) => s.uid !== uid)
    p.onConfig({ studies: next })
  }

  const onDrawingsChange = useCallback(
    (items: Drawing[]) => p.onDrawingsChange(symbol.symbol, items),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [symbol.symbol, p.onDrawingsChange],
  )

  return (
    <section
      className={`chart-panel ${active ? 'active' : ''}`}
      onMouseDownCapture={p.onActivate}
      aria-label={`${symbol.ticker} ${tf} chart`}
    >
      {loadError && <div className="overlay err">{loadError}</div>}
      {!authenticated && <div className="overlay">Connect Fyers to load charts.</div>}
      {chart && (
        <PriceChart
          data={chart}
          datasetKey={chartKey}
          title={`${symbol.ticker} · ${tf} · ${symbol.exchange ?? symbol.symbol.split(':')[0]}`}
          intraday={intraday}
          theme={theme}
          chartType={config.chartType}
          scaleMode={config.scaleMode}
          showVolume={config.showVolume && !isIndex}
          studies={studies}
          catalog={catalogById}
          markers={markers}
          focus={focus}
          range={range}
          onNeedMore={loadMore}
          onStudyAction={onStudyAction}
          onHideVolume={() => p.onConfig({ showVolume: false })}
          tool={p.tool}
          onToolDone={p.onToolDone}
          drawings={p.drawings}
          onDrawingsChange={onDrawingsChange}
          syncCrosshair={p.syncCrosshair}
          onCrosshairTime={p.onCrosshairTime}
          syncRange={p.syncRange}
          onVisibleTimeRange={p.onVisibleTimeRange}
          chartPatterns={chartOn ? visiblePatterns(patterns.chart, hidden) : null}
          showZones={showZones}
          highlightPattern={p.highlightPattern}
          liveBar={liveBar && chartKey === key ? liveBar.bar : null}
          onDrawingAlert={p.onDrawingAlert ? (d) => p.onDrawingAlert!(d, symbol) : undefined}
          isLive={isLive}
        />
      )}
    </section>
  )
}

function toMarkers(result: PatternResult, catalog: PatternCatalog, theme: ChartTheme): SeriesMarker<Time>[] {
  const labels = Object.fromEntries(catalog.patterns.map((p) => [p.id, p.label]))
  // One marker per bar and side; several patterns on the same bar share it.
  const byBar = new Map<string, SeriesMarker<Time>>()
  for (const h of result.hits) {
    const above = h.direction !== 'bullish'
    const id = `${h.time}|${above}`
    const label = labels[h.pattern] ?? h.pattern
    const existing = byBar.get(id)
    if (existing) {
      existing.text = `${existing.text}, ${label}`
      continue
    }
    byBar.set(id, {
      time: h.time as UTCTimestamp,
      position: above ? 'aboveBar' : 'belowBar',
      shape: h.direction === 'bullish' ? 'arrowUp' : h.direction === 'bearish' ? 'arrowDown' : 'circle',
      color: h.direction === 'bullish' ? theme.up : h.direction === 'bearish' ? theme.down : theme.muted,
      text: label,
      size: 1,
    })
  }
  return [...byBar.values()].sort((a, b) => (a.time as number) - (b.time as number))
}
