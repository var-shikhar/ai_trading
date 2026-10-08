import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, type AuthStatus, type InstrumentHit, type PatternCatalog, type StudyDef } from './api/client'
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
import { ScannerPanel } from './scanner/ScannerPanel'
import { IndicatorDialog } from './studies/IndicatorDialog'
import { defaultStudies, newStudy } from './studies/model'
import { StudySettings } from './studies/StudySettings'
import { BottomBar } from './ui/BottomBar'
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

function App() {
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
  const layout = LAYOUTS.find((l) => l.id === layoutId) ?? LAYOUTS[0]
  const active = Math.min(activeIndex, layout.count - 1)
  const activeConfig = panels[active]

  const [tool, setTool] = useState<DrawingTool>('cursor')
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
  const [showScanner, setShowScanner] = usePref<boolean>('scanner', false)
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
    if (anyPatterns && !patternCatalog) api.patternCatalog().then(setPatternCatalog).catch(() => {})
  }, [anyPatterns, patternCatalog])

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
  }, [])

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

  return (
    <div className="app">
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
        showPatterns={activeConfig.showPatterns}
        onTogglePatterns={() => updateActive({ showPatterns: !activeConfig.showPatterns })}
        patternCount={activeConfig.showPatterns && patterns.result ? patterns.result.hits.length : null}
        themeMode={themeMode}
        onThemeMode={setThemeMode}
        dark={theme.dark}
        auth={auth}
        error={error}
        layoutMenu={<LayoutMenu layout={layout} onLayout={setLayoutId} sync={sync} onSync={setSync} />}
        showScanner={showScanner}
        onToggleScanner={() => setShowScanner((v) => !v)}
      />

      <div className="workspace">
        <DrawingToolbar
          tool={tool}
          onTool={setTool}
          hasDrawings={(drawings[activeConfig.symbol.symbol] ?? []).length > 0}
          onClearAll={() => onDrawingsChange(activeConfig.symbol.symbol, [])}
        />
        <main
          className={`chart-grid ${layout.count > 1 ? 'multi' : ''}`}
          style={{
            gridTemplateAreas: layout.areas,
            gridTemplateColumns: layout.columns,
            gridTemplateRows: layout.rows,
          }}
        >
          {!fyersReady && auth && !authenticated && <div className="overlay">Connect Fyers to load charts.</div>}
          {catalog &&
            panels.slice(0, layout.count).map((config, i) => (
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
                />
              </div>
            ))}
        </main>
        {activeConfig.showPatterns && patternCatalog && (
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
            onPickPattern={(pat) => {
              const k = patternKey(pat)
              setHighlight((h) => (h === k ? null : k))
              sendCommand({ kind: 'focus', time: pat.points[Math.floor(pat.points.length / 2)].time })
            }}
          />
        )}
        {showScanner && <ScannerPanel onOpen={(symbol) => updateActive({ symbol })} />}
      </div>

      <BottomBar
        activeRange={status.activeRange}
        onRange={(label) => sendCommand({ kind: 'range', label })}
        onGoTo={(epoch) => sendCommand({ kind: 'goto', epoch })}
        intraday={!DAILY_TIMEFRAMES.has(activeConfig.tf)}
        scaleMode={activeConfig.scaleMode}
        onScaleMode={(scaleMode) => updateActive({ scaleMode })}
        status={layout.count > 1 ? `Chart ${active + 1} · ${status.text}` : status.text}
      />

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
