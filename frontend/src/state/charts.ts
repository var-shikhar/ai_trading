import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { InstrumentHit } from '../api/client'
import type { ChartType, ScaleMode } from '../chart/PriceChart'
import type { PanelCommand, PanelConfig, PatternState } from '../layout/ChartPanel'
import { LAYOUTS, MAX_PANELS, type SyncSettings } from '../layout/layouts'
import type { PatternSettings } from '../patterns/PatternPanel'
import { loadPref } from '../prefs'

/** The charts: their settings (symbol, interval, indicators...), the layout,
 * and what the bars around the active chart show and send. Persisted, except
 * the live bits (commands, status, patterns of the active chart). */

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
const DEFAULT_PATTERN_SETTINGS: PatternSettings = { preset: 'common', custom: [], inContext: true }
const DEFAULT_SYNC: SyncSettings = { symbol: false, interval: false, crosshair: true, time: false }

function initialPanels(): PanelConfig[] {
  // Settings saved before this store existed (separate keys) carry over.
  const saved = loadPref<PanelConfig[] | null>('panels', null)
  if (saved?.length) return saved
  const first: PanelConfig = {
    symbol: loadPref('symbol', STARTER_SYMBOLS[0]),
    tf: loadPref('tf', '1D'),
    chartType: loadPref<ChartType>('chartType', 'candles'),
    scaleMode: loadPref<ScaleMode>('scaleMode', 'normal'),
    showVolume: loadPref('volume', true),
    studies: loadPref('studies', null),
    showPatterns: loadPref('patterns', false),
    patternSettings: loadPref('patternSettings', DEFAULT_PATTERN_SETTINGS),
  }
  return [
    first,
    ...STARTER_SYMBOLS.slice(1).map((symbol) => ({ ...first, symbol, studies: null, showPatterns: false })),
  ].slice(0, MAX_PANELS)
}

// Omit applied to each member of the union separately.
export type CommandInput = PanelCommand extends infer C ? (C extends unknown ? Omit<C, 'seq'> : never) : never

const NO_PATTERNS: PatternState = { result: null, loading: false, error: null, chart: null, chartLoading: false, chartError: null }

interface ChartsState {
  panels: PanelConfig[]
  layoutId: string
  sync: SyncSettings
  favorites: string[]
  activeIndex: number
  // live, not persisted
  commands: Record<number, PanelCommand>
  status: { text: string; activeRange: string | null }
  patterns: PatternState
  highlight: string | null

  setPanels: (fn: (list: PanelConfig[]) => PanelConfig[]) => void
  /** Update one chart; symbol/interval changes spread to all charts when synced. */
  updatePanel: (index: number, patch: Partial<PanelConfig>) => void
  setLayoutId: (id: string) => void
  setSync: (s: SyncSettings) => void
  setFavorites: (f: string[]) => void
  setActiveIndex: (i: number) => void
  sendCommand: (index: number, c: CommandInput) => void
  setStatus: (text: string, activeRange: string | null) => void
  setPatterns: (p: PatternState) => void
  setHighlight: (fn: (h: string | null) => string | null) => void
}

let seq = 0

/** The chart that is active on screen: phones show one chart, and a smaller
 * layout hides charts past its count. Use this, not activeIndex, to act on
 * "the active chart" (opening a symbol from another page, etc.). */
export function activePanel(s: Pick<ChartsState, 'activeIndex' | 'layoutId'>, mobile: boolean): number {
  const count = mobile ? 1 : (LAYOUTS.find((l) => l.id === s.layoutId) ?? LAYOUTS[0]).count
  return Math.min(s.activeIndex, count - 1)
}

/** Forget hidden pattern/zone/hit keys when a chart's symbol or interval
 * changes: they belong to that chart's data, not to the next symbol's. */
function withPatch(p: PanelConfig, patch: Partial<PanelConfig>): PanelConfig {
  const next = { ...p, ...patch }
  const moved = (patch.symbol && patch.symbol.symbol !== p.symbol.symbol) || (patch.tf && patch.tf !== p.tf)
  if (!moved || patch.patternSettings) return next
  const ps = next.patternSettings
  return { ...next, patternSettings: { ...ps, hiddenHits: [], chart: ps.chart ? { ...ps.chart, hidden: [], hiddenZones: [] } : ps.chart } }
}

export const useCharts = create<ChartsState>()(
  persist(
    (set) => ({
      panels: initialPanels(),
      layoutId: loadPref('layout', '1'),
      sync: loadPref('layoutSync', DEFAULT_SYNC),
      favorites: loadPref('tfFavorites', ['15m', '1h', '4h', '1D', '1W']),
      activeIndex: 0,
      commands: {},
      status: { text: '', activeRange: null },
      patterns: NO_PATTERNS,
      highlight: null,

      setPanels: (fn) => set((s) => ({ panels: fn(s.panels) })),
      updatePanel: (index, patch) =>
        set((s) => ({
          panels: s.panels.map((p, i) => {
            if (i === index) return withPatch(p, patch)
            const shared: Partial<PanelConfig> = {}
            if (s.sync.symbol && patch.symbol) shared.symbol = patch.symbol
            if (s.sync.interval && patch.tf) shared.tf = patch.tf
            return withPatch(p, shared)
          }),
        })),
      // Keep the active chart one that the new layout shows.
      setLayoutId: (layoutId) => set((s) => ({ layoutId, activeIndex: activePanel({ ...s, layoutId }, false) })),
      setSync: (sync) => set({ sync }),
      setFavorites: (favorites) => set({ favorites }),
      setActiveIndex: (activeIndex) => set({ activeIndex }),
      sendCommand: (index, c) => set((s) => ({ commands: { ...s.commands, [index]: { ...c, seq: ++seq } as PanelCommand } })),
      setStatus: (text, activeRange) => set({ status: { text, activeRange } }),
      setPatterns: (patterns) => set({ patterns }),
      setHighlight: (fn) => set((s) => ({ highlight: fn(s.highlight) })),
    }),
    {
      name: 'charts',
      partialize: (s) => ({ panels: s.panels, layoutId: s.layoutId, sync: s.sync, favorites: s.favorites }),
    },
  ),
)

// ?symbol=NSE:SBIN-EQ&tf=1h opens a specific chart (bookmarkable).
{
  const params = new URLSearchParams(window.location.search)
  const s = params.get('symbol')
  if (s) {
    const ticker = s.split(':')[1]?.replace(/-[A-Z]+$/, '') ?? s
    useCharts.getState().updatePanel(0, {
      symbol: sym(s, ticker, '', s.endsWith('-INDEX') ? 'INDEX' : 'EQ'),
      ...(params.get('tf') ? { tf: params.get('tf')! } : {}),
    })
  }
}
