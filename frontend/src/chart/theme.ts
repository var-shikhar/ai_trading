import { useEffect, useState } from 'react'

export type ThemeMode = 'system' | 'light' | 'dark'

// Chart colors per theme. Up/down follow the usual market convention. Study
// lines draw from an 8-slot categorical palette (stepped separately for each
// theme) whose order keeps neighbouring slots apart for colorblind readers.
export interface ChartTheme {
  dark: boolean
  surface: string
  text: string
  muted: string
  grid: string
  border: string
  crosshair: string
  up: string
  down: string
  upVolume: string
  downVolume: string
  upHist: string
  downHist: string
  guide: string
  series: string[]
}

export const LIGHT: ChartTheme = {
  dark: false,
  surface: '#ffffff',
  text: '#0f172a',
  muted: '#64748b',
  grid: '#f1f4f9',
  border: '#e3e7ef',
  crosshair: '#94a3b8',
  up: '#0a9f7a',
  down: '#e5484d',
  upVolume: 'rgba(10, 159, 122, 0.4)',
  downVolume: 'rgba(229, 72, 77, 0.4)',
  upHist: 'rgba(10, 159, 122, 0.7)',
  downHist: 'rgba(229, 72, 77, 0.7)',
  guide: '#b2b5be',
  series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
}

export const DARK: ChartTheme = {
  dark: true,
  surface: '#0f131b',
  text: '#e4e8f0',
  muted: '#8a93a6',
  grid: '#171c27',
  border: '#212737',
  crosshair: '#6b7590',
  up: '#22c08f',
  down: '#f2555c',
  upVolume: 'rgba(34, 192, 143, 0.4)',
  downVolume: 'rgba(242, 85, 92, 0.4)',
  upHist: 'rgba(34, 192, 143, 0.7)',
  downHist: 'rgba(242, 85, 92, 0.7)',
  guide: '#5d606b',
  series: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
}

/** Study colors are stored as tokens so they follow the theme: 'up', 'down',
 * 'slot:N' (palette slot), or a literal '#rrggbb' the user picked. */
export function resolveColor(token: string, theme: ChartTheme): string {
  if (token === 'up') return theme.up
  if (token === 'down') return theme.down
  if (token.startsWith('slot:')) return theme.series[Number(token.slice(5)) % theme.series.length]
  return token
}

export function useChartTheme(mode: ThemeMode): ChartTheme {
  const query = '(prefers-color-scheme: dark)'
  const [systemDark, setSystemDark] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])
  // CSS follows the same choice via data-theme on <html>.
  useEffect(() => {
    if (mode === 'system') delete document.documentElement.dataset.theme
    else document.documentElement.dataset.theme = mode
  }, [mode])
  const dark = mode === 'dark' || (mode === 'system' && systemDark)
  return dark ? DARK : LIGHT
}
