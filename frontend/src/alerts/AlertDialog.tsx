import { useEffect, useState } from 'react'
import { api, type InstrumentHit } from '../api/client'
import { ConditionCard } from '../scanner/ScannerPanel'
import { CONDITION_DEFS, type ScanCatalog } from '../scanner/types'
import { Modal } from '../ui/Modal'
import { FREQUENCIES, PRICE_OPS, toInput, type Alert, type AlertIn, type Channel } from './types'

const TFS = ['5m', '15m', '30m', '1h', '2h', '4h', '1D', '1W']

/** Create or edit an alert. `initial` pre-fills it (e.g. from a drawing). */
export function AlertDialog({
  symbol,
  initial,
  editing,
  channels,
  onSaved,
  onClose,
}: {
  symbol: InstrumentHit
  initial?: Partial<AlertIn>
  editing?: Alert | null
  channels: Record<Channel, boolean>
  onSaved: () => void
  onClose: () => void
}) {
  const [a, setA] = useState<AlertIn>(() => ({
    kind: 'price',
    symbol: symbol.symbol,
    ticker: symbol.ticker,
    name: '',
    config: { op: 'crosses_above', value: 0 },
    tf: '1D',
    frequency: 'once',
    channels: ['app', ...(channels.telegram ? (['telegram'] as Channel[]) : [])],
    message: '',
    expires: null,
    ...initial,
    ...(editing ? toInput(editing) : {}),
  }))
  const [scanCatalog, setScanCatalog] = useState<ScanCatalog | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Prefill a new price alert with the current price.
  useEffect(() => {
    if (editing || a.kind !== 'price' || a.config.value) return
    api.quotes([a.symbol!]).then((q) => {
      const ltp = q[a.symbol!]?.ltp
      if (ltp) setA((x) => ({ ...x, config: { ...x.config, value: Math.round(ltp * 100) / 100 } }))
    }, () => {})
    // only for the first render of a new alert
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (a.kind === 'scan' || a.kind === 'condition') api.scannerCatalog().then(setScanCatalog, () => {})
  }, [a.kind])

  const set = (patch: Partial<AlertIn>) => setA((x) => ({ ...x, ...patch }))
  const setConfig = (patch: Partial<AlertIn['config']>) => setA((x) => ({ ...x, config: { ...x.config, ...patch } }))

  const switchKind = (kind: AlertIn['kind']) => {
    if (kind === a.kind) return
    if (kind === 'price') set({ kind, config: { op: 'crosses_above', value: 0 }, symbol: symbol.symbol, ticker: symbol.ticker })
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

  const save = async () => {
    setError(null)
    try {
      const body: AlertIn = { ...a, status: 'active' }
      if (editing) await api.updateAlert(editing.id, body)
      else await api.createAlert(body)
      onSaved()
      onClose()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const conditions = a.config.conditions ?? []
  const conditionEditor = (
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
  )

  return (
    <Modal
      title={editing ? 'Edit alert' : a.kind === 'drawing' ? 'Alert on drawing' : `Create alert`}
      onClose={onClose}
      width={520}
      footer={
        <>
          {error && <span className="status err small">{error}</span>}
          <span className="spacer" />
          <button className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" onClick={save}>
            {editing ? 'Save' : 'Create'}
          </button>
        </>
      }
    >
      {a.kind !== 'drawing' && !editing && (
        <div className="segmented small kind-switch" role="group" aria-label="Alert type">
          {(
            [
              ['price', 'Price'],
              ['condition', 'Indicator / pattern'],
              ['scan', 'Scan'],
            ] as const
          ).map(([k, l]) => (
            <button key={k} className={a.kind === k ? 'active' : ''} onClick={() => switchKind(k)}>
              {l}
            </button>
          ))}
        </div>
      )}

      <div className="form-grid">
        {a.kind !== 'scan' && (
          <label>
            <span>Symbol</span>
            <b>{a.ticker}</b>
          </label>
        )}

        {(a.kind === 'price' || a.kind === 'drawing') && (
          <label>
            <span>Condition</span>
            <span className="inline-fields">
              <select value={a.config.op} onChange={(e) => setConfig({ op: e.target.value })}>
                {PRICE_OPS.filter(([op]) => a.kind === 'price' || !op.startsWith('change')).map(([op, l]) => (
                  <option key={op} value={op}>
                    {l}
                  </option>
                ))}
              </select>
              {a.kind === 'price' ? (
                <input
                  type="number"
                  step="0.05"
                  value={a.config.value ?? 0}
                  onChange={(e) => setConfig({ value: Number(e.target.value) })}
                  aria-label={a.config.op?.startsWith('change') ? 'Percent' : 'Price'}
                />
              ) : (
                <span className="muted">{a.config.points?.length === 1 ? 'the horizontal line' : 'the trend line (extended)'}</span>
              )}
            </span>
          </label>
        )}

        {a.kind === 'condition' && (
          <label>
            <span>Timeframe</span>
            <select value={a.tf ?? '1D'} onChange={(e) => set({ tf: e.target.value })}>
              {TFS.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
        )}

        {a.kind === 'scan' && scanCatalog && (
          <>
            <label>
              <span>Name</span>
              <input value={a.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Nifty 500 breakouts" />
            </label>
            <label>
              <span>Symbols</span>
              <select value={a.config.universe} onChange={(e) => setConfig({ universe: e.target.value })}>
                {scanCatalog.universes.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Run daily at (IST)</span>
              <input type="time" value={a.config.at ?? '15:45'} onChange={(e) => setConfig({ at: e.target.value })} />
            </label>
          </>
        )}
      </div>
      {(a.kind === 'condition' || a.kind === 'scan') && (
        <>
          <p className="note">
            {a.kind === 'condition'
              ? 'Checked when each bar closes (never on a forming bar).'
              : 'Runs on daily bars after the close; notifies only symbols that newly match.'}
          </p>
          {conditionEditor}
        </>
      )}

      <div className="form-grid">
        <label>
          <span>Trigger</span>
          <select value={a.frequency} onChange={(e) => set({ frequency: e.target.value as AlertIn['frequency'] })}>
            {FREQUENCIES.filter(([f]) => a.kind !== 'scan' || f !== 'once_per_bar').map(([f, l]) => (
              <option key={f} value={f}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Expires</span>
          <input
            type="date"
            value={a.expires?.slice(0, 10) ?? ''}
            onChange={(e) => set({ expires: e.target.value ? `${e.target.value}T23:59:59` : null })}
          />
        </label>
        <label>
          <span>Notify via</span>
          <span className="inline-fields">
            {(['app', 'telegram', 'email'] as Channel[]).map((ch) => (
              <label key={ch} className="check" title={channels[ch] ? '' : 'Not configured in backend/.env'}>
                <input
                  type="checkbox"
                  disabled={!channels[ch]}
                  checked={a.channels.includes(ch)}
                  onChange={(e) =>
                    set({ channels: e.target.checked ? [...a.channels, ch] : a.channels.filter((c) => c !== ch) })
                  }
                />
                {ch === 'app' ? 'App' : ch === 'telegram' ? 'Telegram' : 'Email'}
              </label>
            ))}
          </span>
        </label>
        <label>
          <span>Message</span>
          <input value={a.message} onChange={(e) => set({ message: e.target.value })} placeholder="Optional note" />
        </label>
      </div>
    </Modal>
  )
}
