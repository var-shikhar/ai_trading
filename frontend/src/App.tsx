import type { SeriesMarker, Time, UTCTimestamp } from 'lightweight-charts'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  api,
  type AuthStatus,
  type InstrumentHit,
  type PatternCatalog,
  type PatternResult,
  type StudyChartData,
  type StudyDef,
} from './api/client'
import { PriceChart, type ChartType, type ScaleMode, type StudyAction } from './chart/PriceChart'
import { useChartTheme, type ChartTheme, type ThemeMode } from './chart/theme'
import { PatternPanel, type PatternSettings } from './patterns/PatternPanel'
import { IndicatorDialog } from './studies/IndicatorDialog'
import { defaultStudies, newStudy, type StudyInstance } from './studies/model'
import { StudySettings } from './studies/StudySettings'
import { BottomBar, RANGES } from './ui/BottomBar'
import { TopBar } from './ui/TopBar'

const PAGE_BARS = 500
const MAX_BARS = 20000
const DAILY_TIMEFRAMES = new Set(['1D', '1W', '1M'])
const TF_MINUTES: Record<string, number> = { '1m': 1, '5m': 5, '15m': 15, '30m': 30, '1h': 60, '2h': 120, '4h': 240 }
const SESSION_MINUTES = 375
const DEFAULT_SYMBOL: InstrumentHit = { symbol: 'NSE:NIFTY50-INDEX', ticker: 'NIFTY50', name: 'NIFTY 50', kind: 'INDEX' }
const DEFAULT_FAVORITES = ['15m', '1h', '4h', '1D', '1W']

// Per-browser conveniences only; the app works without them.
function loadPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function usePref<T>(key: string, fallback: T | (() => T)) {
  const [value, setValue] = useState<T>(() =>
    loadPref(key, typeof fallback === 'function' ? (fallback as () => T)() : fallback),
  )
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // storage unavailable (private mode etc.)
    }
  }, [key, value])
  return [value, setValue] as const
}

/** Rough number of bars covering `days` calendar days on a timeframe. */
function barsForDays(tf: string, days: number): number {
  const tradingDays = (days * 5) / 7
  if (TF_MINUTES[tf]) return Math.ceil(tradingDays * (SESSION_MINUTES / TF_MINUTES[tf]))
  if (tf === '1W') return Math.ceil(days / 7)
  if (tf === '1M') return Math.ceil(days / 30)
  return Math.ceil(tradingDays)
}

// ?symbol=NSE:SBIN-EQ&tf=1h opens a specific chart (bookmarkable).
const urlParams = new URLSearchParams(window.location.search)

function symbolFromUrl(): InstrumentHit | null {
  const s = urlParams.get('symbol')
  if (!s) return null
  const ticker = s.split(':')[1]?.split('-')[0] ?? s
  return { symbol: s, ticker, name: '', kind: s.endsWith('-INDEX') ? 'INDEX' : 'EQ' }
}

