import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, type InstrumentHit } from '../api/client'
import { AddCondition, ConditionCard } from '../scanner/ScannerPanel'
import { CONDITION_DEFS } from '../scanner/types'
import { useToasts } from '../state/ui'
import { Button, Field, Input, Modal, Segmented, Select, Skeleton, cx, ErrorText } from '../ui/kit'
import { useAlertActions } from './queries'
import { toInput, type Alert, type AlertIn, type Channel } from './types'

const TFS = ['5m', '15m', '30m', '1h', '2h', '4h', '1D', '1W']
const fmt = (v: number) => v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const round = (v: number) => Math.round(v * 100) / 100

// The usual choices, as tappable chips; rarer saved ones still show.
const PRICE_CHOICES: [string, string][] = [
  ['crosses', 'Crosses'],
  ['crosses_above', 'Goes above'],
  ['crosses_below', 'Goes below'],
  ['change_up', 'Up % today'],
  ['change_down', 'Down % today'],
]
const OTHER_OPS: Record<string, string> = { above: 'Is above', below: 'Is below' }
const CHANNELS: { id: Channel; label: string; icon: string }[] = [
  { id: 'app', label: 'App', icon: '🔔' },
  { id: 'telegram', label: 'Telegram', icon: '✈' },
  { id: 'email', label: 'Email', icon: '✉' },
]

/** Create or edit an alert. A price alert is the price and one tap for the
 * condition; repeat, expiry and note are under "More options". `initial`
 * pre-fills it (the chart's "+", a drawn line's bell). */
