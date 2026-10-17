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
  /** Patterns (patternKey) the user hid from the chart. */
  hidden?: string[]
  /** Support/resistance zones (zoneKey) the user hid from the chart. */
  hiddenZones?: string[]
}

export const DEFAULT_CHART_PATTERN_SETTINGS: ChartPatternSettings = {
  sensitivity: 'medium',
  showZones: true,
  showFailed: false,
}

export const patternKey = (p: ChartPattern) => `${p.type}:${p.start_time}`

export const zoneKey = (z: Zone) => `${z.kind}:${z.low.toFixed(2)}:${z.high.toFixed(2)}`

/** The result without the patterns and zones the user hid. */
export function visiblePatterns(
  result: ChartPatternResult | null,
  hidden: string[] | undefined,
  hiddenZones: string[] | undefined,
): ChartPatternResult | null {
  if (!result || (!hidden?.length && !hiddenZones?.length)) return result
  const off = new Set(hidden)
  const offZones = new Set(hiddenZones)
  return {
    ...result,
    patterns: result.patterns.filter((p) => !off.has(patternKey(p))),
    zones: result.zones.filter((z) => !offZones.has(zoneKey(z))),
  }
}
