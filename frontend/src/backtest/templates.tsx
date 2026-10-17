import type { BacktestRequest } from './types'

/** Ready-made strategies with fixed, published-style rules, so a backtest
 * starts from something sensible instead of an empty rule list. Every rule
 * stays editable below. */
export interface StrategyTemplate {
  id: string
  name: string
  summary: string
  evidence: string
  rules: Partial<BacktestRequest>
}

const base: Partial<BacktestRequest> = {
  side: 'long',
  exit_conditions: [],
  stop_type: 'none',
  stop_value: 0,
  target_type: 'none',
  target_value: 0,
  trail_type: 'none',
  trail_value: 0,
  max_bars: null,
  sizing: 'risk',
  size_value: 1,
  max_positions: 10,
}

const STRATEGY_TEMPLATES: StrategyTemplate[] = [
  {
    id: 'high_breakout',
    name: '52-week high breakout',
    summary: 'Buy a close above the 52-week high on 1.5× volume, above the 200-day SMA. Stop 2 ATR, trail 3 ATR, exit below the 50-day SMA.',
    evidence: 'Research: 52-week-high momentum (George & Hwang 2004; also found on NSE).',
    rules: {
      ...base,
      entry: [
        { type: 'new_high', params: { direction: 'high', bars: 252 } },
        { type: 'volume_spike', params: { multiple: 1.5, length: 50 } },
        { type: 'price_vs_ma', params: { op: 'above', ma: 'sma', length: 200 } },
      ],
      exit_conditions: [{ type: 'price_vs_ma', params: { op: 'below', ma: 'sma', length: 50 } }],
      stop_type: 'atr',
      stop_value: 2,
      trail_type: 'atr',
      trail_value: 3,
    },
  },
  {
    id: 'stage2_breakout',
    name: 'Stage 2 breakout (Minervini)',
    summary: 'Only stocks passing the trend template, buying a close above the 50-day high on volume. Stop 2 ATR, target 3R, exit below the 50-day SMA.',
    evidence: 'Practice built on momentum research: fewer, higher-quality trades.',
    rules: {
      ...base,
      entry: [
        { type: 'trend_template', params: {} },
        { type: 'new_high', params: { direction: 'high', bars: 50 } },
        { type: 'volume_spike', params: { multiple: 1.5, length: 50 } },
      ],
      exit_conditions: [{ type: 'price_vs_ma', params: { op: 'below', ma: 'sma', length: 50 } }],
      stop_type: 'atr',
      stop_value: 2,
      target_type: 'r',
      target_value: 3,
    },
  },
  {
    id: 'rsi2',
    name: 'RSI(2) mean reversion (Connors)',
    summary: 'Buy when RSI(2) drops below 10 while above the 200-day SMA; sell when the close is back above the 5-day SMA, or after 10 bars.',
    evidence: 'Backtests: high win rate (~70%) but low time in the market.',
    rules: {
      ...base,
      entry: [
        { type: 'price_vs_ma', params: { op: 'above', ma: 'sma', length: 200 } },
        { type: 'rsi', params: { op: '<', value: 10, length: 2 } },
      ],
      exit_conditions: [{ type: 'price_vs_ma', params: { op: 'above', ma: 'sma', length: 5 } }],
      max_bars: 10,
      sizing: 'pct_equity',
      size_value: 10,
    },
  },
  {
    id: 'ema_pullback',
    name: '20 EMA pullback',
    summary: 'In an uptrend, buy the close after a dip to the 20 EMA. Stop 1.5 ATR, target 2R, exit below the 50 EMA.',
    evidence: 'Practice: a common swing entry. Treat results as your own test.',
    rules: {
      ...base,
      entry: [{ type: 'ma_pullback', params: { ma: 'ema', length: 20, trend: 200 } }],
      exit_conditions: [{ type: 'price_vs_ma', params: { op: 'below', ma: 'ema', length: 50 } }],
      stop_type: 'atr',
      stop_value: 1.5,
      target_type: 'r',
      target_value: 2,
    },
  },
]

export function StrategyTemplates({
  current,
  onPick,
}: {
  current: string
  onPick: (t: StrategyTemplate) => void
}) {
  return (
    <div className="tw tester-templates">
      <h3 className="mb-1 text-[13px] font-semibold text-fg">Start from a proven strategy</h3>
      <p className="mb-2.5 text-[12px] text-muted">Fills in the rules below; change anything after.</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {STRATEGY_TEMPLATES.map((t) => {
          const active = current === t.name
          const research = t.evidence.startsWith('Research') || t.evidence.startsWith('Backtests')
          return (
            <button
              key={t.id}
              onClick={() => onPick(t)}
              aria-pressed={active}
              className={`flex cursor-pointer flex-col gap-1 rounded-xl border p-3 text-left transition-colors ${
                active ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:border-muted'
              }`}
            >
              <span className="flex items-center gap-2">
                <b className={`text-[14px] font-semibold ${active ? 'text-accent' : 'text-fg'}`}>{t.name}</b>
                <span
                  title={t.evidence}
                  className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    research ? 'bg-up-soft text-up' : 'bg-hover text-muted'
                  }`}
                >
                  {research ? 'Tested' : 'Practice'}
                </span>
              </span>
              <span className="text-[12px] leading-snug text-muted">{t.summary}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
