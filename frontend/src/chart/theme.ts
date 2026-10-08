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
  text: '#131722',
  muted: '#787b86',
  grid: '#f0f3fa',
  border: '#e0e3eb',
  crosshair: '#9598a1',
  up: '#089981',
  down: '#f23645',
  upVolume: 'rgba(8, 153, 129, 0.45)',
  downVolume: 'rgba(242, 54, 69, 0.45)',
  upHist: 'rgba(8, 153, 129, 0.7)',
  downHist: 'rgba(242, 54, 69, 0.7)',
  guide: '#b2b5be',
  series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
}

export const DARK: ChartTheme = {
  dark: true,
  surface: '#131722',
  text: '#d1d4dc',
  muted: '#868993',
  grid: '#1e222d',
  border: '#2a2e39',
  crosshair: '#758696',
  up: '#22ab94',
  down: '#f7525f',
  upVolume: 'rgba(34, 171, 148, 0.45)',
  downVolume: 'rgba(247, 82, 95, 0.45)',
  upHist: 'rgba(34, 171, 148, 0.7)',
  downHist: 'rgba(247, 82, 95, 0.7)',
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
