import { useCallback, useEffect, useState } from 'react'
import { api, type InstrumentHit } from '../api/client'
import { onAlertEvent } from '../live/liveClient'
import { AlertDialog } from './AlertDialog'
import { SignalsList } from './SignalsList'
import { PRICE_OPS, toInput, type Alert, type AlertEvent, type AlertIn, type AlertList } from './types'

const opName = Object.fromEntries(PRICE_OPS)

function describe(a: Alert): string {
  if (a.kind === 'price') {
    const pct = a.config.op?.startsWith('change')
    return `${opName[a.config.op ?? ''] ?? a.config.op} ${pct ? `${a.config.value}%` : a.config.value?.toLocaleString('en-IN')}`
  }
  if (a.kind === 'drawing') return `${opName[a.config.op ?? ''] ?? a.config.op} ${a.config.points?.length === 1 ? 'horizontal line' : 'trend line'}`
  const n = a.config.conditions?.length ?? 0
  if (a.kind === 'scan') return `${a.config.universe} daily at ${a.config.at} · ${n} condition${n === 1 ? '' : 's'}`
  return `${a.tf} · ${n} condition${n === 1 ? '' : 's'}`
}

const when = (t: number) => {
  const iso = new Date(t * 1000).toISOString()
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`
}

/** Alerts side panel: list, log, create, pause/resume, test notifications. */
export function AlertsPanel({
  symbol,
  createRequest,
  onCreateHandled,
  onOpen,
}: {
  symbol: InstrumentHit
  /** A pre-filled alert to create (e.g. from a drawing's Alert button). */
  createRequest: Partial<AlertIn> | null
  onCreateHandled: () => void
  onOpen: (s: InstrumentHit) => void
}) {
  const [data, setData] = useState<AlertList | null>(null)
  const [events, setEvents] = useState<AlertEvent[]>([])
  const [tab, setTab] = useState<'alerts' | 'signals' | 'log'>('alerts')
  const [dialog, setDialog] = useState<{ initial?: Partial<AlertIn>; editing?: Alert } | null>(null)
  const [testResult, setTestResult] = useState<string | null>(null)

  const reload = useCallback(() => {
    api.alerts().then(setData, () => {})
    api.alertEvents().then(setEvents, () => {})
  }, [])
  useEffect(() => {
    reload()
    const id = setInterval(reload, 30000) // engine status and fired counts
    const off = onAlertEvent(() => reload())
    return () => {
      clearInterval(id)
      off()
    }
  }, [reload])

  useEffect(() => {
    if (createRequest) {
      setDialog({ initial: createRequest })
      onCreateHandled()
    }
  }, [createRequest, onCreateHandled])

  const toggle = async (a: Alert) => {
    await api.updateAlert(a.id, toInput(a, a.status === 'active' ? 'paused' : 'active'))
    reload()
  }
  const remove = async (a: Alert) => {
    await api.deleteAlert(a.id)
    reload()
  }

  const paused = data && data.engine !== 'running' && data.engine !== 'starting'
  return (
    <aside className="pattern-panel alerts-panel" aria-label="Alerts">
      <div className="watch-head">
        <b>Alerts</b>
        <span className="spacer" />
        <button className="primary-button small" onClick={() => setDialog({})}>
          + Alert
        </button>
      </div>
      {paused && <p className="banner">Alerts paused: {data!.engine.replace('paused: ', '')}. Connect Fyers to resume.</p>}
      <div className="tabs" role="tablist">
        <button role="tab" className={tab === 'alerts' ? 'active' : ''} onClick={() => setTab('alerts')}>
          Alerts {data ? `(${data.alerts.filter((a) => a.status === 'active').length} active)` : ''}
        </button>
        <button role="tab" className={tab === 'signals' ? 'active' : ''} onClick={() => setTab('signals')}>
          Signals
        </button>
        <button role="tab" className={tab === 'log' ? 'active' : ''} onClick={() => setTab('log')}>
          Log
        </button>
      </div>
      <div className="panel-body">
        {tab === 'alerts' && data && (
          <>
            {data.alerts.length === 0 && <p className="status">No alerts yet. Create one with “+ Alert”, or select a line you drew and click its bell.</p>}
            <ul className="alert-list">
              {data.alerts.map((a) => (
                <li key={a.id} className={`alert-item ${a.status}`}>
                  <button
                    className="alert-main"
                    onClick={() =>
                      a.symbol && onOpen({ symbol: a.symbol, ticker: a.ticker ?? a.symbol, name: '', kind: a.symbol.startsWith('MCX:') ? 'COM' : 'EQ' })
                    }
                  >
                    <b>{a.kind === 'scan' ? a.name || 'Scan' : a.ticker}</b>
                    <span className="muted">{describe(a)}</span>
                    <span className="alert-meta">
                      <em className={`badge ${a.status === 'active' ? 'confirmed' : a.status === 'triggered' ? 'forming' : ''}`}>{a.status}</em>
                      {a.fire_count > 0 && <span className="muted"> fired {a.fire_count}×</span>}
                    </span>
                  </button>
                  <span className="alert-actions">
                    <button title="Edit" onClick={() => setDialog({ editing: a })}>
                      ✎
                    </button>
                    <button title={a.status === 'active' ? 'Pause' : 'Resume'} onClick={() => toggle(a)}>
                      {a.status === 'active' ? '❚❚' : '▶'}
                    </button>
                    <button title="Delete" onClick={() => remove(a)}>
                      ×
                    </button>
                  </span>
                </li>
              ))}
            </ul>
            <div className="scan-actions">
              <button
                className="link-button"
                onClick={async () => {
                  const r = await api.testAlert()
                  setTestResult(Object.entries(r).map(([k, v]) => `${k}: ${v}`).join(' · '))
                }}
              >
                Send test notification
              </button>
              {testResult && <span className="status small">{testResult}</span>}
            </div>
            <p className="note pad">
              Telegram: {data.channels.telegram ? 'on' : 'not set up'} · Email: {data.channels.email ? 'on' : 'not set up'}{' '}
              (configure in backend/.env).
            </p>
          </>
        )}
        {tab === 'signals' && <SignalsList onOpen={onOpen} />}
        {tab === 'log' && (
          <ul className="hit-list">
            {events.length === 0 && <p className="status">Nothing has fired yet.</p>}
            {events.map((e) => (
              <li key={e.id} className="event-row">
                <b>{e.title}</b>
                <span className="muted">{when(e.time)}</span>
                <span className="event-body">{e.body}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {dialog && data && (
        <AlertDialog
          symbol={symbol}
          initial={dialog.initial}
          editing={dialog.editing}
          channels={data.channels}
          onSaved={reload}
          onClose={() => setDialog(null)}
        />
      )}
    </aside>
  )
}
