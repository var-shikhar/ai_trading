import type { ScanCondition } from '../scanner/types'

export type AlertKind = 'price' | 'drawing' | 'condition' | 'scan'
export type Channel = 'app' | 'telegram' | 'email'

export interface AlertIn {
  kind: AlertKind
  symbol?: string | null
  ticker?: string | null
  name?: string
  config: {
    op?: string
    value?: number
    points?: { time: number; price: number }[]
    conditions?: ScanCondition[]
    universe?: string
    custom?: string[]
    at?: string
  }
  tf?: string | null
  frequency: 'once' | 'once_per_bar' | 'every'
  channels: Channel[]
  message: string
  expires?: string | null
  status?: 'active' | 'paused'
}

export interface Alert extends Omit<AlertIn, 'status'> {
  id: string
  status: 'active' | 'paused' | 'triggered' | 'expired'
  created: string
  last_fired: number | null
  fire_count: number
}

export interface AlertEvent {
  id: string
  alert_id: string | null
  time: number
  symbol: string | null
  title: string
  body: string
  delivered: Record<string, string>
}

export interface AlertList {
  alerts: Alert[]
  engine: string
  channels: Record<Channel, boolean>
}

/** The editable part of a saved alert (re-arming it as `status`). */
export function toInput(a: Alert, status: 'active' | 'paused' = 'active'): AlertIn {
  const { kind, symbol, ticker, name, config, tf, frequency, channels, message, expires } = a
  return { kind, symbol, ticker, name, config, tf, frequency, channels, message, expires, status }
}

export const PRICE_OPS: [string, string][] = [
  ['crosses_above', 'Crosses above'],
  ['crosses_below', 'Crosses below'],
  ['crosses', 'Crosses'],
  ['above', 'Is above'],
  ['below', 'Is below'],
  ['change_up', 'Up % today'],
  ['change_down', 'Down % today'],
]

export const FREQUENCIES: [AlertIn['frequency'], string][] = [
  ['once', 'Only once'],
  ['once_per_bar', 'Once per bar'],
  ['every', 'Every time (max once a minute)'],
]
