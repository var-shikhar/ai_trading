import { useQuery } from '@tanstack/react-query'
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
import { chartSettings, hitKey, patternMode, type PatternSettings } from '../patterns/PatternPanel'
import { defaultStudies, type StudyInstance } from '../studies/model'
import { applyTick, type LiveBar } from '../live/bars'
import { live } from '../live/liveClient'
import { RANGES } from '../ui/BottomBar'
import { Button, Skeleton } from '../ui/kit'

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

const NO_HITS: PatternResult = { hits: [], stats: [] }

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
  onCrosshairTime?: (time: number | null) => void
  syncRange: { from: number; to: number } | null
  onVisibleTimeRange?: (range: { from: number; to: number }) => void
  highlightPattern: string | null
  /** Extra markers for this chart's symbol (e.g. backtest entries/exits). */
  extraMarkers?: SeriesMarker<Time>[]
  onDrawingAlert?: (d: Drawing, symbol: InstrumentHit) => void
  onPriceAlert?: (price: number, symbol: InstrumentHit) => void
  alertLevels?: number[]
  /** Outline the chart while it's the active one (multi-chart layouts). */
  outlined?: boolean
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

  // Bars to load for this symbol/timeframe: a new key starts from the latest
  // page (or what a range button asked for). Reset during render, so the
  // first request for a new symbol already uses it.
  const [view, setView] = useState({ key, limit: PAGE_BARS })
  const [nextLimit, setNextLimit] = useState<number | null>(null)
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
  const [liveBar, setLiveBar] = useState<LiveBar | null>(null)
  const [lastTick, setLastTick] = useState({ symbol: '', at: 0 })
  const [reloadSeq, setReloadSeq] = useState(0)

  if (view.key !== key) {
    setView({ key, limit: nextLimit ?? PAGE_BARS })
    setNextLimit(null)
    // Keep the range highlight only when a range button caused this switch.
    if (!pendingRange) setActiveRange(null)
  }
  const limit = view.key === key ? view.limit : (nextLimit ?? PAGE_BARS)
  const setLimit = (f: (l: number) => number) => setView((v) => ({ ...v, limit: f(v.limit) }))

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
  const lastTickRef = useRef(0)
  const shownTickRef = useRef(0)
  useEffect(() => {
    liveRef.current = null
    lastTickRef.current = 0
    shownTickRef.current = 0
    setLiveBar(null)
    if (!authenticated) return
    return live.subscribe(symbol.symbol, (tick) => {
      const data = chartRef.current
      if (!data) return
      const now = Date.now()
      // Into state every few seconds only: it just drives the LIVE badge.
      if (now - shownTickRef.current > 5000) {
        shownTickRef.current = now
        setLastTick({ symbol: symbol.symbol, at: now })
      }
      lastTickRef.current = now
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
  // (The interval reads the last tick from a ref: a captured time goes stale.)
  const ticking = lastTick.symbol === symbol.symbol && lastTick.at > 0
  const isLive = ticking && Date.now() - lastTick.at < 15000
  useEffect(() => {
    if (!ticking) return
    const id = setInterval(() => {
      if (Date.now() - lastTickRef.current < 60000) setReloadSeq((n) => n + 1)
    }, 60000)
    return () => clearInterval(id)
  }, [ticking])

  const loadMore = useCallback(() => {
    if (!loading && chart?.has_more && chartKey === key) setLimit((l) => Math.min(l + PAGE_BARS, MAX_BARS))
  }, [loading, chart, chartKey, key])

  // --- commands from the top/bottom bars ---------------------------------------------
  // Starts at the current command: a chart shown again (layout switched back)
  // must not replay a range/go-to it already handled.
  const lastCommand = useRef(p.command?.seq ?? 0)
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
        setNextLimit(bars)
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
  const { sensitivity, showZones, hidden, hiddenZones } = chartSettings(config.patternSettings)
  const candleOn = config.showPatterns && mode === 'candles'
  const chartOn = config.showPatterns && mode === 'chart'

  // Pattern scans, cached per symbol/interval/bars/settings. While more
  // history loads, the last result for the same chart stays shown.
  const sameChart = (prev: { queryKey: readonly unknown[] } | undefined) =>
    prev?.queryKey[2] === symbol.symbol && prev?.queryKey[3] === tf
  const chartScan = useQuery({
    queryKey: ['patterns', 'chart', symbol.symbol, tf, limit, sensitivity],
    queryFn: () => api.chartPatterns(symbol.symbol, tf, limit, sensitivity),
    enabled: authenticated && chartOn,
    placeholderData: (prev, prevQuery) => (sameChart(prevQuery) ? prev : undefined),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })

  // Only what the scan uses: hiding hits or chart-pattern settings don't rescan.
  const { preset, custom, inContext } = config.patternSettings
  const noneChosen = preset === 'custom' && custom.length === 0
  const candleActive = authenticated && candleOn
  const candleScan = useQuery({
    queryKey: ['patterns', 'candles', symbol.symbol, tf, limit, preset, custom.join(','), inContext],
    queryFn: () =>
      api.patterns(symbol.symbol, tf, limit, {
        inContext,
        ...(preset === 'custom' ? { patterns: custom } : {}),
        ...(preset === 'all' ? { allPatterns: true } : {}),
      }),
    enabled: candleActive && !noneChosen,
    placeholderData: (prev, prevQuery) => (sameChart(prevQuery) ? prev : undefined),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })

  const chartActive = authenticated && chartOn
  const patterns = useMemo<PatternState>(
    () => ({
      result: !candleActive ? null : noneChosen ? NO_HITS : (candleScan.data ?? null),
      loading: candleActive && !noneChosen && candleScan.isFetching,
      error: candleActive && !noneChosen ? (candleScan.error?.message ?? null) : null,
      chart: chartScan.data ?? null,
      chartLoading: chartActive && chartScan.isFetching,
      chartError: chartActive ? (chartScan.error?.message ?? null) : null,
    }),
    [candleActive, noneChosen, candleScan.data, candleScan.isFetching, candleScan.error, chartActive, chartScan.data, chartScan.isFetching, chartScan.error],
  )

  const markers = useMemo(() => {
    const own =
      candleOn && patterns.result && p.patternCatalog
        ? toMarkers(patterns.result, p.patternCatalog, theme, config.patternSettings.hiddenHits)
        : []
    const extra = p.extraMarkers ?? []
    return extra.length ? [...own, ...extra].sort((a, b) => (a.time as number) - (b.time as number)) : own
  }, [candleOn, patterns.result, p.patternCatalog, theme, p.extraMarkers, config.patternSettings.hiddenHits])

  // Memoized: a new object every render would redraw the overlay each time.
  const visibleChart = useMemo(
    () => (chartOn ? visiblePatterns(patterns.chart, hidden, hiddenZones) : null),
    [chartOn, patterns.chart, hidden, hiddenZones],
  )

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

  const ready = !!chart && chartKey === key
  const retry = () => setReloadSeq((n) => n + 1)

  return (
    <section className="absolute inset-0" onMouseDownCapture={p.onActivate} aria-label={`${symbol.ticker} ${tf} chart`} aria-busy={loading}>
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
          onRecenter={() => {
            // A picked range (1D, 1M, ...) is shown again, ending at the latest bar.
            if (!activeRange) return false
            setPendingRange(activeRange)
            return true
          }}
          tool={p.tool}
          onToolDone={p.onToolDone}
          drawings={p.drawings}
          onDrawingsChange={onDrawingsChange}
          syncCrosshair={p.syncCrosshair}
          onCrosshairTime={p.onCrosshairTime}
          syncRange={p.syncRange}
          onVisibleTimeRange={p.onVisibleTimeRange}
          chartPatterns={visibleChart}
          showZones={showZones}
          highlightPattern={p.highlightPattern}
          liveBar={liveBar && chartKey === key ? liveBar.bar : null}
          onDrawingAlert={p.onDrawingAlert ? (d) => p.onDrawingAlert!(d, symbol) : undefined}
          onPriceAlert={p.onPriceAlert ? (price) => p.onPriceAlert!(price, symbol) : undefined}
          alertLevels={p.alertLevels}
          isLive={isLive}
          tf={tf}
          symbol={symbol.symbol}
          refreshing={loading && ready}
        />
      )}
      {/* First load, or a new symbol/interval: a placeholder instead of the old chart. */}
      {authenticated && !ready && !loadError && <ChartLoading />}
      {loadError && !ready && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface p-6">
          <div
            role="alert"
            className="flex max-w-sm flex-col items-center gap-2 rounded-2xl border border-line bg-raised px-6 py-5 text-center shadow-card"
          >
            <span className="mb-1 flex size-10 items-center justify-center rounded-full bg-down-soft text-[18px] font-bold text-down">!</span>
            <p className="text-[14px] font-semibold text-fg">Couldn&apos;t load {symbol.ticker}</p>
            <p className="text-[13px] break-words text-muted">{loadError}</p>
            <Button size="sm" variant="primary" className="mt-2" onClick={retry}>
              Retry
            </Button>
          </div>
        </div>
      )}
      {loadError && ready && (
        <div
          role="alert"
          className="absolute top-2 left-1/2 z-20 flex max-w-[90%] -translate-x-1/2 items-center gap-2 rounded-full border border-line bg-raised py-1 pr-1 pl-3 text-[12px] text-down shadow-card"
        >
          <span className="truncate">Couldn&apos;t refresh: {loadError}</span>
          <Button size="sm" variant="soft" className="h-6 rounded-full px-2.5 text-[12px]" onClick={retry}>
            Retry
          </Button>
        </div>
      )}
      {p.outlined && active && <div aria-hidden className="pointer-events-none absolute inset-0 z-30 border border-accent" />}
    </section>
  )
}

