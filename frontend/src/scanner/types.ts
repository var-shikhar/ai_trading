export interface ScanCondition {
  type: string
  params: Record<string, number | string | boolean>
}

export interface ScanPreset {
  id: string
  name: string
  description: string
  conditions: ScanCondition[]
}

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
  high_low_52w: {
    name: '52-week high / low',
    fields: [
      { key: 'kind', label: 'Near', kind: 'select', options: [['high', '52-week high'], ['low', '52-week low']] },
      { key: 'within_pct', label: 'Within %', kind: 'float', min: 0, max: 50, step: 0.5 },
    ],
    defaults: { kind: 'high', within_pct: 3 },
  },
}
