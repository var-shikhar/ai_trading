import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type InstrumentHit } from '../api/client'
import { onAlertEvent } from '../live/liveClient'
import { useToasts } from '../state/ui'
import { kindOf } from '../symbols'
import { Button, cx, Dropdown, EmptyState, ErrorText, MenuItem, Modal, SkeletonRows, Switch, Tabs } from '../ui/kit'
import { AlertDialog } from './AlertDialog'
import { useAlertActions, useAlerts } from './queries'
import { PRICE_OPS, type Alert, type AlertIn } from './types'

const opName = Object.fromEntries(PRICE_OPS)
const inr = (v: number | undefined) => `₹${(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

/** The alert in plain words, e.g. "Crosses ₹2,950". */
function describe(a: Alert): string {
  const op = opName[a.config.op ?? ''] ?? a.config.op ?? ''
  if (a.kind === 'price') return a.config.op?.startsWith('change') ? op.replace('%', `${a.config.value}%`) : `${op} ${inr(a.config.value)}`
  if (a.kind === 'drawing') return `${op} your ${a.config.points?.length === 1 ? 'horizontal line' : 'trend line'}`
  const n = a.config.conditions?.length ?? 0
  const conds = `${n} condition${n === 1 ? '' : 's'}`
  if (a.kind === 'scan') return `${a.config.universe} · daily ${a.config.at} · ${conds}`
  return `${a.tf} bar close · ${conds}`
}

const REPEAT: Record<Alert['frequency'], string> = { once: 'Once', once_per_bar: 'Once per bar', every: 'Every time' }
const STATUS: Record<Alert['status'], { label: string; dot: string; icon: string }> = {
  active: { label: 'On', dot: 'bg-accent', icon: 'bg-accent-soft text-accent' },
  paused: { label: 'Paused', dot: 'bg-muted', icon: 'bg-hover text-muted' },
  triggered: { label: 'Fired', dot: 'bg-star', icon: 'bg-[rgba(245,165,36,0.15)] text-star' },
  expired: { label: 'Expired', dot: 'bg-muted', icon: 'bg-hover text-muted' },
}

function ago(t: number): string {
  const now = Math.floor(Date.now() / 1000) + 19800 // event times are IST wall time as epoch
  const s = Math.max(0, now - t)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  const iso = new Date(t * 1000).toISOString()
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)} ${iso.slice(11, 16)}`
}

const Bell = ({ className }: { className?: string }) => (
  <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className={className} aria-hidden>
    <path d="M6 14V9a4 4 0 0 1 8 0v5l1.5 1.5h-11zM8.5 17.5h3" />
  </svg>
)

