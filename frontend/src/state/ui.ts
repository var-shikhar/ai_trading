import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AlertIn } from '../alerts/types'
import type { ThemeMode } from '../chart/theme'
import type { DrawingTool } from '../drawings/types'
import { loadPref } from '../prefs'
import type { Page } from '../ui/NavRail'
import type { Dock } from '../ui/RightRail'

/** App-wide UI state: which page and panel are open, the drawing tool,
 * dialogs, theme. Page, panel and theme are remembered; the rest isn't. */

interface UiState {
  desktopPage: Page
  mobilePage: Page
  /** The tab a stock's chart was opened from on a phone (where "back" returns). */
  chartFrom: Page
  visited: Page[]
  desktopDock: Dock | null
  mobileDock: Dock | null
  themeMode: ThemeMode
  tool: DrawingTool
  drawOpen: boolean
  fullscreen: boolean
  indicatorsOpen: boolean
  settingsUid: string | null
  /** A pre-filled alert for the Alerts panel to open (chart "+", a line's bell). */
  alertRequest: Partial<AlertIn> | null

  goTo: (p: Page, mobile: boolean) => void
  setDock: (d: Dock | null, mobile: boolean) => void
  setThemeMode: (m: ThemeMode) => void
  setTool: (t: DrawingTool) => void
  setDrawOpen: (v: boolean) => void
  setFullscreen: (v: boolean) => void
  setIndicatorsOpen: (v: boolean) => void
  setSettingsUid: (uid: string | null) => void
  requestAlert: (a: Partial<AlertIn> | null) => void
}

const phoneOnly = (p: Page) => p === 'watchlist' || p === 'account'

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      desktopPage: loadPref<Page>('page', 'chart'),
      mobilePage: loadPref<Page>('pageMobile', 'watchlist'),
      chartFrom: loadPref<Page>('chartFrom', 'watchlist'),
      visited: [],
      desktopDock: loadPref<Dock | null>('dock', 'watchlist'),
      mobileDock: null,
      themeMode: loadPref<ThemeMode>('themeMode', 'system'),
      tool: 'cursor',
      drawOpen: false,
      fullscreen: false,
      indicatorsOpen: false,
      settingsUid: null,
      alertRequest: null,

      goTo: (p, mobile) =>
        set((s) => {
          const visited = s.visited.includes(p) ? s.visited : [...s.visited, p]
          if (!mobile) return { desktopPage: phoneOnly(p) ? 'chart' : p, visited }
          const chartFrom = p === 'chart' && s.mobilePage !== 'chart' ? s.mobilePage : s.chartFrom
          return { mobilePage: p, chartFrom, visited }
        }),
      setDock: (d, mobile) => set(mobile ? { mobileDock: d } : { desktopDock: d }),
      setThemeMode: (themeMode) => set({ themeMode }),
      setTool: (tool) => set({ tool }),
      setDrawOpen: (drawOpen) => set({ drawOpen }),
      setFullscreen: (fullscreen) => set({ fullscreen }),
      setIndicatorsOpen: (indicatorsOpen) => set({ indicatorsOpen }),
      setSettingsUid: (settingsUid) => set({ settingsUid }),
      requestAlert: (alertRequest) => set({ alertRequest }),
    }),
    {
      name: 'ui',
      partialize: (s) => ({
        desktopPage: s.desktopPage,
        mobilePage: s.mobilePage,
        chartFrom: s.chartFrom,
        desktopDock: s.desktopDock,
        themeMode: s.themeMode,
      }),
    },
  ),
)

// --- toasts -----------------------------------------------------------------------------------

export interface Toast {
  id: number
  text: string
  tone: 'ok' | 'err' | 'info'
}

interface ToastState {
  toasts: Toast[]
  push: (text: string, tone?: Toast['tone']) => void
  dismiss: (id: number) => void
}

let toastId = 0

/** Short confirmations ("Alert created"), gone after a few seconds. */
export const useToasts = create<ToastState>()((set, get) => ({
  toasts: [],
  push: (text, tone = 'ok') => {
    const id = ++toastId
    set({ toasts: [...get().toasts.slice(-3), { id, text, tone }] })
    setTimeout(() => get().dismiss(id), 3500)
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}))
