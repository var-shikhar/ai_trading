import { useEffect, useState } from 'react'
import { api, type InstrumentHit } from '../api/client'
import { ConditionCard } from '../scanner/ScannerPanel'
import { CONDITION_DEFS, type ScanCatalog } from '../scanner/types'
import { Modal } from '../ui/Modal'
import { useAlertActions } from './queries'
import { FREQUENCIES, PRICE_OPS, toInput, type Alert, type AlertIn, type Channel } from './types'

const TFS = ['5m', '15m', '30m', '1h', '2h', '4h', '1D', '1W']
const fmt = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 2 })
const round = (v: number) => Math.round(v * 100) / 100

/** Create or edit an alert. A price alert is one line ("crosses ₹X");
 * everything else is under "More options". `initial` pre-fills it (from the
 * chart's "Alert at price", or a drawn line's bell). */
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
    // "Crosses" fires whichever way the price reaches the level.
    config: { op: 'crosses', value: 0 },
    tf: '1D',
    frequency: 'once',
    channels: ['app', ...(channels.telegram ? (['telegram'] as Channel[]) : [])],
    message: '',
    expires: null,
    ...initial,
    ...(editing ? toInput(editing) : {}),
  }))
  const [ltp, setLtp] = useState<number | null>(null)
  const [scanCatalog, setScanCatalog] = useState<ScanCatalog | null>(null)
  const [more, setMore] = useState(false)
  const { save } = useAlertActions()

  const set = (patch: Partial<AlertIn>) => setA((x) => ({ ...x, ...patch }))
  const setConfig = (patch: Partial<AlertIn['config']>) => setA((x) => ({ ...x, config: { ...x.config, ...patch } }))

  // Current price: shown next to the level, and the starting level of a new alert.
  const priceSymbol = a.kind === 'price' || a.kind === 'drawing' ? a.symbol : null
  useEffect(() => {
    if (!priceSymbol) return
    api.quotes([priceSymbol]).then((q) => {
      const p = q[priceSymbol]?.ltp
      if (!p) return
      setLtp(p)
      setA((x) => (x.kind === 'price' && !x.config.value ? { ...x, config: { ...x.config, value: round(p) } } : x))
    }, () => {})
  }, [priceSymbol])
  useEffect(() => {
    if (a.kind === 'scan' || a.kind === 'condition') api.scannerCatalog().then(setScanCatalog, () => {})
  }, [a.kind])

  const switchKind = (kind: AlertIn['kind']) => {
    if (kind === a.kind) return
    if (kind === 'price')
      set({ kind, config: { op: 'crosses', value: ltp ? round(ltp) : 0 }, symbol: symbol.symbol, ticker: symbol.ticker })
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
        config: { universe: 'nifty50', at: '15:45', conditions: [{ type: 'breakout', params: { ...CONDITION_DEFS.breakout.defaults } }] },
      })
  }

  const pctOp = a.config.op?.startsWith('change') ?? false
  const conditions = a.config.conditions ?? []
  const invalid =
    a.kind === 'price'
      ? !(Number(a.config.value) > 0)
      : (a.kind === 'condition' || a.kind === 'scan') && conditions.length === 0
  const create = async () => {
    // Asked here, on a tap: browsers ignore permission prompts without one.
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {})
    try {
      await save.mutateAsync({ id: editing?.id, body: { ...a, status: 'active' } })
      onClose()
    } catch {
      // shown below from save.error
    }
  }

  const priceRow = (
    <div className="alert-price">
      <span className="alert-sentence">
        <b>{a.ticker}</b>
        <select value={a.config.op} onChange={(e) => setConfig({ op: e.target.value })} aria-label="Condition">
          {PRICE_OPS.filter(([op]) => a.kind === 'price' || !op.startsWith('change')).map(([op, l]) => (
            <option key={op} value={op}>
              {l.toLowerCase()}
            </option>
          ))}
        </select>
        {a.kind === 'price' ? (
          <span className="alert-value">
            {!pctOp && <span className="muted">₹</span>}
            <input
              type="number"
              inputMode="decimal"
              step="0.05"
              min="0"
              value={a.config.value || ''}
              placeholder={pctOp ? '%' : 'price'}
              onChange={(e) => setConfig({ value: e.target.value === '' ? 0 : Number(e.target.value) })}
              aria-label={pctOp ? 'Percent' : 'Price'}
            />
            {pctOp && <span className="muted">%</span>}
          </span>
        ) : (
          <b>{a.config.points?.length === 1 ? 'your horizontal line' : 'your trend line'}</b>
        )}
      </span>
      {a.kind === 'price' && !pctOp && ltp !== null && (
        <>
          <p className="note">
            Now ₹{fmt(ltp)}
            {Number(a.config.value) > 0 &&
              ` · level is ${fmt(Math.abs((Number(a.config.value) / ltp - 1) * 100))}% ${Number(a.config.value) >= ltp ? 'above' : 'below'}`}
          </p>
          <div className="chip-row">
            {[-5, -2, -1, 0, 1, 2, 5].map((p) => (
              <button key={p} className="chip" onClick={() => setConfig({ value: round(ltp * (1 + p / 100)) })}>
                {p === 0 ? 'Now' : `${p > 0 ? '+' : ''}${p}%`}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )

  return (
    <Modal
      title={editing ? 'Edit alert' : a.kind === 'drawing' ? 'Alert on your line' : 'New alert'}
      onClose={onClose}
      width={480}
      footer={
        <>
          {save.error && <span className="status err small">{save.error.message}</span>}
          <span className="spacer" />
          <button className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" disabled={invalid || save.isPending} onClick={create}>
            {save.isPending ? 'Saving…' : editing ? 'Save' : 'Create alert'}
          </button>
        </>
      }
    >
      {a.kind !== 'drawing' && !editing && (
        <div className="segmented small kind-switch" role="group" aria-label="Alert type">
          {(
            [
              ['price', 'Price'],
              ['condition', 'Indicator'],
              ['scan', 'Daily scan'],
            ] as const
          ).map(([k, l]) => (
            <button key={k} className={a.kind === k ? 'active' : ''} onClick={() => switchKind(k)}>
              {l}
            </button>
          ))}
        </div>
      )}

      {(a.kind === 'price' || a.kind === 'drawing') && priceRow}

      {a.kind === 'condition' && (
        <div className="form-grid">
          <label>
            <span>{a.ticker} on</span>
            <select value={a.tf ?? '1D'} onChange={(e) => set({ tf: e.target.value })}>
              {TFS.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
        </div>
      )}
      {a.kind === 'scan' && scanCatalog && (
        <div className="form-grid">
          <label>
            <span>Stocks</span>
            <select value={a.config.universe} onChange={(e) => setConfig({ universe: e.target.value })}>
              {scanCatalog.universes.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Every day at (IST)</span>
            <input type="time" value={a.config.at ?? '15:45'} onChange={(e) => setConfig({ at: e.target.value })} />
          </label>
          <label>
            <span>Name</span>
            <input value={a.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Nifty 500 breakouts" />
          </label>
        </div>
      )}
      {(a.kind === 'condition' || a.kind === 'scan') && (
        <>
          <p className="note">
            {a.kind === 'condition'
              ? 'Alerts when all of these hold on a closed bar (never on a forming one).'
              : 'Runs after the close; tells you only the stocks that newly match.'}
          </p>
          <div className="alert-conditions">
            {conditions.map((c, i) => (
              <ConditionCard
                key={i}
                condition={c}
                onChange={(next) => setConfig({ conditions: conditions.map((x, j) => (j === i ? next : x)) })}
                onRemove={() => setConfig({ conditions: conditions.filter((_, j) => j !== i) })}
              />
            ))}
            <select
              className="add-condition"
              value=""
              aria-label="Add condition"
              onChange={(e) => {
                const def = CONDITION_DEFS[e.target.value]
                if (def) setConfig({ conditions: [...conditions, { type: e.target.value, params: { ...def.defaults } }] })
              }}
            >
              <option value="">+ Add condition (all must match)</option>
              {Object.entries(CONDITION_DEFS).map(([k, d]) => (
                <option key={k} value={k}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
        </>
      )}

      <div className="alert-notify">
        <span className="muted">Notify me in</span>
        {(['app', 'telegram', 'email'] as Channel[])
          .filter((ch) => channels[ch])
          .map((ch) => (
            <label key={ch} className="check">
              <input
                type="checkbox"
                checked={a.channels.includes(ch)}
                onChange={(e) => set({ channels: e.target.checked ? [...a.channels, ch] : a.channels.filter((c) => c !== ch) })}
              />
              {ch === 'app' ? 'App' : ch === 'telegram' ? 'Telegram' : 'Email'}
            </label>
          ))}
      </div>

      <button className="link-button more-toggle" onClick={() => setMore(!more)} aria-expanded={more}>
        {more ? '▾' : '▸'} More options
      </button>
      {more && (
        <div className="form-grid">
          <label>
            <span>Alert</span>
            <select value={a.frequency} onChange={(e) => set({ frequency: e.target.value as AlertIn['frequency'] })}>
              {FREQUENCIES.filter(([f]) => a.kind !== 'scan' || f !== 'once_per_bar').map(([f, l]) => (
                <option key={f} value={f}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Until (blank = no end)</span>
            <input
              type="date"
              value={a.expires?.slice(0, 10) ?? ''}
              onChange={(e) => set({ expires: e.target.value ? `${e.target.value}T23:59:59` : null })}
            />
          </label>
          <label>
            <span>Note</span>
            <input value={a.message} onChange={(e) => set({ message: e.target.value })} placeholder="Shown in the notification" />
          </label>
        </div>
      )}
    </Modal>
  )
}