/** Alerts side panel: your alerts and what fired. */
export function AlertsPanel({
  symbol,
  createRequest,
  onCreateHandled,
  onOpen,
}: {
  symbol: InstrumentHit
  /** A pre-filled alert to create (the chart's "+" or a drawn line's bell). */
  createRequest: Partial<AlertIn> | null
  onCreateHandled: () => void
  onOpen: (s: InstrumentHit) => void
}) {
  const qc = useQueryClient()
  const alerts = useAlerts()
  const history = useQuery({ queryKey: ['alerts', 'events'], queryFn: api.alertEvents, refetchInterval: 60_000 })
  const actions = useAlertActions()
  const push = useToasts((s) => s.push)
  const [tab, setTab] = useState<'alerts' | 'history'>('alerts')
  const [dialog, setDialog] = useState<{ initial?: Partial<AlertIn>; editing?: Alert } | null>(null)
  const [deleting, setDeleting] = useState<Alert | null>(null)

  // A fired alert changes its status and the history.
  useEffect(() => onAlertEvent(() => void qc.invalidateQueries({ queryKey: ['alerts'] })), [qc])

  // A request from the chart opens the dialog until it's closed.
  const shownDialog = dialog ?? (createRequest ? { initial: createRequest } : null)
  const closeDialog = () => {
    setDialog(null)
    if (createRequest) onCreateHandled()
  }

  const data = alerts.data
  const list = data?.alerts ?? []
  const paused = data && data.engine !== 'running' && data.engine !== 'starting'
  const on = list.filter((a) => a.status === 'active').length
  const open = (a: Alert) =>
    a.symbol &&
    onOpen({
      symbol: a.symbol,
      ticker: a.ticker ?? a.symbol,
      name: '',
      kind: kindOf(a.symbol),
    })

  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-label="Alerts">
      <div className="flex shrink-0 items-center gap-2 border-b border-line pr-3">
        <Tabs
          className="min-w-0 flex-1 px-1"
          value={tab}
          onChange={setTab}
          items={[
            { id: 'alerts', label: 'Alerts', badge: data ? on : undefined },
            { id: 'history', label: 'History' },
          ]}
        />
        <Button variant="primary" size="sm" onClick={() => setDialog({})}>
          + New
        </Button>
      </div>
      {paused && (
        <p className="m-3 rounded-lg bg-[rgba(245,165,36,0.12)] px-3 py-2 text-[12px] text-fg">
          Alerts are paused: Fyers isn't connected. They resume on their own once it is.
        </p>
      )}
      <ErrorText className="m-3">{(alerts.error ?? actions.error)?.message}</ErrorText>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'alerts' && (
          <>
            {alerts.isPending && <SkeletonRows rows={5} />}
            {data && list.length === 0 && (
              <EmptyState
                icon={<Bell />}
                title="No alerts yet"
                action={
                  <Button variant="primary" onClick={() => setDialog({})}>
                    Create an alert
                  </Button>
                }
              >
                Get notified when a price is reached. You can also hover the chart and tap the <b>+</b> at the crosshair, or draw a
                line and tap its bell.
              </EmptyState>
            )}
            <ul className="flex flex-col gap-2 p-3">
              {list.map((a, i) => {
                const st = STATUS[a.status]
                return (
                  <li
                    key={a.id}
                    className={cx(
                      'flex items-center gap-3 rounded-xl border border-line bg-surface p-3 shadow-card transition',
                      a.status !== 'active' && 'opacity-70',
                    )}
                  >
                    <span className={cx('flex size-10 shrink-0 items-center justify-center rounded-full', st.icon)}>
                      <Bell />
                    </span>
                    <button className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left" onClick={() => open(a)}>
                      <span className="flex items-center gap-2">
                        <b className="truncate text-[14px] font-semibold text-fg">{a.kind === 'scan' ? a.name || 'Daily scan' : a.ticker}</b>
                        <span className="inline-flex items-center gap-1 text-[11px] text-muted">
                          <span className={cx('size-1.5 rounded-full', st.dot)} />
                          {st.label}
                        </span>
                      </span>
                      <span className="truncate text-[13px] text-fg">{describe(a)}</span>
                      <span className="text-[11px] text-muted">
                        {REPEAT[a.frequency]}
                        {a.fire_count > 0 && ` · fired ${a.fire_count}×`}
                        {a.channels.length > 0 && ` · ${a.channels.map((c) => (c === 'app' ? 'App' : c === 'telegram' ? 'Telegram' : 'Email')).join(', ')}`}
                      </span>
                    </button>
                    <Switch
                      checked={a.status === 'active'}
                      onChange={(v) => actions.setStatus.mutate({ a, status: v ? 'active' : 'paused' })}
                    />
                    {/* The last rows open their menu upwards, so it stays inside the list. */}
                    <Dropdown align={i >= 2 && i >= list.length - 2 ? 'up' : 'right'} caret={false} title="More" label={<span className="text-[18px] leading-none text-muted">⋯</span>}>
                      {(close) => (
                        <>
                          <MenuItem onClick={() => (close(), setDialog({ editing: a }))}>Edit</MenuItem>
                          <MenuItem danger onClick={() => (close(), setDeleting(a))}>
                            Delete
                          </MenuItem>
                        </>
                      )}
                    </Dropdown>
                  </li>
                )
              })}
            </ul>
            {data && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pb-4 text-[12px] text-muted">
                <button
                  className="font-medium text-accent"
                  onClick={async () => {
                    try {
                      const r = await api.testAlert()
                      push(Object.entries(r).map(([k, v]) => `${k}: ${v}`).join(' · '), 'info')
                    } catch (e) {
                      push((e as Error).message, 'err')
                    }
                  }}
                >
                  Send a test notification
                </button>
                {!data.channels.telegram && !data.channels.email && <span>Add Telegram or email in Profile &amp; notifications.</span>}
              </div>
            )}
          </>
        )}

        {tab === 'history' && (
          <>
            {history.isPending && <SkeletonRows rows={5} />}
            {history.data?.length === 0 && <EmptyState icon={<Bell />} title="Nothing has fired yet" />}
            <ol className="relative flex flex-col gap-4 px-4 py-4">
              {history.data?.map((e) => (
                <li key={e.id} className="relative flex gap-3">
                  <span className="mt-1.5 size-2 shrink-0 rounded-full bg-accent" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <b className="truncate text-[13px] font-semibold text-fg">{e.title}</b>
                      <span className="shrink-0 text-[11px] text-muted">{ago(e.time)}</span>
                    </div>
                    <p className="mt-0.5 text-[12px] break-words whitespace-pre-line text-muted">{e.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>

      {shownDialog && (
        <AlertDialog
          // A new request (another "+" on the chart) starts a fresh form.
          key={JSON.stringify(shownDialog.initial ?? shownDialog.editing?.id ?? 'new')}
          symbol={symbol}
          initial={shownDialog.initial}
          editing={shownDialog.editing}
          // In-app works even before (or without) the alert list loading.
          channels={data?.channels ?? { app: true, telegram: false, email: false }}
          onClose={closeDialog}
        />
      )}
      {deleting && (
        <Modal
          title="Delete alert?"
          width={380}
          onClose={() => setDeleting(null)}
          footer={
            <>
              <span className="flex-1" />
              <Button variant="ghost" onClick={() => setDeleting(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  actions.remove.mutate(deleting)
                  setDeleting(null)
                }}
              >
                Delete
              </Button>
            </>
          }
        >
          <p className="text-[14px] text-fg">
            {deleting.kind === 'scan' ? deleting.name || 'Daily scan' : deleting.ticker}: {describe(deleting)}
          </p>
        </Modal>
      )}
    </div>
  )
}