export function AlertDialog({
  symbol,
  initial,
  editing,
  channels,
  onClose,
}: {
  symbol: InstrumentHit
  initial?: Partial<AlertIn>
  editing?: Alert | null
  channels: Record<Channel, boolean>
  onClose: () => void
}) {
  const [a, setA] = useState<AlertIn>(() => ({
    kind: 'price',
    symbol: symbol.symbol,
    ticker: symbol.ticker,
    name: '',
    config: { op: 'crosses', value: 0 },
    tf: '1D',
    frequency: 'once',
    channels: ['app', ...(channels.telegram ? (['telegram'] as Channel[]) : [])],
    message: '',
    expires: null,
    ...initial,
    ...(editing ? toInput(editing) : {}),
  }))
  const [more, setMore] = useState(false)
  const { save } = useAlertActions()
  const push = useToasts((s) => s.push)
  const submitting = useRef(false)

  const set = (patch: Partial<AlertIn>) => setA((x) => ({ ...x, ...patch }))
  const setConfig = (patch: Partial<AlertIn['config']>) => setA((x) => ({ ...x, config: { ...x.config, ...patch } }))

  // Current price: shown big, and the starting level of a new alert.
  const priceSymbol = a.kind === 'price' || a.kind === 'drawing' ? a.symbol : null
  const quote = useQuery({
    queryKey: ['quote', priceSymbol],
    queryFn: () => api.quotes([priceSymbol!]).then((q) => q[priceSymbol!] ?? null),
    enabled: !!priceSymbol,
    staleTime: 15_000,
  })
  const ltp = quote.data?.ltp ?? null
  // A new price alert starts at the current price until a level is typed.
  const [typed, setTyped] = useState(!!a.config.value)
  const isPct = (o: string | undefined) => !!o?.startsWith('change')
  // (A % alert has no sensible default: it waits for a number.)
  const value = a.kind === 'price' && !typed && ltp && !isPct(a.config.op) ? round(ltp) : Number(a.config.value) || 0
  const scanCatalog = useQuery({
    queryKey: ['scanner', 'catalog'],
    queryFn: api.scannerCatalog,
    staleTime: Infinity,
    enabled: a.kind === 'scan' || a.kind === 'condition',
  })

  const switchKind = (kind: AlertIn['kind']) => {
    if (kind === a.kind) return
    if (kind === 'price') setTyped(false)
    if (kind === 'price')
      set({ kind, frequency: 'once', config: { op: 'crosses', value: 0 }, symbol: symbol.symbol, ticker: symbol.ticker })
    if (kind === 'condition')
      set({
        kind,
        symbol: symbol.symbol,
        ticker: symbol.ticker,
        frequency: 'once_per_bar',
        config: { conditions: [{ type: 'rsi', params: { ...CONDITION_DEFS.rsi.defaults } }] },
      })
    if (kind === 'scan')
      set({
        kind,
        symbol: null,
        ticker: null,
        frequency: 'every',
        config: { universe: 'nifty50', at: '15:45', conditions: [{ type: 'new_high', params: { ...CONDITION_DEFS.new_high.defaults } }] },
      })
  }

  const op = a.config.op ?? 'crosses'
  const pctOp = op.startsWith('change')
  const conditions = a.config.conditions ?? []
  const invalid =
    a.kind === 'price' ? !(value > 0) : (a.kind === 'condition' || a.kind === 'scan') ? conditions.length === 0 : false

  const submit = async () => {
    if (submitting.current || invalid) return
    submitting.current = true
    // Asked here, on a tap: browsers ignore permission prompts without one.
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {})
    try {
      const body: AlertIn = { ...a, status: 'active', config: a.kind === 'price' ? { ...a.config, value } : a.config }
      await save.mutateAsync({ id: editing?.id, body })
      push(editing ? 'Alert updated' : `Alert set${a.ticker ? ` on ${a.ticker}` : ''}`)
      onClose()
    } catch {
      submitting.current = false // shown below; let them fix it and retry
    }
  }

  const choices = OTHER_OPS[op] ? [...PRICE_CHOICES, [op, OTHER_OPS[op]] as [string, string]] : PRICE_CHOICES
  const distance = ltp && value > 0 && !pctOp ? (value / ltp - 1) * 100 : null

  return (
    <Modal
      title={
        <span className="flex items-center gap-2">
          {editing ? 'Edit alert' : 'New alert'}
          {a.ticker && <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-[12px] font-semibold text-accent">{a.ticker}</span>}
        </span>
      }
      onClose={onClose}
      width={460}
      footer={
        <>
          <span className="flex-1" />
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={invalid} loading={save.isPending} onClick={submit}>
            {editing ? 'Save' : 'Create alert'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {a.kind !== 'drawing' && !editing && (
          <Segmented
            className="w-full"
            value={a.kind}
            onChange={switchKind}
            options={[
              ['price', 'Price'],
              ['condition', 'Indicator'],
              ['scan', 'Daily scan'],
            ]}
          />
        )}

        {(a.kind === 'price' || a.kind === 'drawing') && (
          <>
            {/* Current price */}
            <div className="flex items-center justify-between rounded-xl bg-hover px-4 py-3">
              <span className="text-[12px] font-medium text-muted">Current price</span>
              {quote.isPending && priceSymbol ? (
                <Skeleton className="h-5 w-24" />
              ) : ltp ? (
                <span className="flex items-baseline gap-2">
                  <b className="text-[17px] font-semibold tabular-nums">₹{fmt(ltp)}</b>
                  {quote.data?.chp != null && (
                    <span className={cx('text-[12px] font-medium tabular-nums', quote.data.chp >= 0 ? 'text-up' : 'text-down')}>
                      {quote.data.chp >= 0 ? '+' : ''}
                      {quote.data.chp.toFixed(2)}%
                    </span>
                  )}
                </span>
              ) : (
                <span className="text-[13px] text-muted">unavailable</span>
              )}
            </div>

            {/* Condition */}
            <div className="flex flex-col gap-2">
              <span className="text-[12px] font-medium text-muted">Alert me when the price</span>
              <div className="flex flex-wrap gap-1.5">
                {choices
                  .filter(([o]) => a.kind === 'price' || !o.startsWith('change'))
                  .map(([o, label]) => (
                    <button
                      key={o}
                      onClick={() => {
                        // Switching between a price and a % keeps no number: 2450 isn't a sensible 2450%.
                        if (isPct(o) !== isPct(op)) {
                          setTyped(false)
                          setConfig({ op: o, value: 0 })
                        } else setConfig({ op: o })
                      }}
                      aria-pressed={op === o}
                      className={cx(
                        'rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition',
                        op === o ? 'border-accent bg-accent text-accent-fg' : 'border-line text-fg hover:bg-hover',
                      )}
                    >
                      {label}
                    </button>
                  ))}
              </div>
            </div>

            {a.kind === 'price' ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 rounded-xl border border-line bg-surface px-4 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-soft">
                  {!pctOp && <span className="text-[22px] text-muted">₹</span>}
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.05"
                    min="0"
                    value={value || ''}
                    placeholder={pctOp ? 'e.g. 3' : 'Price'}
                    onChange={(e) => {
                      setTyped(true)
                      setConfig({ value: e.target.value === '' ? 0 : Number(e.target.value) })
                    }}
                    aria-label={pctOp ? 'Percent' : 'Price'}
                    className="h-14 min-w-0 flex-1 bg-transparent text-[24px] font-semibold tabular-nums text-fg outline-none"
                  />
                  {pctOp && <span className="text-[22px] text-muted">%</span>}
                </div>
                {distance !== null && (
                  <p className={cx('text-[12px] font-medium', distance >= 0 ? 'text-up' : 'text-down')}>
                    {distance >= 0 ? '▲' : '▼'} {Math.abs(distance).toFixed(2)}% {distance >= 0 ? 'above' : 'below'} the current price
                  </p>
                )}
                {!pctOp && ltp && (
                  <div className="flex flex-wrap gap-1.5">
                    {[-5, -2, -1, 0, 1, 2, 5].map((p) => (
                      <button
                        key={p}
                        onClick={() => {
                          setTyped(true)
                          setConfig({ value: round(ltp * (1 + p / 100)) })
                        }}
                        className="rounded-md bg-hover px-2.5 py-1 text-[12px] font-medium text-muted transition hover:text-fg"
                      >
                        {p === 0 ? 'Now' : `${p > 0 ? '+' : ''}${p}%`}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <p className="rounded-xl bg-accent-soft px-4 py-3 text-[13px] text-accent">
                Fires when the price {op === 'crosses' ? 'crosses' : op === 'crosses_above' ? 'goes above' : 'goes below'} your{' '}
                {a.config.points?.length === 1 ? 'horizontal line' : 'trend line (extended to the right)'}.
              </p>
            )}
          </>
        )}

        {a.kind === 'condition' && (
          <Field label={`${a.ticker} timeframe`}>
            <Select value={a.tf ?? '1D'} onChange={(e) => set({ tf: e.target.value })}>
              {TFS.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </Select>
          </Field>
        )}
        {a.kind === 'scan' && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Stocks" className="sm:col-span-2">
              {scanCatalog.data ? (
                <Select value={a.config.universe} onChange={(e) => setConfig({ universe: e.target.value })}>
                  {scanCatalog.data.universes.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </Select>
              ) : (
                <Skeleton className="h-10 w-full" />
              )}
            </Field>
            <Field label="Every trading day at (IST)">
              <Input type="time" value={a.config.at ?? '15:45'} onChange={(e) => setConfig({ at: e.target.value })} />
            </Field>
            <Field label="Name">
              <Input value={a.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Breakouts" />
            </Field>
          </div>
        )}
        {(a.kind === 'condition' || a.kind === 'scan') && (
          <div className="flex flex-col gap-2">
            <p className="text-[12px] text-muted">
              {a.kind === 'condition'
                ? 'Fires when all of these hold on a closed bar (never on a forming one).'
                : 'Runs after the close and tells you only the stocks that newly match.'}
            </p>
            {conditions.map((c, i) => (
              <ConditionCard
                key={i}
                condition={c}
                onChange={(next) => setConfig({ conditions: conditions.map((x, j) => (j === i ? next : x)) })}
                onRemove={() => setConfig({ conditions: conditions.filter((_, j) => j !== i) })}
              />
            ))}
            <AddCondition
              available={Object.keys(CONDITION_DEFS)}
              label="+ Add condition (all must match)"
              onAdd={(c) => setConfig({ conditions: [...conditions, c] })}
            />
          </div>
        )}

        {/* Notify */}
        <div className="flex flex-col gap-2">
          <span className="text-[12px] font-medium text-muted">Notify me in</span>
          <div className="flex flex-wrap gap-1.5">
            {CHANNELS.map((ch) => {
              const on = a.channels.includes(ch.id)
              const available = channels[ch.id]
              return (
                <button
                  key={ch.id}
                  // A channel no longer set up can still be switched off.
                  disabled={!available && !on}
                  title={available ? undefined : 'Set it up in Profile & notifications'}
                  aria-pressed={on}
                  onClick={() => {
                    const next = on ? a.channels.filter((c) => c !== ch.id) : [...a.channels, ch.id]
                    if (next.length) set({ channels: next }) // at least one
                  }}
                  className={cx(
                    'inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition disabled:opacity-40',
                    on ? 'border-accent bg-accent-soft text-accent' : 'border-line text-muted hover:bg-hover',
                  )}
                >
                  <span aria-hidden>{ch.icon}</span> {ch.label}
                  {on && <span aria-hidden>✓</span>}
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <button onClick={() => setMore(!more)} aria-expanded={more} className="flex items-center gap-1 text-[13px] font-medium text-accent">
            <span className={cx('inline-block transition', more && 'rotate-90')}>▸</span> More options
          </button>
          {more && (
            <div className="mt-3 grid animate-pop grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Repeat" className="sm:col-span-2">
                <Segmented
                  className="w-full"
                  size="sm"
                  value={a.frequency}
                  onChange={(frequency) => set({ frequency })}
                  options={
                    a.kind === 'scan'
                      ? [
                          ['once', 'Once'],
                          ['every', 'Every day'],
                        ]
                      : [
                          ['once', 'Once'],
                          ['once_per_bar', 'Once per bar'],
                          ['every', 'Every time'],
                        ]
                  }
                />
              </Field>
              <Field label="Until" hint="Blank = no end">
                <Input
                  type="date"
                  value={a.expires?.slice(0, 10) ?? ''}
                  onChange={(e) => set({ expires: e.target.value ? `${e.target.value}T23:59:59` : null })}
                />
              </Field>
              <Field label="Note" hint="Shown in the notification">
                <Input value={a.message} onChange={(e) => set({ message: e.target.value })} placeholder="Optional" />
              </Field>
            </div>
          )}
        </div>

        <ErrorText>{save.error?.message}</ErrorText>
      </div>
    </Modal>
  )
}
