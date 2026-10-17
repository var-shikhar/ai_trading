import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  api,
  onFyersAuthLost,
  type AuthStatus,
  type InstrumentHit,
  type PatternCatalog,
  type StudyDef,
  type UserInfo,
} from './api/client'
import type { ChartType, ScaleMode } from './chart/PriceChart'
import { useChartTheme, type ThemeMode } from './chart/theme'
import { DrawingToolbar } from './drawings/DrawingToolbar'
import type { Drawing, DrawingTool } from './drawings/types'
import {
  ChartPanel,
  DAILY_TIMEFRAMES,
  type PanelCommand,
  type PanelConfig,
  type PatternState,
} from './layout/ChartPanel'
import { LAYOUTS, LayoutMenu, MAX_PANELS, type SyncSettings } from './layout/layouts'
import { patternKey } from './patterns/chartPatterns'
import { PatternPanel, type PatternSettings } from './patterns/PatternPanel'
import { loadPref, usePref } from './prefs'
import { MOBILE_QUERY, useMediaQuery } from './pwa'
import { ScannerPanel } from './scanner/ScannerPanel'
import { WatchlistPanel } from './watchlist/WatchlistPanel'
import { MobileHome } from './watchlist/MobileHome'
import { MobileSearchBar } from './ui/MobileSearchBar'
import { StrategyTester } from './backtest/StrategyTester'
import {
  ChartStrategyPanel,
  ChartStrategyReport,
  defaultChartStrategy,
  tradeMarkers,
  useChartStrategy,
} from './backtest/ChartStrategy'
import type { ChartStrategy } from './backtest/types'
import { AlertsPanel } from './alerts/AlertsPanel'
import { alertLevels, useAlerts } from './alerts/queries'
import { AlertToasts } from './alerts/AlertToasts'
import { SignalsPage } from './alerts/SignalsPage'
import type { AlertIn } from './alerts/types'
import type { SeriesMarker, Time } from 'lightweight-charts'
import { IndicatorDialog } from './studies/IndicatorDialog'
import { defaultStudies, newStudy } from './studies/model'
import { StudySettings } from './studies/StudySettings'
import { BottomBar } from './ui/BottomBar'
import { InstallPrompt } from './ui/InstallPrompt'
import { HIDDEN_PAGES, NavRail, type Page } from './ui/NavRail'
import { MobileChartTabs, RightRail, type Dock } from './ui/RightRail'
import { AccountPage } from './ui/AccountPage'
import { TopBar } from './ui/TopBar'

const DEFAULT_FAVORITES = ['15m', '1h', '4h', '1D', '1W']
const EMPTY_DRAWINGS: Drawing[] = []
const DEFAULT_PATTERN_SETTINGS: PatternSettings = { preset: 'common', custom: [], inContext: true }
const sym = (symbol: string, ticker: string, name: string, kind: InstrumentHit['kind']): InstrumentHit => ({
  symbol,
  ticker,
  name,
  kind,
})
// Charts 2-4 start on other common symbols the first time a layout is used.
const STARTER_SYMBOLS = [
  sym('NSE:NIFTY50-INDEX', 'NIFTY50', 'NIFTY 50', 'INDEX'),
  sym('NSE:NIFTYBANK-INDEX', 'NIFTYBANK', 'NIFTY BANK', 'INDEX'),
  sym('NSE:RELIANCE-EQ', 'RELIANCE', 'RELIANCE INDUSTRIES LTD', 'EQ'),
  sym('NSE:HDFCBANK-EQ', 'HDFCBANK', 'HDFC BANK LTD', 'EQ'),
]
const LETTERS = 'abcd'
const DOCK_TITLES: Record<Dock, string> = {
  watchlist: 'Watchlist',
  alerts: 'Alerts',
  patterns: 'Patterns',
  strategy: 'Strategy',
}
// Omit applied to each member of the union separately.
type CommandInput = PanelCommand extends infer C ? (C extends unknown ? Omit<C, 'seq'> : never) : never

