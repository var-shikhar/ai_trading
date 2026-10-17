export interface ScanCondition {
  type: string
  params: Record<string, number | string | boolean>
}

export interface ScanPreset {
  id: string
  name: string
  description: string
  group?: string
  /** "Research: ..." or "Practice: ..." */
  evidence?: string
  conditions: ScanCondition[]
}

/** Daily data for the whole NSE (the "nse_liquid" universe). */
export interface MarketStatus {
  status: 'idle' | 'running' | 'done' | 'error'
  phase: '' | 'history' | 'today'
  done: number
  total: number
  message: string
  eta_seconds: number | null
  last_success: string | null
  errors: string[]
  equities: number
  stored: number
  latest_bar: string | null
  liquid: number
}

export const MARKET_UNIVERSE = 'nse_liquid'

export interface ScanCatalog {
  universes: { id: string; name: string }[]
  conditions: string[]
  presets: ScanPreset[]
  timeframes: string[]
}

export interface ScanMatch {
  symbol: string
  ticker: string
  name: string
  industry: string
  close: number
  change_pct: number
  time: number
  details: string[]
}

export interface ScanJob {
  id: string
  universe: string
  tf: string
  status: 'running' | 'done' | 'cancelled' | 'error'
  message: string
  total: number
  done: number
  eta_seconds: number | null
  elapsed_seconds: number
  matches: ScanMatch[]
  errors: string[]
}

type Field =
  | { key: string; label: string; kind: 'int' | 'float'; min?: number; max?: number; step?: number }
  | { key: string; label: string; kind: 'select'; options: [string, string][] }
  | { key: string; label: string; kind: 'bool' }