// Heights (%) of the placeholder candles: a fixed, gentle up and down.
const SKELETON_BARS = Array.from({ length: 28 }, (_, i) => 34 + Math.round(16 * Math.sin(i / 2.2) + 9 * Math.sin(i / 0.9)))

/** Shimmering placeholder of a chart: legend, candles, price and time axes. */
function ChartLoading() {
  return (
    <div className="absolute inset-0 z-10 flex flex-col gap-3 bg-surface p-3" aria-label="Loading chart">
      <div className="flex items-center gap-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-56 max-md:hidden" />
      </div>
      <div className="flex min-h-0 flex-1 gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-[3px] overflow-hidden px-2 opacity-70">
          {SKELETON_BARS.map((h, i) => (
            <div key={i} className="flex min-w-1 flex-1 justify-center" style={{ height: `${h}%` }}>
              <Skeleton className="h-full w-full rounded-sm" />
            </div>
          ))}
        </div>
        <div className="flex w-12 shrink-0 flex-col justify-between py-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-2.5 w-10" />
          ))}
        </div>
      </div>
      <div className="flex justify-between gap-2 pr-14">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-2.5 w-10" />
        ))}
      </div>
    </div>
  )
}

function toMarkers(
  result: PatternResult,
  catalog: PatternCatalog,
  theme: ChartTheme,
  hidden: string[] = [],
): SeriesMarker<Time>[] {
  const labels = Object.fromEntries(catalog.patterns.map((p) => [p.id, p.label]))
  const off = new Set(hidden)
  // One marker per bar and side; several patterns on the same bar share it.
  const byBar = new Map<string, SeriesMarker<Time>>()
  for (const h of result.hits) {
    if (off.has(hitKey(h))) continue
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