// ?symbol=NSE:SBIN-EQ&tf=1h opens a specific chart (bookmarkable).
const urlParams = new URLSearchParams(window.location.search)

function initialPanels(): PanelConfig[] {
  const s = urlParams.get('symbol')
  const fromUrl = s
    ? sym(s, s.split(':')[1]?.replace(/-[A-Z]+$/, '') ?? s, '', s.endsWith('-INDEX') ? 'INDEX' : 'EQ')
    : null
  // The first chart picks up settings saved before multi-chart layouts existed.
  const first: PanelConfig = {
    symbol: fromUrl ?? loadPref('symbol', STARTER_SYMBOLS[0]),
    tf: urlParams.get('tf') ?? loadPref('tf', '1D'),
    chartType: loadPref<ChartType>('chartType', 'candles'),
    scaleMode: loadPref<ScaleMode>('scaleMode', 'normal'),
    showVolume: loadPref('volume', true),
    studies: loadPref('studies', null),
    showPatterns: loadPref('patterns', false),
    patternSettings: loadPref('patternSettings', DEFAULT_PATTERN_SETTINGS),
  }
  return [
    first,
    ...STARTER_SYMBOLS.slice(1).map((symbol) => ({
      ...first,
      symbol,
      studies: null,
      showPatterns: false,
    })),
  ].slice(0, MAX_PANELS)
}

