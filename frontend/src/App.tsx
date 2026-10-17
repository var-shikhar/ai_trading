import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { SeriesMarker, Time } from 'lightweight-charts'
import type { InstrumentHit, StudyDef, UserInfo } from './api/client'
import { useAuthStatus, useDrawings, usePatternCatalog, useStudiesCatalog } from './api/queries'
import { AlertsPanel } from './alerts/AlertsPanel'
import { AlertToasts } from './alerts/AlertToasts'
import { alertLevels, useAlerts } from './alerts/queries'
import { SignalsPage } from './alerts/SignalsPage'
import {
  ChartStrategyPanel,
  ChartStrategyReport,
  defaultChartStrategy,
  tradeMarkers,
  useChartStrategy,
} from './backtest/ChartStrategy'
import { StrategyTester } from './backtest/StrategyTester'
import type { ChartStrategy } from './backtest/types'
import { useChartTheme, type ChartTheme } from './chart/theme'
import { DrawingToolbar } from './drawings/DrawingToolbar'
import type { Drawing, DrawingTool } from './drawings/types'
import { ChartPanel, DAILY_TIMEFRAMES, type PanelConfig } from './layout/ChartPanel'
import { LAYOUTS, LayoutMenu } from './layout/layouts'
import { patternKey } from './patterns/chartPatterns'
import { PatternPanel } from './patterns/PatternPanel'
import { usePref } from './prefs'
import { MOBILE_QUERY, useMediaQuery } from './pwa'
import { ScannerPanel } from './scanner/ScannerPanel'
import { activePanel, useCharts, type CommandInput } from './state/charts'
import { kindOf } from './symbols'
import { useUi } from './state/ui'
import { IndicatorDialog } from './studies/IndicatorDialog'
import { defaultStudies, newStudy } from './studies/model'
import { StudySettings } from './studies/StudySettings'
import { AccountPage } from './ui/AccountPage'
import { BottomBar } from './ui/BottomBar'
import { InstallPrompt } from './ui/InstallPrompt'
import { Button, cx, IconButton } from './ui/kit'
import { MobileSearchBar } from './ui/MobileSearchBar'
import { HIDDEN_PAGES, NavRail, type Page } from './ui/NavRail'
import { MobileChartTabs, RightRail, type Dock } from './ui/RightRail'
import { Toaster } from './ui/Toaster'
import { TopBar } from './ui/TopBar'
import { MobileHome } from './watchlist/MobileHome'
import { WatchlistPanel } from './watchlist/WatchlistPanel'

const LETTERS = 'abcd'
const DOCK_TITLES: Record<Dock, string> = { watchlist: 'Watchlist', alerts: 'Alerts', patterns: 'Patterns', strategy: 'Strategy' }

/** Shared by the pages: the page shown, the active chart, and how to open a symbol. */
function useNavigation() {
  const mobile = useMediaQuery(MOBILE_QUERY)
  const ui = useUi(
    useShallow((s) => ({ mobilePage: s.mobilePage, desktopPage: s.desktopPage, mobileDock: s.mobileDock, desktopDock: s.desktopDock })),
  )
  const phoneOnly = (p: Page) => p === 'watchlist' || p === 'account'
  const raw: Page = mobile ? ui.mobilePage : phoneOnly(ui.desktopPage) ? 'chart' : ui.desktopPage
  // A hidden section saved as the last page opens home instead.
  const page: Page = HIDDEN_PAGES.includes(raw) ? (mobile ? 'watchlist' : 'chart') : raw
  const goTo = useCallback((p: Page) => useUi.getState().goTo(p, mobile), [mobile])
  const dock = mobile ? ui.mobileDock : ui.desktopDock
  const setDock = useCallback((d: Dock | null) => useUi.getState().setDock(d, mobile), [mobile])
  return { mobile, page, goTo, dock, setDock }
}

