import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type InstrumentHit } from '../api/client'
import { onAlertEvent } from '../live/liveClient'
import { AlertDialog } from './AlertDialog'
import { useAlertActions, useAlerts } from './queries'
import { PRICE_OPS, type Alert, type AlertIn } from './types'

const opName = Object.fromEntries(PRICE_OPS)
const inr = (v: number | undefined) => `₹${(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

/** One line in plain words, e.g. "crosses ₹2,950" or "1D · RSI conditions". */
function describe(a: Alert): string {
  const op = (opName[a.config.op ?? ''] ?? a.config.op ?? '').toLowerCase()
  if (a.kind === 'price') return a.config.op?.startsWith('change') ? `${op.replace('%', `${a.config.value}%`)}` : `${op} ${inr(a.config.value)}`
  if (a.kind === 'drawing') return `${op} your ${a.config.points?.length === 1 ? 'horizontal line' : 'trend line'}`
  const n = a.config.conditions?.length ?? 0
  const conds = `${n} condition${n === 1 ? '' : 's'}`
  if (a.kind === 'scan') return `${a.config.universe} · daily at ${a.config.at} · ${conds}`
  return `${a.tf} bar close · ${conds}`
}

const STATUS_LABEL: Record<Alert['status'], string> = {
  active: 'Active',
  paused: 'Paused',
  triggered: 'Fired',
  expired: 'Expired',
}

const when = (t: number) => {
  const iso = new Date(t * 1000).toISOString() // IST wall time as epoch
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)} ${iso.slice(11, 16)}`
}

/** Alerts side panel: your alerts and what fired. */
export function AlertsPanel({
  symbol,
  createRequest,
  onCreateHandled,
  onOpen,
}: {
  symbol: InstrumentHit
  /** A pre-filled alert to create (from the chart's "Alert at price" or a drawn line's bell). */
  createRequest: Partial<AlertIn> | null
  onCreateHandled: () => void
  onOpen: (s: InstrumentHit) => void
}) {
  const qc = useQueryClient()
  const alerts = useAlerts()
  const history = useQuery({ queryKey: ['alerts', 'events'], queryFn: api.alertEvents, refetchInterval: 60_000 })
  const actions = useAlertActions()
  const [tab, setTab] = useState<'alerts' | 'history'>('alerts')
  const [dialog, setDialog] = useState<{ initial?: Partial<AlertIn>; editing?: Alert } | null>(null)
  const [testResult, setTestResult] = useState<string | null>(null)

  // A fired alert changes its status and the history.
  useEffect(() => onAlertEvent(() => qc.invalidateQueries({ queryKey: ['alerts'] })), [qc])

  useEffect(() => {
    if (createRequest) {
      setDialog({ initial: createRequest })
      onCreateHandled()
    }
  }, [createRequest, onCreateHandled])

  const data = alerts.data
  const list = data?.alerts ?? []
  const paused = data && data.engine !== 'running' && data.engine !== 'starting'
  const active = list.filter((a) => a.status === 'active').length

  return (
    <aside className="pattern-panel alerts-panel" aria-label="Alerts">
      <div className="watch-head">
        <div className="tabs inline" role="tablist">
          <button role="tab" className={tab === 'alerts' ? 'active' : ''} onClick={() => setTab('alerts')}>
            Alerts{data ? ` (${active} on)` : ''}
          </button>
          <button role="tab" className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>
            History
          </button>
        </div>
        <span className="spacer" />
        <button className="add-button" onClick={() => setDialog({})}>
          + New alert
        </button>
      </div>
      {paused && <p className="banner">Alerts are paused: Fyers is not connected. They resume once it is.</p>}
      {(alerts.error || actions.error) && <p className="status err pad">{(alerts.error ?? actions.error)?.message}</p>}

      <div className="panel-body">
        {tab === 'alerts' && data && (
          <>
            {list.length === 0 && (
              <div className="empty-state">
                <p>No alerts yet. Three ways to make one:</p>
                <p className="note">
                  • <b>+ New alert</b> above (price, indicator or a daily scan)
                  <br />• On the chart: <b>right-click</b> (or <b>long-press</b> on a phone) at a price → <i>Alert at this price</i>
                  <br />• Draw a line, select it and tap its <b>bell</b>
                </p>
              </div>
            )}
            <ul className="alert-list">
              {list.map((a) => (
                <li key={a.id} className={`alert-item ${a.status}`}>
                  <button
                    className="alert-main"
                    onClick={() =>
                      a.symbol &&
                      onOpen({
                        symbol: a.symbol,
                        ticker: a.ticker ?? a.symbol,
                        name: '',
                        kind: a.symbol.startsWith('MCX:') ? 'COM' : a.symbol.endsWith('-INDEX') ? 'INDEX' : 'EQ',
                      })
                    }
                  >
                    <b>{a.kind === 'scan' ? a.name || 'Daily scan' : a.ticker}</b>
                    <span className="muted">{describe(a)}</span>
                    <span className="alert-meta">
                      <em className={`badge ${a.status === 'active' ? 'confirmed' : a.status === 'triggered' ? 'forming' : ''}`}>
                        {STATUS_LABEL[a.status]}
                      </em>
                      {a.fire_count > 0 && <span className="muted"> · fired {a.fire_count}×</span>}
                    </span>
                  </button>
                  <span className="alert-actions">
                    <button title="Edit" onClick={() => setDialog({ editing: a })}>
                      ✎
                    </button>
                    <button
                      title={a.status === 'active' ? 'Pause' : 'Turn on again'}
                      onClick={() => actions.setStatus.mutate({ a, status: a.status === 'active' ? 'paused' : 'active' })}
                    >
                      {a.status === 'active' ? '❚❚' : '▶'}
                    </button>
                    <button title="Delete" onClick={() => window.confirm(`Delete this alert on ${a.ticker ?? a.name}?`) && actions.remove.mutate(a)}>
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
                Send a test notification
              </button>
              {testResult && <span className="status small">{testResult}</span>}
            </div>
            {!data.channels.telegram && !data.channels.email && (
              <p className="note pad">Only in-app notifications: add Telegram or email in Me → Profile &amp; notifications.</p>
            )}
          </>
        )}
        {tab === 'history' && (
          <ul className="hit-list">
            {history.data?.length === 0 && <p className="status pad">Nothing has fired yet.</p>}
            {history.data?.map((e) => (
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
          onClose={() => setDialog(null)}
        />
      )}
    </aside>
  )
}
