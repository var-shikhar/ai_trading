import type { InstrumentKind } from './api/client'

/** An instrument's kind from its symbol, for symbols that arrive without one
 * (signals, alerts, scan results, backtest trades). */
export const kindOf = (symbol: string): InstrumentKind =>
  symbol.startsWith('MCX:') ? 'COM' : symbol.endsWith('-INDEX') ? 'INDEX' : 'EQ'