function App({ user, onSignOut }: { user: UserInfo; onSignOut: () => void }) {
  const { mobile, page, goTo } = useNavigation()
  const themeMode = useUi((s) => s.themeMode)
  const setThemeMode = useUi((s) => s.setThemeMode)
  const visited = useUi((s) => s.visited)
  const fullscreen = useUi((s) => s.fullscreen)
  const theme = useChartTheme(themeMode)
  const auth = useAuthStatus()
  const activeIndex = useCharts((s) => activePanel(s, mobile))
  const panels = useCharts((s) => s.panels)
  const updatePanel = useCharts((s) => s.updatePanel)

  // Pages stay mounted once opened, so a scan or a backtest survives a trip to the chart.
  useEffect(() => {
    if (!useUi.getState().visited.includes(page)) useUi.setState((s) => ({ visited: [...s.visited, page] }))
  }, [page])
  const shown = (p: Page) => p === page || visited.includes(p)

  const activeSymbol = panels[activeIndex].symbol
  const openOnChart = useCallback(
    (symbol: InstrumentHit) => {
      updatePanel(activePanel(useCharts.getState(), mobile), { symbol })
      goTo('chart')
    },
    [updatePanel, goTo, mobile],
  )

  // Lab backtest trades shown on the chart for the symbol last opened from its results.
  const [tradeMarks, setTradeMarks] = useState<{ symbol: string; markers: SeriesMarker<Time>[] } | null>(null)
  const stockScreen = mobile && page === 'chart'
  const chartOnly = fullscreen && page === 'chart'

  return (
    <div
      className={cx(
        'fixed inset-0 flex overflow-hidden bg-bg text-fg',
        mobile ? 'flex-col' : 'flex-row',
        !chartOnly && 'pt-[env(safe-area-inset-top)]',
      )}
    >
      {/* On a phone a stock's chart is its own screen (back arrow instead of tabs). */}
      {!stockScreen && !chartOnly && (
        <div className={mobile ? 'order-last' : ''}>
          <NavRail
            mobile={mobile}
            page={page}
            onPage={goTo}
            user={user}
            onSignOut={onSignOut}
            auth={auth.data ?? null}
            error={auth.error?.message ?? null}
            onFyersChanged={() => auth.refetch()}
            themeMode={themeMode}
            onThemeMode={setThemeMode}
            dark={theme.dark}
          />
        </div>
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <FyersNotice loginUrl={auth.data?.fyers.login_url} />

        <ChartPage user={user} theme={theme} tradeMarks={tradeMarks} hidden={page !== 'chart'} />

        {shown('screener') && (
          <Page hidden={page !== 'screener'}>
            <ScannerPanel onOpen={openOnChart} />
          </Page>
        )}
        {shown('lab') && !HIDDEN_PAGES.includes('lab') && (
          <Page hidden={page !== 'lab'}>
            <StrategyTester
              chartSymbol={activeSymbol}
              theme={theme}
              onOpenTrade={(trade, all) => {
                const symbol = trade.symbol
                if (symbol !== activeSymbol.symbol)
                  updatePanel(activeIndex, {
                    symbol: { symbol, ticker: trade.ticker, name: trade.ticker, kind: kindOf(symbol) },
                  })
                setTradeMarks({ symbol, markers: tradeMarkers(all.filter((t) => t.symbol === symbol), theme) })
                goTo('chart')
                // goto waits for the symbol's data (and loads older history if needed).
                useCharts.getState().sendCommand(activeIndex, { kind: 'goto', epoch: trade.entry_time })
              }}
            />
          </Page>
        )}
        {shown('signals') && (
          <Page hidden={page !== 'signals'}>
            <SignalsPage onOpen={openOnChart} />
          </Page>
        )}
        {mobile && shown('watchlist') && (
          <Page hidden={page !== 'watchlist'}>
            <MobileHome current={activeSymbol} onOpen={openOnChart} />
          </Page>
        )}
        {mobile && shown('account') && (
          <Page hidden={page !== 'account'}>
            <AccountPage
              user={user}
              onSignOut={onSignOut}
              auth={auth.data ?? null}
              onFyersChanged={() => auth.refetch()}
              themeMode={themeMode}
              onThemeMode={setThemeMode}
            />
          </Page>
        )}
        {mobile && page !== 'chart' && <MobileSearchBar current={activeSymbol} onOpen={openOnChart} />}
      </div>

      <AlertToasts />
      <Toaster />
      <InstallPrompt />
    </div>
  )
}

function Page({ hidden, children }: { hidden: boolean; children: ReactNode }) {
  return <div className={cx('min-h-0 flex-1 flex-col', hidden ? 'hidden' : 'flex animate-pop')}>{children}</div>
}

/** Result of the Fyers login (the backend returns here with ?fyers=...). Read
 * once, then removed from the address bar so a reload doesn't repeat it. */
function FyersNotice({ loginUrl }: { loginUrl?: string }) {
  const [notice, setNotice] = useState<{ ok: boolean; reason: string } | null>(() => {
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
    if (!notice?.ok) return
    const id = setTimeout(() => setNotice(null), 6000)
    return () => clearTimeout(id)
  }, [notice])
  if (!notice) return null
  return (
    <div
      role={notice.ok ? 'status' : 'alert'}
      className={cx('flex items-center gap-3 border-b border-line px-4 py-2 text-[13px]', notice.ok ? 'bg-up-soft' : 'bg-down-soft')}
    >
      <span className="flex-1">{notice.ok ? '✓ Fyers connected.' : `Fyers login didn't work: ${notice.reason || 'unknown error'}`}</span>
      {!notice.ok && loginUrl && (
        <a href={loginUrl} className="rounded-md bg-accent px-3 py-1 text-[12px] font-semibold text-accent-fg no-underline">
          Try again
        </a>
      )}
      <IconButton label="Dismiss" onClick={() => setNotice(null)}>
        ×
      </IconButton>
    </div>
  )
}

// --- the chart page ---------------------------------------------------------------------------

function ChartPage({
  user,
  theme,
  tradeMarks,
  hidden,
}: {
  user: UserInfo
  theme: ChartTheme
  tradeMarks: { symbol: string; markers: SeriesMarker<Time>[] } | null
  hidden: boolean
}) {
  const { mobile, page, goTo, dock, setDock } = useNavigation()
  const ui = useUi()
  // Everything but the status text (it changes often; StatusBar reads it).
  const charts = useCharts(
    useShallow((s) => ({
      panels: s.panels,
      layoutId: s.layoutId,
      sync: s.sync,
      favorites: s.favorites,
      activeIndex: s.activeIndex,
      patterns: s.patterns,
      highlight: s.highlight,
      updatePanel: s.updatePanel,
      sendCommand: s.sendCommand,
      setFavorites: s.setFavorites,
      setLayoutId: s.setLayoutId,
      setSync: s.setSync,
      setHighlight: s.setHighlight,
    })),
  )
  const auth = useAuthStatus()
  const catalogQuery = useStudiesCatalog()
  const catalog = catalogQuery.data ?? null
  const layout = (!mobile && LAYOUTS.find((l) => l.id === charts.layoutId)) || LAYOUTS[0]
  const active = activePanel(charts, mobile)
  const activeConfig = charts.panels[active]
  const updateActive = (patch: Partial<PanelConfig>) => charts.updatePanel(active, patch)
  const sendCommand = (c: CommandInput) => charts.sendCommand(active, c)
  const authenticated = auth.data?.fyers.authenticated ?? false
  const anyPatterns = charts.panels.slice(0, layout.count).some((p) => p.showPatterns)
  const patternCatalog = usePatternCatalog(anyPatterns || dock === 'patterns').data ?? null

  const catalogById = useMemo(
    () => Object.fromEntries((catalog ?? []).map((d) => [d.id, d])) as Record<string, StudyDef>,
    [catalog],
  )
  // Give every chart concrete indicator instances (with stable ids) once the
  // catalog is known, so settings/remove always find the instance clicked.
  useEffect(() => {
    if (!catalog) return
    useCharts.getState().setPanels((list) =>
      list.some((p) => p.studies === null) ? list.map((p) => (p.studies === null ? { ...p, studies: defaultStudies(catalog) } : p)) : list,
    )
  }, [catalog])

  // Full screen: only the chart; also the browser's own full screen where it
  // exists (Android, desktop; not iPhone Safari). Back / Esc leaves it.
  const toggleFullscreen = useCallback((on: boolean) => {
    useUi.getState().setFullscreen(on)
    if (on && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {})
    if (!on && document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
  }, [])
  useEffect(() => {
    const onChange = () => !document.fullscreenElement && useUi.getState().setFullscreen(false)
    // Esc closes an open dialog or menu first; full screen only when nothing is open.
    const onKey = (e: KeyboardEvent) =>
      e.key === 'Escape' && !document.querySelector('[role=dialog], [role=menu]') && useUi.getState().setFullscreen(false)
    document.addEventListener('fullscreenchange', onChange)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  // Alt+T trend, Alt+H horizontal, Alt+V vertical, Alt+R rectangle (as TradingView).
  useEffect(() => {
    // By key position: on a Mac, Option+T types "†" rather than "t".
    const keys: Record<string, DrawingTool> = { KeyT: 'trend', KeyH: 'hline', KeyV: 'vline', KeyR: 'rect' }
    if (hidden) return
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || (e.target as HTMLElement).closest('input, textarea, select')) return
      const t = keys[e.code]
      if (t) {
        e.preventDefault()
        useUi.getState().setTool(t)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hidden])

  // Touch screens (phones in any orientation, tablets): a tap on the chart
  // closes an open panel, like a bottom sheet. Desktop keeps it docked.
  const touch = useMediaQuery('(pointer: coarse)')
  useEffect(() => {
    if (!dock || !(mobile || touch)) return
    const onDown = (e: PointerEvent) => {
      const el = e.target as HTMLElement
      if (el.closest('[data-chart-area], [data-chart-bar]') && !el.closest('[data-dock], [role=menu], [role=dialog]')) setDock(null)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [dock, mobile, touch, setDock])

  // The strategy on the chart (hidden from the menus; still runs if it was on).
  const [chartStrategy, setChartStrategy] = usePref<ChartStrategy>('chartStrategy', defaultChartStrategy)
  const patchStrategy = useCallback((patch: Partial<ChartStrategy>) => setChartStrategy((s) => ({ ...s, ...patch })), [setChartStrategy])
  const strategyState = useChartStrategy(chartStrategy, activeConfig.symbol.symbol, activeConfig.tf, authenticated && !!catalog)
  const strategyMarks = useMemo(() => {
    const r = strategyState.result
    if (!chartStrategy.enabled || !r) return null
    return { symbol: r.request.symbol, tf: r.request.tf, markers: tradeMarkers(r.trades, theme) }
  }, [chartStrategy.enabled, strategyState.result, theme])

  const alerts = useAlerts()
  const activeDrawings = useDrawings(activeConfig.symbol.symbol, authenticated)
  const [crosshair, setCrosshair] = useState<{ time: number | null; source: number } | null>(null)
  const [timeRange, setTimeRange] = useState<{ from: number; to: number } | null>(null)
  // Date-range sync: the active chart leads; updates batched per frame.
  const rangeFrame = useRef(0)
  const onVisibleTimeRange = useCallback((r: { from: number; to: number }) => {
    cancelAnimationFrame(rangeFrame.current)
    rangeFrame.current = requestAnimationFrame(() => setTimeRange(r))
  }, [])

  // Opening the patterns panel turns patterns on for the active chart.
  const onDock = (d: Dock | null) => {
    if (d === 'patterns' && dock !== 'patterns' && !activeConfig.showPatterns) updateActive({ showPatterns: true })
    setDock(d)
  }
  // Picking a symbol in a panel: on a phone, close the panel to show the chart.
  const openFromDock = (symbol: InstrumentHit) => {
    updateActive({ symbol })
    if (mobile) setDock(null)
  }
  const askAlert = (a: Parameters<typeof ui.requestAlert>[0]) => {
    // The Alerts panel (and its dialog) isn't shown in full screen.
    if (ui.fullscreen) toggleFullscreen(false)
    ui.requestAlert(a)
    setDock('alerts')
  }
  const patterns = charts.patterns
  const badges = {
    patterns: activeConfig.showPatterns && patterns.result ? patterns.result.hits.length : null,
    strategy: chartStrategy.enabled ? 'on' : null,
  }
  const fullscreen = ui.fullscreen
  const activeStudies = activeConfig.studies ?? []
  const settingsStudy = activeStudies.find((s) => s.uid === ui.settingsUid)
  const isIndex = activeConfig.symbol.kind === 'INDEX'

  return (
    <div className={cx('min-h-0 flex-1 flex-col', hidden ? 'hidden' : 'flex')}>
      {!fullscreen && (
        <div data-chart-bar>
          <TopBar
            symbol={activeConfig.symbol}
            onSymbol={(symbol) => updateActive({ symbol })}
            tf={activeConfig.tf}
            onTf={(tf) => updateActive({ tf })}
            favorites={charts.favorites}
            onFavorites={charts.setFavorites}
            chartType={activeConfig.chartType}
            onChartType={(chartType) => updateActive({ chartType })}
            onIndicators={() => ui.setIndicatorsOpen(true)}
            layoutMenu={mobile ? undefined : <LayoutMenu layout={layout} onLayout={charts.setLayoutId} sync={charts.sync} onSync={charts.setSync} />}
            hotkeys={page === 'chart'}
            onBack={mobile ? () => goTo(ui.chartFrom === 'chart' ? 'watchlist' : ui.chartFrom) : undefined}
            extra={
              <>
                <IconButton label="Full screen chart" onClick={() => toggleFullscreen(true)}>
                  <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                    <path d="M2.5 6.5v-4h4M11.5 2.5h4v4M15.5 11.5v4h-4M6.5 15.5h-4v-4" />
                  </svg>
                </IconButton>
                {mobile && (
                  <IconButton
                    label="Drawing tools"
                    active={ui.drawOpen}
                    aria-pressed={ui.drawOpen}
                    onClick={() => {
                      if (ui.drawOpen) ui.setTool('cursor')
                      ui.setDrawOpen(!ui.drawOpen)
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
                      <path d="M3 15l1-4 8.5-8.5 3 3L7 14z M11 4l3 3" />
                    </svg>
                  </IconButton>
                )}
              </>
            }
          />
        </div>
      )}

      <div className="relative flex min-h-0 flex-1">
        {!fullscreen && (!mobile || ui.drawOpen) && (
          <div className={mobile ? 'absolute top-14 left-1.5 z-20' : 'flex'}>
            <DrawingToolbar
              floating={mobile}
              tool={ui.tool}
              onTool={ui.setTool}
              hasDrawings={activeDrawings.drawings.length > 0}
              onClearAll={() => activeDrawings.change([])}
            />
          </div>
        )}
        <main
          data-chart-area
          className={cx('relative grid min-h-0 min-w-0 flex-1', layout.count > 1 && 'gap-1 bg-line')}
          style={{ gridTemplateAreas: layout.areas, gridTemplateColumns: layout.columns, gridTemplateRows: layout.rows }}
        >
          {auth.data && !authenticated && (
            <div className="absolute top-[40%] left-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line bg-raised px-4 py-3 text-center text-[13px] text-muted shadow-card">
              {user.role === 'admin' ? 'Connect Fyers (account menu) to load charts.' : 'Market data is paused until an admin connects Fyers.'}
            </div>
          )}
          {catalog &&
            charts.panels.slice(0, layout.count).map((config, i) => (
              <div key={i} className="relative min-h-0 min-w-0 bg-bg" style={{ gridArea: LETTERS[i] }}>
                <ChartCell
                  index={i}
                  config={config}
                  active={i === active}
                  outlined={layout.count > 1}
                  theme={theme}
                  catalog={catalog}
                  catalogById={catalogById}
                  patternCatalog={patternCatalog}
                  authenticated={authenticated}
                  syncCrosshair={
                    charts.sync.crosshair && layout.count > 1 && crosshair && crosshair.source !== i ? crosshair.time : undefined
                  }
                  // Shared only when another chart follows it (saves a render per mouse move).
                  onCrosshairTime={charts.sync.crosshair && layout.count > 1 ? (time) => setCrosshair({ time, source: i }) : undefined}
                  syncRange={charts.sync.time && layout.count > 1 && i !== active ? timeRange : null}
                  onVisibleTimeRange={charts.sync.time && i === active ? onVisibleTimeRange : undefined}
                  extraMarkers={
                    strategyMarks && strategyMarks.symbol === config.symbol.symbol && strategyMarks.tf === config.tf
                      ? strategyMarks.markers
                      : !chartStrategy.enabled && tradeMarks && tradeMarks.symbol === config.symbol.symbol
                        ? tradeMarks.markers
                        : undefined
                  }
                  alertLevels={alertLevels(alerts.data, config.symbol.symbol)}
                  onPriceAlert={(price, sym) =>
                    askAlert({ kind: 'price', symbol: sym.symbol, ticker: sym.ticker, config: { op: 'crosses', value: price }, frequency: 'once' })
                  }
                  onDrawingAlert={(d, sym) => {
                    const points = d.type === 'hline' ? [{ time: 0, price: d.price }] : d.type === 'trend' ? [d.a, d.b] : null
                    if (points) askAlert({ kind: 'drawing', symbol: sym.symbol, ticker: sym.ticker, config: { op: 'crosses', points }, frequency: 'once' })
                  }}
                />
              </div>
            ))}
          {!catalog && <ChartSkeleton error={catalogQuery.error?.message} onRetry={() => catalogQuery.refetch()} />}
        </main>

        {fullscreen && (
          <button
            onClick={() => toggleFullscreen(false)}
            className="absolute top-[calc(8px+env(safe-area-inset-top))] right-[72px] z-40 inline-flex items-center gap-1.5 rounded-full border border-line bg-surface/90 px-3 py-1.5 text-[12px] text-fg shadow-card backdrop-blur"
          >
            <svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
              <path d="M6.5 2.5v4h-4M15.5 6.5h-4v-4M11.5 15.5v-4h4M2.5 11.5h4v4" />
            </svg>
            Exit full screen
          </button>
        )}

        {dock && !fullscreen && (
          <div
            key={dock}
            data-dock
            className={cx(
              'flex min-h-0 flex-col bg-surface',
              mobile
                ? 'absolute inset-x-0 bottom-0 z-30 h-[60%] animate-pop rounded-t-2xl border-t border-line shadow-[0_-8px_24px_rgba(0,0,0,0.2)]'
                : 'w-[340px] shrink-0 border-l border-line',
            )}
          >
            <div className="relative flex h-11 shrink-0 items-center justify-between border-b border-line pr-1.5 pl-4">
              {mobile && <span className="absolute top-1.5 left-1/2 h-1 w-9 -translate-x-1/2 rounded-full bg-line" />}
              <b className="text-[14px] font-semibold">{DOCK_TITLES[dock]}</b>
              <IconButton label={`Close ${DOCK_TITLES[dock]}`} onClick={() => setDock(null)}>
                <svg width="16" height="16" viewBox="0 0 18 18" stroke="currentColor" strokeWidth="1.6" aria-hidden>
                  <path d="M4.5 4.5l9 9M13.5 4.5l-9 9" />
                </svg>
              </IconButton>
            </div>
            <div className="flex min-h-0 flex-1 flex-col">
              {dock === 'patterns' &&
                (patternCatalog ? (
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
                    highlight={charts.highlight}
                    shown={activeConfig.showPatterns}
                    onShown={(showPatterns) => updateActive({ showPatterns })}
                    onPickPattern={(pat) => {
                      const k = patternKey(pat)
                      charts.setHighlight((h) => (h === k ? null : k))
                      sendCommand({ kind: 'focus', time: pat.points[Math.floor(pat.points.length / 2)].time })
                    }}
                  />
                ) : (
                  <PanelSkeleton />
                ))}
              {dock === 'alerts' && (
                <AlertsPanel
                  symbol={activeConfig.symbol}
                  createRequest={ui.alertRequest}
                  onCreateHandled={() => ui.requestAlert(null)}
                  onOpen={openFromDock}
                />
              )}
              {dock === 'watchlist' && <WatchlistPanel current={activeConfig.symbol} activeSymbol={activeConfig.symbol.symbol} onOpen={openFromDock} />}
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
          </div>
        )}
        {!mobile && !fullscreen && <RightRail dock={dock} onDock={onDock} badges={badges} />}
      </div>
      {mobile && !fullscreen && <MobileChartTabs dock={dock} onDock={onDock} badges={badges} />}

      {chartStrategy.enabled && !fullscreen && (
        <ChartStrategyReport
          strategy={chartStrategy}
          state={strategyState}
          theme={theme}
          onSettings={() => setDock('strategy')}
          onRemove={() => patchStrategy({ enabled: false })}
          onOpenTrade={(trade) => sendCommand({ kind: 'goto', epoch: trade.entry_time })}
        />
      )}

      {!fullscreen && (
        <div data-chart-bar className={mobile ? 'pb-[env(safe-area-inset-bottom)]' : ''}>
          <StatusBar
            onRange={(label) => sendCommand({ kind: 'range', label })}
            onGoTo={(epoch) => sendCommand({ kind: 'goto', epoch })}
            intraday={!DAILY_TIMEFRAMES.has(activeConfig.tf)}
            scaleMode={activeConfig.scaleMode}
            onScaleMode={(scaleMode) => updateActive({ scaleMode })}
            prefix={layout.count > 1 ? `Chart ${active + 1} · ` : ''}
          />
        </div>
      )}

      {ui.indicatorsOpen && catalog && (
        <IndicatorDialog
          catalog={catalog}
          hasVolume={!isIndex}
          volumeHidden={!activeConfig.showVolume && !isIndex}
          onAddVolume={() => updateActive({ showVolume: true })}
          onAdd={(def) => updateActive({ studies: [...activeStudies, newStudy(def, activeStudies)] })}
          onClose={() => ui.setIndicatorsOpen(false)}
        />
      )}
      {settingsStudy && catalogById[settingsStudy.id] && (
        <StudySettings
          def={catalogById[settingsStudy.id]}
          inst={settingsStudy}
          theme={theme}
          onSave={(inst) => updateActive({ studies: activeStudies.map((s) => (s.uid === inst.uid ? inst : s)) })}
          onClose={() => ui.setSettingsUid(null)}
        />
      )}
    </div>
  )
}

/** The bottom bar, with the active chart's status (read here, so status
 * updates don't re-render the whole chart page). */
function StatusBar({ prefix, ...rest }: Omit<Parameters<typeof BottomBar>[0], 'activeRange' | 'status'> & { prefix: string }) {
  const status = useCharts((s) => s.status)
  return <BottomBar {...rest} activeRange={status.activeRange} status={prefix + status.text} />
}

/** One chart of the layout, with its symbol's drawings (shared per symbol). */
function ChartCell({
  index,
  config,
  active,
  authenticated,
  ...rest
}: Omit<
  Parameters<typeof ChartPanel>[0],
  | 'onConfig'
  | 'onActivate'
  | 'command'
  | 'tool'
  | 'onToolDone'
  | 'drawings'
  | 'onDrawingsChange'
  | 'onStudySettings'
  | 'onStatus'
  | 'onPatterns'
  | 'highlightPattern'
> & { index: number }) {
  const { drawings, change } = useDrawings(config.symbol.symbol, authenticated)
  const command = useCharts((s) => s.commands[index] ?? null)
  const highlight = useCharts((s) => s.highlight)
  const tool = useUi((s) => s.tool)
  const onConfig = useCallback((patch: Partial<PanelConfig>) => useCharts.getState().updatePanel(index, patch), [index])
  const onDrawingsChange = useCallback((_: string, items: Drawing[]) => change(items), [change])
  const onStatus = useCallback((text: string, range: string | null) => useCharts.getState().setStatus(text, range), [])
  const onPatterns = useCallback((p: Parameters<ReturnType<typeof useCharts.getState>['setPatterns']>[0]) => useCharts.getState().setPatterns(p), [])
  const onToolDone = useCallback(() => useUi.getState().setTool('cursor'), [])
  return (
    <ChartPanel
      {...rest}
      config={config}
      active={active}
      authenticated={authenticated}
      onConfig={onConfig}
      onActivate={() => useCharts.getState().setActiveIndex(index)}
      command={command}
      tool={tool}
      onToolDone={onToolDone}
      drawings={drawings}
      onDrawingsChange={onDrawingsChange}
      onStudySettings={(uid) => {
        useCharts.getState().setActiveIndex(index)
        useUi.getState().setSettingsUid(uid)
      }}
      onStatus={onStatus}
      onPatterns={onPatterns}
      highlightPattern={active ? highlight : null}
    />
  )
}

/** While the indicator catalog (needed to build charts) loads. */
function ChartSkeleton({ error, onRetry }: { error?: string; onRetry: () => void }) {
  if (error)
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-[13px]">
        <span className="text-down">Couldn't load the chart settings: {error}</span>
        <Button size="sm" onClick={onRetry}>
          Retry
        </Button>
      </div>
    )
  return (
    <div className="absolute inset-0 flex flex-col gap-3 p-4" aria-busy aria-label="Loading chart">
      <span className="block h-4 w-48 animate-shimmer rounded shimmer-bg bg-[length:200%_100%]" />
      <span className="block flex-1 animate-shimmer rounded-xl shimmer-bg bg-[length:200%_100%] opacity-60" />
    </div>
  )
}

function PanelSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-4" aria-busy>
      {Array.from({ length: 6 }, (_, i) => (
        <span key={i} className="block h-9 animate-shimmer rounded-lg shimmer-bg bg-[length:200%_100%]" />
      ))}
    </div>
  )
}

export default App
