import { useEffect, useState } from 'react'

// Chart colors per theme. Up/down follow the usual market convention; the EMA
// lines use categorical slots validated for colorblind separation (light & dark).
export interface ChartTheme {
  surface: string
  text: string
  muted: string
  grid: string
  border: string
  up: string
  down: string
  upVolume: string
  downVolume: string
  ema20: string
  ema50: string
  ema200: string
  rsi: string
  guide: string
}

export const LIGHT: ChartTheme = {
  surface: '#ffffff',
  text: '#131722',
  muted: '#787b86',
  grid: '#f0f3fa',
  border: '#e0e3eb',
  up: '#089981',
  down: '#f23645',
  upVolume: 'rgba(8, 153, 129, 0.45)',
  downVolume: 'rgba(242, 54, 69, 0.45)',
  ema20: '#2a78d6',
  ema50: '#eb6834',
  ema200: '#4a3aa7',
  rsi: '#2a78d6',
  guide: '#b2b5be',
}

export const DARK: ChartTheme = {
  surface: '#131722',
  text: '#d1d4dc',
  muted: '#868993',
  grid: '#1e222d',
  border: '#2a2e39',
  up: '#22ab94',
  down: '#f7525f',
  upVolume: 'rgba(34, 171, 148, 0.45)',
  downVolume: 'rgba(247, 82, 95, 0.45)',
  ema20: '#3987e5',
  ema50: '#d95926',
  ema200: '#9085e9',
  rsi: '#3987e5',
  guide: '#5d606b',
}

export function useChartTheme(): ChartTheme {
  const query = '(prefers-color-scheme: dark)'
  const [dark, setDark] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = (e: MediaQueryListEvent) => setDark(e.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])
  return dark ? DARK : LIGHT
}