/** Editor schema for each condition the backend supports. */
export const CONDITION_DEFS: Record<string, { name: string; fields: Field[]; defaults: ScanCondition['params'] }> = {
  breakout: {
    name: 'Breakout from consolidation',
    fields: [
      { key: 'direction', label: 'Direction', kind: 'select', options: [['up', 'Up'], ['down', 'Down']] },
      { key: 'bars', label: 'Range bars', kind: 'int', min: 5, max: 100 },
      { key: 'pct', label: 'Max range %', kind: 'float', min: 0.5, max: 30, step: 0.5 },
    ],
    defaults: { direction: 'up', bars: 15, pct: 6 },
  },
  consolidation: {
    name: 'Consolidating',
    fields: [
      { key: 'bars', label: 'Bars', kind: 'int', min: 5, max: 100 },
      { key: 'pct', label: 'Max range %', kind: 'float', min: 0.5, max: 30, step: 0.5 },
    ],
    defaults: { bars: 15, pct: 4 },
  },
  candle_pattern: {
    name: 'Candlestick pattern',
    fields: [
      { key: 'direction', label: 'Direction', kind: 'select', options: [['any', 'Any'], ['bullish', 'Bullish'], ['bearish', 'Bearish']] },
      { key: 'within', label: 'In last bars', kind: 'int', min: 1, max: 20 },
      { key: 'in_context', label: 'Trend context', kind: 'bool' },
    ],
    defaults: { direction: 'bullish', within: 2, in_context: true },
  },
  chart_pattern: {
    name: 'Chart pattern',
    fields: [
      { key: 'direction', label: 'Direction', kind: 'select', options: [['any', 'Any'], ['bullish', 'Bullish'], ['bearish', 'Bearish']] },
      { key: 'status', label: 'Status', kind: 'select', options: [['any', 'Forming or confirmed'], ['forming', 'Forming'], ['confirmed', 'Confirmed']] },
      { key: 'within', label: 'In last bars', kind: 'int', min: 1, max: 40 },
      { key: 'sensitivity', label: 'Sensitivity', kind: 'select', options: [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']] },
    ],
    defaults: { direction: 'bullish', status: 'any', within: 5, sensitivity: 'medium' },
  },
  near_zone: {
    name: 'Near S/R zone',
    fields: [
      { key: 'kind', label: 'Zone', kind: 'select', options: [['support', 'Support'], ['resistance', 'Resistance']] },
      { key: 'within_atr', label: 'Within ATRs', kind: 'float', min: 0.1, max: 10, step: 0.1 },
    ],
    defaults: { kind: 'support', within_atr: 1 },
  },
  rsi: {
    name: 'RSI',
    fields: [
      { key: 'op', label: 'Is', kind: 'select', options: [['<', 'Below'], ['>', 'Above']] },
      { key: 'value', label: 'Level', kind: 'float', min: 0, max: 100 },
      { key: 'length', label: 'Length', kind: 'int', min: 2, max: 100 },
    ],
    defaults: { op: '<', value: 30, length: 14 },
  },
  price_vs_ma: {
    name: 'Price vs moving average',
    fields: [
      { key: 'op', label: 'Price is', kind: 'select', options: [['above', 'Above'], ['below', 'Below']] },
      { key: 'ma', label: 'Average', kind: 'select', options: [['ema', 'EMA'], ['sma', 'SMA']] },
      { key: 'length', label: 'Length', kind: 'int', min: 2, max: 400 },
    ],
    defaults: { op: 'above', ma: 'ema', length: 200 },
  },
  ma_cross: {
    name: 'Moving average cross',
    fields: [
      { key: 'direction', label: 'Cross', kind: 'select', options: [['golden', 'Golden (fast above)'], ['death', 'Death (fast below)']] },
      { key: 'ma', label: 'Average', kind: 'select', options: [['ema', 'EMA'], ['sma', 'SMA']] },
      { key: 'fast', label: 'Fast', kind: 'int', min: 2, max: 400 },
      { key: 'slow', label: 'Slow', kind: 'int', min: 3, max: 400 },
      { key: 'within', label: 'In last bars', kind: 'int', min: 1, max: 40 },
    ],
    defaults: { direction: 'golden', ma: 'ema', fast: 50, slow: 200, within: 5 },
  },
  macd_cross: {
    name: 'MACD cross',
    fields: [
      { key: 'direction', label: 'Cross', kind: 'select', options: [['bullish', 'Above signal'], ['bearish', 'Below signal']] },
      { key: 'within', label: 'In last bars', kind: 'int', min: 1, max: 20 },
    ],
    defaults: { direction: 'bullish', within: 3 },
  },
  volume_spike: {
    name: 'Volume spike',
    fields: [
      { key: 'multiple', label: '× average', kind: 'float', min: 1, max: 20, step: 0.5 },
      { key: 'length', label: 'Average bars', kind: 'int', min: 5, max: 100 },
    ],
    defaults: { multiple: 2, length: 20 },
  },
  new_high: {
    name: 'New high / low',
    fields: [
      { key: 'direction', label: 'Closed above', kind: 'select', options: [['high', 'N-bar high'], ['low', 'N-bar low (below)']] },
      { key: 'bars', label: 'N bars (252 = 52 weeks)', kind: 'int', min: 10, max: 400 },
    ],
    defaults: { direction: 'high', bars: 252 },
  },
  trend_template: {
    name: 'Stage 2 uptrend (Minervini)',
    fields: [],
    defaults: {},
  },
  ma_pullback: {
    name: 'Pullback to moving average',
    fields: [
      { key: 'ma', label: 'Average', kind: 'select', options: [['ema', 'EMA'], ['sma', 'SMA']] },
      { key: 'length', label: 'Length', kind: 'int', min: 5, max: 100 },
      { key: 'trend', label: 'Trend SMA', kind: 'int', min: 20, max: 400 },
    ],
    defaults: { ma: 'ema', length: 20, trend: 200 },
  },
  narrow_range: {
    name: 'Narrow range (NR7)',
    fields: [
      { key: 'bars', label: 'Narrowest of bars', kind: 'int', min: 3, max: 20 },
      { key: 'inside', label: 'Also inside bar', kind: 'bool' },
    ],
    defaults: { bars: 7, inside: false },
  },
  day_change: {
    name: 'Change on the bar',
    fields: [
      { key: 'op', label: 'Change is', kind: 'select', options: [['>', 'Above'], ['<', 'Below']] },
      { key: 'value', label: '%', kind: 'float', min: -50, max: 50, step: 0.5 },
    ],
    defaults: { op: '>', value: 3 },
  },
  high_low_52w: {
    name: '52-week high / low',
    fields: [
      { key: 'kind', label: 'Near', kind: 'select', options: [['high', '52-week high'], ['low', '52-week low']] },
      { key: 'within_pct', label: 'Within %', kind: 'float', min: 0, max: 50, step: 0.5 },
    ],
    defaults: { kind: 'high', within_pct: 3 },
  },
}

/** One line in plain words for a condition, e.g. "RSI(2) below 10". */
export function describeCondition(c: ScanCondition): string {
  const def = CONDITION_DEFS[c.type]
  if (!def) return c.type
  const p = { ...def.defaults, ...c.params }
  switch (c.type) {
    case 'rsi':
      return `RSI(${p.length}) ${p.op === '<' ? 'below' : 'above'} ${p.value}`
    case 'price_vs_ma':
      return `Price ${p.op} ${String(p.ma).toUpperCase()} ${p.length}`
    case 'volume_spike':
      return `Volume ≥ ${p.multiple}× ${p.length}-bar average`
    case 'new_high':
      return p.direction === 'high' ? `Close above ${p.bars}-bar high` : `Close below ${p.bars}-bar low`
    case 'high_low_52w':
      return `Within ${p.within_pct}% of 52-week ${p.kind}`
    case 'day_change':
      return `Change ${p.op === '>' ? 'above' : 'below'} ${p.value}%`
    case 'narrow_range':
      return `NR${p.bars}${p.inside ? ' inside bar' : ''}`
    case 'ma_pullback':
      return `Dip to ${String(p.ma).toUpperCase()} ${p.length}, above SMA ${p.trend}`
    case 'breakout':
      return `Breakout ${p.direction} from ${p.bars}-bar range ≤ ${p.pct}%`
    case 'consolidation':
      return `${p.bars}-bar range ≤ ${p.pct}%`
    case 'ma_cross':
      return `${String(p.ma).toUpperCase()} ${p.fast}/${p.slow} ${p.direction} cross, last ${p.within} bars`
    case 'macd_cross':
      return `MACD ${p.direction} cross, last ${p.within} bars`
    case 'candle_pattern':
      return `${p.direction === 'any' ? 'Any' : String(p.direction)[0].toUpperCase() + String(p.direction).slice(1)} candle pattern, last ${p.within} bars`
    case 'chart_pattern':
      return `${p.direction === 'any' ? 'Any' : p.direction} chart pattern, last ${p.within} bars`
    case 'near_zone':
      return `Within ${p.within_atr} ATR of ${p.kind}`
    default:
      return def.name
  }
}
