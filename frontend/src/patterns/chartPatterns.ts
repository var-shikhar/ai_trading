import type { Pt } from '../drawings/types'

export type Sensitivity = 'low' | 'medium' | 'high'
export type PatternStatus = 'forming' | 'confirmed' | 'failed'

export interface ChartPattern {
  type: string
  name: string
  direction: 'bullish' | 'bearish' | 'neutral'
  status: PatternStatus
  points: Pt[]
  lines: { from: Pt; to: Pt; role: string }[]
  target: number | null
  breakout: Pt | null
  start_time: number
  end_time: number
}

export interface Zone {
  low: number
  high: number
  touches: number
  kind: 'support' | 'resistance'
  first_time: number
  last_time: number
  distance_atr: number
}

export interface ChartPatternResult {
  swings: (Pt & { kind: 'H' | 'L'; confirmed: boolean })[]
  patterns: ChartPattern[]
  zones: Zone[]
}

export interface ChartPatternSettings {
  sensitivity: Sensitivity
  showZones: boolean
  showFailed: boolean
}

export const DEFAULT_CHART_PATTERN_SETTINGS: ChartPatternSettings = {
  sensitivity: 'medium',
  showZones: true,
  showFailed: false,
}

export const patternKey = (p: ChartPattern) => `${p.type}:${p.start_time}`