function App({ user, onSignOut }: { user: UserInfo; onSignOut: () => void }) {
  const [themeMode, setThemeMode] = usePref<ThemeMode>('themeMode', 'system')
  const theme = useChartTheme(themeMode)
  const [auth, setAuth] = useState<AuthStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [catalog, setCatalog] = useState<StudyDef[] | null>(null)
  const [patternCatalog, setPatternCatalog] = useState<PatternCatalog | null>(null)

  const [favorites, setFavorites] = usePref<string[]>('tfFavorites', DEFAULT_FAVORITES)
  const [layoutId, setLayoutId] = usePref<string>('layout', '1')
  const [sync, setSync] = usePref<SyncSettings>('layoutSync', {
    symbol: false,
    interval: false,
    crosshair: true,
    time: false,
  })
  const [panels, setPanels] = usePref<PanelConfig[]>('panels', initialPanels)
  const [activeIndex, setActiveIndex] = useState(0)
  const mobile = useMediaQuery(MOBILE_QUERY)
  const layout = (!mobile && LAYOUTS.find((l) => l.id === layoutId)) || LAYOUTS[0]
  const active = Math.min(activeIndex, layout.count - 1)
  const activeConfig = panels[active]

  const [tool, setTool] = useState<DrawingTool>('cursor')
  // Phones: drawing tools are hidden until the pencil in the top bar is on.
  const [drawOpen, setDrawOpen] = useState(false)
  // Chart only: every bar and panel hidden; also the browser's own full
  // screen where it exists (Android, desktop; not iPhone Safari).
  const [fullscreen, setFullscreen] = useState(false)
  const toggleFullscreen = useCallback((on: boolean) => {
    setFullscreen(on)
    const doc = document as Document & { fullscreenElement: Element | null }
    if (on && !doc.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {})
    if (!on && doc.fullscreenElement) document.exitFullscreen?.().catch(() => {})
  }, [])
  useEffect(() => {
    // Leaving the browser's full screen (Back, Esc) leaves ours too.
    const onChange = () => !document.fullscreenElement && setFullscreen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFullscreen(false)
    document.addEventListener('fullscreenchange', onChange)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      window.removeEventListener('keydown', onKey)
    }
  }, [])
  const [commands, setCommands] = useState<Record<number, PanelCommand>>({})
  const commandSeq = useRef(0)
  const [status, setStatus] = useState({ text: '', activeRange: null as string | null })
  const [patterns, setPatterns] = useState<PatternState>({
    result: null,
    loading: false,
    error: null,
    chart: null,
    chartLoading: false,
    chartError: null,
  })
  const [highlight, setHighlight] = useState<string | null>(null)
  // Desktop opens on the chart; a phone opens on the watchlist (as broker
  // apps do) and a stock's chart is a screen with a back arrow.
  const [desktopPage, setDesktopPage] = usePref<Page>('page', 'chart')
  const [mobilePage, setMobilePage] = usePref<Page>('pageMobile', 'watchlist')
  const phoneOnly = (p: Page) => p === 'watchlist' || p === 'account'
  const rawPage: Page = mobile ? mobilePage : phoneOnly(desktopPage) ? 'chart' : desktopPage
  // A hidden section saved as the last page opens home instead.
  const page: Page = HIDDEN_PAGES.includes(rawPage) ? (mobile ? 'watchlist' : 'chart') : rawPage
  // The tab a stock's chart was opened from (where "back" returns).
  const [chartFrom, setChartFrom] = usePref<Page>('chartFrom', 'watchlist')
  // Pages stay mounted once opened, so a scan or a backtest survives a trip to the chart.
  const [visited, setVisited] = useState<Set<Page>>(() => new Set([page]))
  const goTo = useCallback(
    (p: Page) => {
      if (mobile) {
        if (p === 'chart' && mobilePage !== 'chart') setChartFrom(mobilePage)
        setMobilePage(p)
      } else setDesktopPage(phoneOnly(p) ? 'chart' : p)
      setVisited((v) => (v.has(p) ? v : new Set(v).add(p)))
    },
    [mobile, mobilePage, setMobilePage, setDesktopPage, setChartFrom],
  )
  useEffect(() => {
    // Turning a desktop window narrow (or the reverse) lands on a page that exists there.
    setVisited((v) => (v.has(page) ? v : new Set(v).add(page)))
  }, [page])
  const [desktopDock, setDesktopDock] = usePref<Dock | null>('dock', 'watchlist')
  const [mobileDock, setMobileDock] = useState<Dock | null>(null)
  const dock = mobile ? mobileDock : desktopDock
  const setDock = mobile ? setMobileDock : setDesktopDock
  // Touch screens (phones in any orientation, tablets): a tap outside an open
  // panel closes it, like a bottom sheet. Desktop keeps it docked.
  const touch = useMediaQuery('(pointer: coarse)')
  useEffect(() => {
    if (!dock || !(mobile || touch)) return
    const onDown = (e: PointerEvent) => {
      const el = e.target as HTMLElement
      // Only taps on the chart and its bars; not the panel itself, its
      // toggles (which toggle on their own), dialogs or menus.
      if (el.closest('.chart-grid, .topbar, .bottombar') && !el.closest('.dock, .menu, .modal-backdrop')) setDock(null)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [dock, mobile, touch, setDock])
  const [alertRequest, setAlertRequest] = useState<Partial<AlertIn> | null>(null)
  const alertsQuery = useAlerts()
  const clearAlertRequest = useCallback(() => setAlertRequest(null), [])
  // Lab backtest trades shown on the chart for the symbol last opened from its results.
  const [tradeMarks, setTradeMarks] = useState<{ symbol: string; markers: SeriesMarker<Time>[] } | null>(null)
  const [chartStrategy, setChartStrategy] = usePref<ChartStrategy>('chartStrategy', defaultChartStrategy)
  const patchStrategy = useCallback(
    (patch: Partial<ChartStrategy>) => setChartStrategy((s) => ({ ...s, ...patch })),
    [setChartStrategy],
  )
  const [indicatorsOpen, setIndicatorsOpen] = useState(false)
  const [settingsUid, setSettingsUid] = useState<string | null>(null)
  const [crosshair, setCrosshair] = useState<{ time: number | null; source: number } | null>(null)
  const [timeRange, setTimeRange] = useState<{ from: number; to: number } | null>(null)

  useEffect(() => {
    Promise.all([api.authStatus(), api.studiesCatalog()])
      .then(([a, c]) => {
        setAuth(a)
        setCatalog(c)
      })
      .catch((e: Error) => setError(e.message))
  }, [])
  const authenticated = auth?.fyers.authenticated ?? false
  const refreshAuth = useCallback(() => {
    api.authStatus().then(setAuth, () => {})
  }, [])
  useEffect(() => onFyersAuthLost(refreshAuth), [refreshAuth])

  // Result of the Fyers login (the backend returns here with ?fyers=...).
  // Read once, then remove it from the address bar so a reload doesn't repeat it.
  const [fyersNotice, setFyersNotice] = useState<{ ok: boolean; reason: string } | null>(() => {
    const params = new URLSearchParams(window.location.search)
    const result = params.get('fyers')
    return result ? { ok: result === 'ok', reason: params.get('reason') ?? '' } : null
  })
  useEffect(() => {
    const url = new URL(window.location.href)
    if (url.searchParams.has('fyers') || url.searchParams.has('login')) {
      for (const k of ['fyers', 'reason', 'login']) url.searchParams.delete(k)
      window.history.replaceState(null, '', url.pathname + url.search + url.hash)
    }
  }, [])
  useEffect(() => {
    if (!fyersNotice?.ok) return
    const id = setTimeout(() => setFyersNotice(null), 6000)
    return () => clearTimeout(id)
  }, [fyersNotice])

  // Give every chart concrete indicator instances (with stable ids) once the
  // catalog is known, so settings/remove always find the instance clicked.
  useEffect(() => {
    if (!catalog) return
    setPanels((list) =>
      list.some((p) => p.studies === null)
        ? list.map((p) => (p.studies === null ? { ...p, studies: defaultStudies(catalog) } : p))
        : list,
    )
  }, [catalog, setPanels])

  const anyPatterns = panels.slice(0, layout.count).some((p) => p.showPatterns)
  useEffect(() => {
    if ((anyPatterns || dock === 'patterns') && !patternCatalog) api.patternCatalog().then(setPatternCatalog).catch(() => {})
  }, [anyPatterns, dock, patternCatalog])

  const catalogById = useMemo(
    () => Object.fromEntries((catalog ?? []).map((d) => [d.id, d])) as Record<string, StudyDef>,
    [catalog],
  )

  /** Update one chart; symbol/interval changes spread to all charts when synced. */
  const updatePanel = useCallback(
    (index: number, patch: Partial<PanelConfig>) =>
      setPanels((list) =>
        list.map((p, i) => {
          if (i === index) return { ...p, ...patch }
          const shared: Partial<PanelConfig> = {}
          if (sync.symbol && patch.symbol) shared.symbol = patch.symbol
          if (sync.interval && patch.tf) shared.tf = patch.tf
          return { ...p, ...shared }
        }),
      ),
    [setPanels, sync.symbol, sync.interval],
  )
  const updateActive = (patch: Partial<PanelConfig>) => updatePanel(active, patch)

  const sendCommand = (command: CommandInput) => {
    commandSeq.current += 1
    setCommands((c) => ({ ...c, [active]: { ...command, seq: commandSeq.current } as PanelCommand }))
  }

  // --- drawings: shared per symbol across charts, saved shortly after edits -------
  const [drawings, setDrawings] = useState<Record<string, Drawing[]>>({})
  const requested = useRef(new Set<string>())
  const visibleSymbols = panels.slice(0, layout.count).map((p) => p.symbol.symbol)
  useEffect(() => {
    if (!authenticated) return
    for (const s of visibleSymbols) {
      if (requested.current.has(s)) continue
      requested.current.add(s)
      api
        .drawings(s)
        .then((items) => setDrawings((d) => ({ ...d, [s]: items })))
        .catch(() => requested.current.delete(s))
    }
  }, [authenticated, visibleSymbols.join('|')]) // eslint-disable-line react-hooks/exhaustive-deps

  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const onDrawingsChange = useCallback((symbol: string, items: Drawing[]) => {
    setDrawings((d) => ({ ...d, [symbol]: items }))
    clearTimeout(saveTimers.current[symbol])
    saveTimers.current[symbol] = setTimeout(() => api.saveDrawings(symbol, items).catch(() => {}), 400)
  }, [])
  const onToolDone = useCallback(() => setTool('cursor'), [])

  // Alt+T trend, Alt+H horizontal, Alt+V vertical, Alt+R rectangle (as TradingView).
  useEffect(() => {
    const keys: Record<string, DrawingTool> = { t: 'trend', h: 'hline', v: 'vline', r: 'rect' }
    if (page !== 'chart') return
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || (e.target as HTMLElement).closest('input, textarea, select')) return
      const t = keys[e.key.toLowerCase()]
      if (t) {
        e.preventDefault()
        setTool(t)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [page])

  const onStatus = useCallback((text: string, activeRange: string | null) => setStatus({ text, activeRange }), [])
  const onPatterns = useCallback((s: PatternState) => setPatterns(s), [])

  // Date-range sync: the active chart leads; updates batched per frame.
  const rangeFrame = useRef(0)
  const onVisibleTimeRange = useCallback((r: { from: number; to: number }) => {
    cancelAnimationFrame(rangeFrame.current)
    rangeFrame.current = requestAnimationFrame(() => setTimeRange(r))
  }, [])

  const activeStudies = activeConfig.studies ?? []
  const settingsStudy = activeStudies.find((s) => s.uid === settingsUid)
  const isIndex = activeConfig.symbol.kind === 'INDEX'
  const fyersReady = authenticated && catalog
  const strategyState = useChartStrategy(chartStrategy, activeConfig.symbol.symbol, activeConfig.tf, !!fyersReady)
  // The strategy's trades, on the chart(s) showing the symbol and interval it ran on.
  const strategyMarks = useMemo(() => {
    const r = strategyState.result
    if (!chartStrategy.enabled || !r) return null
    return { symbol: r.request.symbol, tf: r.request.tf, markers: tradeMarkers(r.trades, theme) }
  }, [chartStrategy.enabled, strategyState.result, theme])

  // Opening the patterns panel turns patterns on for the active chart. Closing
  // the panel leaves them drawn; its "Show on chart" switch removes them.
  const onDock = (d: Dock | null) => {
    if (d === 'patterns' && dock !== 'patterns' && !activeConfig.showPatterns) updateActive({ showPatterns: true })
    setDock(d)
  }
  // Picking a symbol in a panel: on a phone, close the panel to show the chart.
  const openFromDock = (symbol: InstrumentHit) => {
    updateActive({ symbol })
    if (mobile) setMobileDock(null)
  }
  const dockBadges = {
    patterns: activeConfig.showPatterns && patterns.result ? patterns.result.hits.length : null,
    strategy: chartStrategy.enabled ? 'on' : null,
  }
  const openOnChart = (symbol: InstrumentHit) => {
    updateActive({ symbol })
    goTo('chart')
  }

  return (
    <div
      className={`app ${mobile && page === 'chart' ? 'stock-screen' : ''} ${fullscreen && page === 'chart' ? 'chart-fullscreen' : ''}`}
    >
      <NavRail
        mobile={mobile}
        // On a phone, a stock's chart belongs to the tab it was opened from.
        page={mobile && page === 'chart' ? chartFrom : page}
        onPage={goTo}
        user={user}
        onSignOut={onSignOut}
        auth={auth}
        error={error}
        onFyersChanged={refreshAuth}
        themeMode={themeMode}
        onThemeMode={setThemeMode}
        dark={theme.dark}
      />
      <div className="app-main">
        {fyersNotice && (
          <div className={`fyers-notice ${fyersNotice.ok ? 'ok' : 'err'}`} role={fyersNotice.ok ? 'status' : 'alert'}>
            <span>
              {fyersNotice.ok ? '✓ Fyers connected.' : `Fyers login didn't work: ${fyersNotice.reason || 'unknown error'}`}
            </span>
            {!fyersNotice.ok && auth?.fyers.login_url && (
              <a className="primary-button small" href={auth.fyers.login_url}>
                Try again
              </a>
            )}
            <button className="icon-button" aria-label="Dismiss" onClick={() => setFyersNotice(null)}>
              ×
            </button>
          </div>
        )}

        <div className="page chart-page" hidden={page !== 'chart'}>
          <TopBar
            symbol={activeConfig.symbol}
            onSymbol={(symbol) => updateActive({ symbol })}
            tf={activeConfig.tf}
            onTf={(tf) => updateActive({ tf })}
            favorites={favorites}
            onFavorites={setFavorites}
            chartType={activeConfig.chartType}
            onChartType={(chartType) => updateActive({ chartType })}
            onIndicators={() => setIndicatorsOpen(true)}
            layoutMenu={mobile ? undefined : <LayoutMenu layout={layout} onLayout={setLayoutId} sync={sync} onSync={setSync} />}
            hotkeys={page === 'chart'}
            onBack={mobile ? () => goTo(chartFrom === 'chart' ? 'watchlist' : chartFrom) : undefined}
            extra={
              <>
                <button className="tool-button" title="Full screen chart" aria-label="Full screen chart" onClick={() => toggleFullscreen(true)}>
                  <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                    <path d="M2.5 6.5v-4h4M11.5 2.5h4v4M15.5 11.5v4h-4M6.5 15.5h-4v-4" />
                  </svg>
                </button>
                {mobile && (
                  <button
                    className={`tool-button ${drawOpen ? 'selected' : ''}`}
                    title="Drawing tools"
                    aria-pressed={drawOpen}
                    onClick={() => {
                      if (drawOpen) setTool('cursor')
                      setDrawOpen(!drawOpen)
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
                      <path d="M3 15l1-4 8.5-8.5 3 3L7 14z M11 4l3 3" />
                    </svg>
                  </button>
                )}
              </>
            }
          />

          <div className="workspace">
            <DrawingToolbar
              tool={tool}
              onTool={setTool}
              hasDrawings={(drawings[activeConfig.symbol.symbol] ?? []).length > 0}
              onClearAll={() => onDrawingsChange(activeConfig.symbol.symbol, [])}
              open={!mobile || drawOpen}
            />
            <main
              className={`chart-grid ${layout.count > 1 ? 'multi' : ''}`}
              style={{
                gridTemplateAreas: layout.areas,
                gridTemplateColumns: layout.columns,
                gridTemplateRows: layout.rows,
              }}
            >
              {!fyersReady && auth && !authenticated && (
                <div className="overlay">
                  {user.role === 'admin'
                    ? 'Connect Fyers (bottom left) to load charts.'
                    : 'Market data is paused until an admin connects Fyers.'}
                </div>
              )}
              {catalog &&
                panels.slice(0, layout.count).map((config, i) => {
                  const marks =
                    strategyMarks && strategyMarks.symbol === config.symbol.symbol && strategyMarks.tf === config.tf
                      ? strategyMarks.markers
                      : !chartStrategy.enabled && tradeMarks && tradeMarks.symbol === config.symbol.symbol
                        ? tradeMarks.markers
                        : undefined
                  return (
                    <div key={i} className="chart-cell" style={{ gridArea: LETTERS[i] }}>
                      <ChartPanel
                        config={config}
                        onConfig={(patch) => updatePanel(i, patch)}
                        active={i === active}
                        onActivate={() => setActiveIndex(i)}
                        command={commands[i] ?? null}
                        theme={theme}
                        catalog={catalog}
                        catalogById={catalogById}
                        patternCatalog={patternCatalog}
                        authenticated={authenticated}
                        tool={tool}
                        onToolDone={onToolDone}
                        drawings={drawings[config.symbol.symbol] ?? EMPTY_DRAWINGS}
                        onDrawingsChange={onDrawingsChange}
                        onStudySettings={(uid) => {
                          setActiveIndex(i)
                          setSettingsUid(uid)
                        }}
                        onStatus={onStatus}
                        onPatterns={onPatterns}
                        // undefined = this chart isn't following another chart's crosshair
                        syncCrosshair={
                          sync.crosshair && layout.count > 1 && crosshair && crosshair.source !== i
                            ? crosshair.time
                            : undefined
                        }
                        onCrosshairTime={(time) => setCrosshair({ time, source: i })}
                        syncRange={sync.time && layout.count > 1 && i !== active ? timeRange : null}
                        onVisibleTimeRange={sync.time && i === active ? onVisibleTimeRange : undefined}
                        highlightPattern={i === active ? highlight : null}
                        extraMarkers={marks}
                        alertLevels={alertLevels(alertsQuery.data, config.symbol.symbol)}
                        onPriceAlert={(price, sym) => {
                          setAlertRequest({
                            kind: 'price',
                            symbol: sym.symbol,
                            ticker: sym.ticker,
                            config: { op: 'crosses', value: price },
                            frequency: 'once',
                          })
                          setDock('alerts')
                        }}
                        onDrawingAlert={(d, sym) => {
                          const points =
                            d.type === 'hline' ? [{ time: 0, price: d.price }] : d.type === 'trend' ? [d.a, d.b] : null
                          if (!points) return
                          setAlertRequest({
                            kind: 'drawing',
                            symbol: sym.symbol,
                            ticker: sym.ticker,
                            config: { op: 'crosses', points },
                            frequency: 'once',
                          })
                          setDock('alerts')
                        }}
                      />
                    </div>
                  )
                })}
            </main>
            {fullscreen && (
              <button className="exit-fullscreen" title="Exit full screen" onClick={() => toggleFullscreen(false)}>
                <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
                  <path d="M6.5 2.5v4h-4M15.5 6.5h-4v-4M11.5 15.5v-4h4M2.5 11.5h4v4" />
                </svg>
                Exit full screen
              </button>
            )}
            {dock && (
              <div className="dock" key={dock}>
                <div className="dock-head">
                  <b>{DOCK_TITLES[dock]}</b>
                  <button className="icon-button" aria-label={`Close ${DOCK_TITLES[dock]}`} title="Close" onClick={() => setDock(null)}>
                    <svg width="16" height="16" viewBox="0 0 18 18" stroke="currentColor" strokeWidth="1.6" aria-hidden>
                      <path d="M4.5 4.5l9 9M13.5 4.5l-9 9" />
                    </svg>
                  </button>
                </div>
                {dock === 'patterns' && patternCatalog && (
                  <PatternPanel
                    catalog={patternCatalog}
                    settings={activeConfig.patternSettings}
                    onSettings={(patternSettings) => updateActive({ patternSettings })}
                    result={patterns.result}
                    loading={patterns.loading}
                    error={patterns.error}
                    intraday={!DAILY_TIMEFRAMES.has(activeConfig.tf)}
                    onFocus={(time) => sendCommand({ kind: 'focus', time })}
                    chartResult={patterns.chart}
                    chartLoading={patterns.chartLoading}
                    chartError={patterns.chartError}
                    highlight={highlight}
                    shown={activeConfig.showPatterns}
                    onShown={(showPatterns) => updateActive({ showPatterns })}
                    onPickPattern={(pat) => {
                      const k = patternKey(pat)
                      setHighlight((h) => (h === k ? null : k))
                      sendCommand({ kind: 'focus', time: pat.points[Math.floor(pat.points.length / 2)].time })
                    }}
                  />
                )}
                {dock === 'alerts' && (
                  <AlertsPanel
                    symbol={activeConfig.symbol}
                    createRequest={alertRequest}
                    onCreateHandled={clearAlertRequest}
                    onOpen={openFromDock}
                  />
                )}
                {dock === 'watchlist' && (
                  <WatchlistPanel
                    current={activeConfig.symbol}
                    activeSymbol={activeConfig.symbol.symbol}
                    onOpen={openFromDock}
                  />
                )}
                {dock === 'strategy' && (
                  <ChartStrategyPanel
                    strategy={chartStrategy}
                    onChange={patchStrategy}
                    state={strategyState}
                    ticker={activeConfig.symbol.ticker}
                    tf={activeConfig.tf}
                  />
                )}
              </div>
            )}
            {!mobile && <RightRail dock={dock} onDock={onDock} badges={dockBadges} />}
          </div>
          {mobile && <MobileChartTabs dock={dock} onDock={onDock} badges={dockBadges} />}

          {chartStrategy.enabled && (
            <ChartStrategyReport
              strategy={chartStrategy}
              state={strategyState}
              theme={theme}
              onSettings={() => setDock('strategy')}
              onRemove={() => patchStrategy({ enabled: false })}
              onOpenTrade={(trade) => sendCommand({ kind: 'goto', epoch: trade.entry_time })}
            />
          )}

          <BottomBar
            activeRange={status.activeRange}
            onRange={(label) => sendCommand({ kind: 'range', label })}
            onGoTo={(epoch) => sendCommand({ kind: 'goto', epoch })}
            intraday={!DAILY_TIMEFRAMES.has(activeConfig.tf)}
            scaleMode={activeConfig.scaleMode}
            onScaleMode={(scaleMode) => updateActive({ scaleMode })}
            status={layout.count > 1 ? `Chart ${active + 1} · ${status.text}` : status.text}
          />
        </div>

        {visited.has('screener') && (
          <div className="page" hidden={page !== 'screener'}>
            <ScannerPanel onOpen={openOnChart} />
          </div>
        )}
        {visited.has('lab') && (
          <div className="page" hidden={page !== 'lab'}>
            <StrategyTester
              chartSymbol={activeConfig.symbol}
              theme={theme}
              onOpenTrade={(trade, all) => {
                const symbol = trade.symbol
                const kind = symbol.startsWith('MCX:') ? 'COM' : symbol.endsWith('-INDEX') ? 'INDEX' : 'EQ'
                if (symbol !== activeConfig.symbol.symbol)
                  updateActive({ symbol: { symbol, ticker: trade.ticker, name: trade.ticker, kind } })
                setTradeMarks({ symbol, markers: tradeMarkers(all.filter((t) => t.symbol === symbol), theme) })
                goTo('chart')
                // goto waits for the symbol's data (and loads older history if needed).
                sendCommand({ kind: 'goto', epoch: trade.entry_time })
              }}
            />
          </div>
        )}
        {visited.has('signals') && (
          <div className="page" hidden={page !== 'signals'}>
            <SignalsPage onOpen={openOnChart} />
          </div>
        )}
        {mobile && visited.has('watchlist') && (
          <div className="page" hidden={page !== 'watchlist'}>
            <MobileHome current={activeConfig.symbol} onOpen={openOnChart} />
          </div>
        )}
        {mobile && visited.has('account') && (
          <div className="page" hidden={page !== 'account'}>
            <AccountPage
              user={user}
              onSignOut={onSignOut}
              auth={auth}
              onFyersChanged={refreshAuth}
              themeMode={themeMode}
              onThemeMode={setThemeMode}
            />
          </div>
        )}
        {mobile && page !== 'chart' && <MobileSearchBar current={activeConfig.symbol} onOpen={openOnChart} />}
      </div>

      <AlertToasts />
      <InstallPrompt />

      {indicatorsOpen && catalog && (
        <IndicatorDialog
          catalog={catalog}
          hasVolume={!isIndex}
          volumeHidden={!activeConfig.showVolume && !isIndex}
          onAddVolume={() => updateActive({ showVolume: true })}
          onAdd={(def) => updateActive({ studies: [...activeStudies, newStudy(def, activeStudies)] })}
          onClose={() => setIndicatorsOpen(false)}
        />
      )}
      {settingsStudy && catalogById[settingsStudy.id] && (
        <StudySettings
          def={catalogById[settingsStudy.id]}
          inst={settingsStudy}
          theme={theme}
          onSave={(inst) => updateActive({ studies: activeStudies.map((s) => (s.uid === inst.uid ? inst : s)) })}
          onClose={() => setSettingsUid(null)}
        />
      )}
    </div>
  )
}

export default App