function App() {
  const [themeMode, setThemeMode] = usePref<ThemeMode>('themeMode', 'system')
  const theme = useChartTheme(themeMode)
  const [auth, setAuth] = useState<AuthStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [symbol, setSymbol] = usePref<InstrumentHit>('symbol', () => symbolFromUrl() ?? DEFAULT_SYMBOL)
  const [tf, setTf] = usePref<string>('tf', () => urlParams.get('tf') ?? '1D')
  const [favorites, setFavorites] = usePref<string[]>('tfFavorites', DEFAULT_FAVORITES)
  const [chartType, setChartType] = usePref<ChartType>('chartType', 'candles')
  const [scaleMode, setScaleMode] = usePref<ScaleMode>('scaleMode', 'normal')
  const [showVolume, setShowVolume] = usePref<boolean>('volume', true)
  const [savedStudies, setSavedStudies] = usePref<StudyInstance[] | null>('studies', null)
  const [catalog, setCatalog] = useState<StudyDef[] | null>(null)

  const [limit, setLimit] = useState(PAGE_BARS)
  const [chart, setChart] = useState<StudyChartData | null>(null)
  const [chartKey, setChartKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const requestId = useRef(0)

  const [indicatorsOpen, setIndicatorsOpen] = useState(false)
  const [settingsUid, setSettingsUid] = useState<string | null>(null)
  const [focus, setFocus] = useState<{ time: number; seq: number } | null>(null)
  const [range, setRange] = useState<{ from: number; to: number; seq: number } | null>(null)
  const [activeRange, setActiveRange] = useState<string | null>(null)
  const [pendingRange, setPendingRange] = useState<string | null>(null)
  const [goTo, setGoTo] = useState<number | null>(null)

  const [showPatterns, setShowPatterns] = usePref<boolean>('patterns', false)
  const [patternSettings, setPatternSettings] = usePref<PatternSettings>('patternSettings', {
    preset: 'common',
    custom: [],
    inContext: true,
  })
  const [patternCatalog, setPatternCatalog] = useState<PatternCatalog | null>(null)
  const [patterns, setPatterns] = useState<PatternResult | null>(null)
  const [patternsLoading, setPatternsLoading] = useState(false)
  const [patternsError, setPatternsError] = useState<string | null>(null)
  const patternRequestId = useRef(0)

  useEffect(() => {
    Promise.all([api.authStatus(), api.studiesCatalog()])
      .then(([a, c]) => {
        setAuth(a)
        setCatalog(c)
      })
      .catch((e: Error) => setError(e.message))
  }, [])

  const catalogById = useMemo(
    () => Object.fromEntries((catalog ?? []).map((d) => [d.id, d])) as Record<string, StudyDef>,
    [catalog],
  )
  // First run starts with EMA 20/50/200 + RSI 14, like the earlier fixed setup.
  const studies = useMemo(
    () => (savedStudies ?? (catalog ? defaultStudies(catalog) : [])).filter((s) => catalogById[s.id]),
    [savedStudies, catalog, catalogById],
  )

  const authenticated = auth?.fyers.authenticated ?? false
  const isIndex = symbol.kind === 'INDEX'
  const intraday = !DAILY_TIMEFRAMES.has(tf)
  const key = `${symbol.symbol}|${tf}`

  const changeTf = (next: string, bars = PAGE_BARS) => {
    setTf(next)
    setLimit(bars)
    setActiveRange(null)
  }
  const changeSymbol = (next: InstrumentHit) => {
    setSymbol(next)
    setLimit(PAGE_BARS)
  }

  // Only inputs that change the numbers trigger a refetch (not colors/visibility).
  const studyRequest = useMemo(() => studies.map((s) => ({ uid: s.uid, id: s.id, params: s.params })), [studies])
  const requestKey = `${key}|${limit}|${JSON.stringify(studyRequest)}`

  useEffect(() => {
    if (!authenticated || !catalog) return
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
  }, [authenticated, catalog, requestKey])

  const loadMore = useCallback(() => {
    if (!loading && chart?.has_more && chartKey === key) setLimit((l) => Math.min(l + PAGE_BARS, MAX_BARS))
  }, [loading, chart, chartKey, key])

  // Bottom range bar: once the data for the range's timeframe has arrived,
  // show the requested span ending at the latest bar.
  useEffect(() => {
    if (!pendingRange || !chart || chartKey !== key || loading || !chart.candles.length) return
    const r = RANGES.find((x) => x.label === pendingRange)
    if (!r) return
    const candles = chart.candles
    const last = candles[candles.length - 1].time
    let from: number
    if (r.days === 'all') {
      from = candles[0].time
    } else if (r.days === 'ytd') {
      from = Date.UTC(new Date(last * 1000).getUTCFullYear(), 0, 1) / 1000
    } else if (TF_MINUTES[r.tf]) {
      // Intraday spans count trading sessions back from the last bar
      // (1D = the last session, 5D = the last five).
      const sessions = r.days <= 5 ? r.days : Math.round((r.days * 5) / 7)
      const days = [...new Set(candles.map((c) => Math.floor(c.time / 86400)))]
      from = days[Math.max(0, days.length - sessions)] * 86400
    } else {
      from = last - r.days * 86400
    }
    setRange((prev) => ({ from, to: last, seq: (prev?.seq ?? 0) + 1 }))
    setPendingRange(null)
  }, [pendingRange, chart, chartKey, key, loading])

  const pickRange = (label: string) => {
    const r = RANGES.find((x) => x.label === label)
    if (!r) return
    const days = r.days === 'all' ? 9000 : r.days === 'ytd' ? 366 : r.days
    const bars = Math.min(MAX_BARS, Math.max(PAGE_BARS, Math.ceil(barsForDays(r.tf, days) * 1.3)))
    changeTf(r.tf, bars)
    setActiveRange(label)
    setPendingRange(label)
  }

  // Go to date: load older history until the date is on the chart (or the
  // start of history is reached), then focus the first bar at/after it.
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
  useEffect(() => {
    if (showPatterns && !patternCatalog) api.patternCatalog().then(setPatternCatalog).catch(() => {})
  }, [showPatterns, patternCatalog])

  const patternKey = `${key}|${limit}|${JSON.stringify(patternSettings)}`
  useEffect(() => {
    if (!authenticated || !showPatterns) return
    const { preset, custom, inContext } = patternSettings
    const id = ++patternRequestId.current
    if (preset === 'custom' && custom.length === 0) {
      setPatterns({ hits: [], stats: [] })
      return
    }
    setPatternsLoading(true)
    setPatternsError(null)
    api
      .patterns(symbol.symbol, tf, limit, {
        inContext,
        ...(preset === 'custom' ? { patterns: custom } : {}),
        ...(preset === 'all' ? { allPatterns: true } : {}),
      })
      .then((r) => {
        if (id === patternRequestId.current) setPatterns(r)
      })
      .catch((e: Error) => {
        if (id === patternRequestId.current) setPatternsError(e.message)
      })
      .finally(() => {
        if (id === patternRequestId.current) setPatternsLoading(false)
      })
    // patternKey covers symbol/tf/limit/settings
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, showPatterns, patternKey])

  const markers = useMemo(
    () => (showPatterns && patterns && patternCatalog ? toMarkers(patterns, patternCatalog, theme) : []),
    [showPatterns, patterns, patternCatalog, theme],
  )

  // --- studies -------------------------------------------------------------------------
  const updateStudies = (fn: (list: StudyInstance[]) => StudyInstance[]) => setSavedStudies(fn(studies))

  const onStudyAction = (uid: string, action: StudyAction) => {
    if (action === 'toggle') updateStudies((list) => list.map((s) => (s.uid === uid ? { ...s, visible: !s.visible } : s)))
    else if (action === 'remove') updateStudies((list) => list.filter((s) => s.uid !== uid))
    else setSettingsUid(uid)
  }
  const settingsStudy = studies.find((s) => s.uid === settingsUid)

  const status = loading
    ? 'Loading…'
    : chart && chartKey === key
      ? `${chart.candles.length.toLocaleString()} bars${chart.has_more ? '' : ' · start of history'}`
      : ''

  return (
    <div className="app">
      <TopBar
        symbol={symbol}
        onSymbol={changeSymbol}
        tf={tf}
        onTf={(next) => changeTf(next)}
        favorites={favorites}
        onFavorites={setFavorites}
        chartType={chartType}
        onChartType={setChartType}
        onIndicators={() => setIndicatorsOpen(true)}
        showPatterns={showPatterns}
        onTogglePatterns={() => setShowPatterns((v) => !v)}
        patternCount={patterns ? patterns.hits.length : null}
        themeMode={themeMode}
        onThemeMode={setThemeMode}
        auth={auth}
        error={error}
      />

      <div className="workspace">
        <main className="chart-area">
          {loadError && <div className="overlay err">{loadError}</div>}
          {auth && !authenticated && <div className="overlay">Connect Fyers to load charts.</div>}
          {chart && catalog && (
            <PriceChart
              data={chart}
              datasetKey={chartKey}
              title={`${symbol.ticker} · ${tf} · ${symbol.exchange ?? symbol.symbol.split(':')[0]}`}
              intraday={intraday}
              theme={theme}
              chartType={chartType}
              scaleMode={scaleMode}
              showVolume={showVolume && !isIndex}
              studies={studies}
              catalog={catalogById}
              markers={markers}
              focus={focus}
              range={range}
              onNeedMore={loadMore}
              onStudyAction={onStudyAction}
              onHideVolume={() => setShowVolume(false)}
            />
          )}
        </main>
        {showPatterns && patternCatalog && (
          <PatternPanel
            catalog={patternCatalog}
            settings={patternSettings}
            onSettings={setPatternSettings}
            result={patterns}
            loading={patternsLoading}
            error={patternsError}
            intraday={intraday}
            onFocus={(time) => setFocus((f) => ({ time, seq: (f?.seq ?? 0) + 1 }))}
          />
        )}
      </div>

      <BottomBar
        activeRange={activeRange}
        onRange={pickRange}
        onGoTo={setGoTo}
        intraday={intraday}
        scaleMode={scaleMode}
        onScaleMode={setScaleMode}
        status={status}
      />

      {indicatorsOpen && catalog && (
        <IndicatorDialog
          catalog={catalog}
          hasVolume={!isIndex}
          volumeHidden={!showVolume && !isIndex}
          onAddVolume={() => setShowVolume(true)}
          onAdd={(def) => updateStudies((list) => [...list, newStudy(def, list)])}
          onClose={() => setIndicatorsOpen(false)}
        />
      )}
      {settingsStudy && catalogById[settingsStudy.id] && (
        <StudySettings
          def={catalogById[settingsStudy.id]}
          inst={settingsStudy}
          theme={theme}
          onSave={(inst) => updateStudies((list) => list.map((s) => (s.uid === inst.uid ? inst : s)))}
          onClose={() => setSettingsUid(null)}
        />
      )}
    </div>
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

export default App
