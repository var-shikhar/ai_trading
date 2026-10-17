import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api, type InstrumentHit, type Signal } from '../api/client'
import { useToasts } from '../state/ui'
import { Badge, Button, cx, EmptyState, ErrorText, IconButton, Segmented, SkeletonRows } from '../ui/kit'
import { kindOf } from '../symbols'

type Filter = 'new' | 'all'

const when = (iso: string) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.replace('T', ' ').slice(0, 16)
  const today = new Date().toDateString() === d.toDateString()
  return today
    ? d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
const tickerOf = (symbol: string) => symbol.split(':')[1]?.replace(/-[A-Z]+$/, '') ?? symbol
const SOURCE: Record<Signal['source'], string> = { alert: 'Alert', scanner: 'Scan', agent: 'Agent', manual: 'Manual' }
const DIR = {
  long: { icon: '▲', cls: 'bg-up-soft text-up', label: 'Long' },
  short: { icon: '▼', cls: 'bg-down-soft text-down', label: 'Short' },
  exit: { icon: '■', cls: 'bg-hover text-muted', label: 'Exit' },
  watch: { icon: '●', cls: 'bg-accent-soft text-accent', label: 'Watch' },
} as const

/** Signals from condition/scan alerts and (later) agents, newest first. */
export function SignalsList({ onOpen }: { onOpen: (s: InstrumentHit) => void }) {
  const qc = useQueryClient()
  const toast = useToasts((t) => t.push)
  const [filter, setFilter] = useState<Filter>('new')
  const key = ['signals', filter]
  const q = useQuery({
    queryKey: key,
    queryFn: () => api.signals(filter === 'new' ? { status: 'new' } : {}),
    refetchInterval: 60_000,
  })

  // Optimistic: the card updates (or leaves the "New" list) at once.
  const mark = useMutation({
    mutationFn: ({ s, status }: { s: Signal; status: Signal['status'] }) => api.updateSignal(s.id, status),
    onMutate: async ({ s, status }) => {
      await qc.cancelQueries({ queryKey: ['signals'] })
      const prev = qc.getQueriesData<Signal[]>({ queryKey: ['signals'] })
      for (const [k, list] of prev) {
        if (!list) continue
        const leaves = k[1] === 'new' && status !== 'new'
        qc.setQueryData<Signal[]>(k, list.flatMap((x) => (x.id !== s.id ? [x] : leaves ? [] : [{ ...x, status }])))
      }
      return { prev }
    },
    onError: (e, _v, ctx) => {
      ctx?.prev.forEach(([k, data]) => qc.setQueryData(k, data))
      toast(`Couldn’t update the signal: ${e.message}`, 'err')
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['signals'] }),
  })
  const setStatus = (s: Signal, status: Signal['status']) => mark.mutate({ s, status })

  const signals = q.data ?? []
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <Segmented<Filter>
          size="sm"
          value={filter}
          onChange={setFilter}
          options={[
            ['new', 'New'],
            ['all', 'All'],
          ]}
        />
        <span className="flex-1" />
        {q.data && <span className="text-[12px] text-muted tabular-nums">{signals.length}</span>}
        <IconButton label="Refresh" onClick={() => q.refetch()} disabled={q.isFetching}>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden className={cx(q.isFetching && 'animate-spin')}>
            <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3" />
          </svg>
        </IconButton>
      </div>

      {q.isPending ? (
        <SkeletonRows rows={5} />
      ) : q.error && !q.data ? (
        <div className="flex flex-col items-start gap-2 p-4">
          <ErrorText>{q.error.message}</ErrorText>
          <Button size="sm" onClick={() => q.refetch()}>
            Try again
          </Button>
        </div>
      ) : signals.length === 0 ? (
        <EmptyState
          title={filter === 'new' ? 'You’re all caught up' : 'No signals yet'}
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
              <path d="M4 12l5 5L20 6" />
            </svg>
          }
          action={
            filter === 'new' ? (
              <Button size="sm" variant="ghost" onClick={() => setFilter('all')}>
                Show all signals
              </Button>
            ) : undefined
          }
        >
          Indicator and scan alerts add a signal here each time they fire.
        </EmptyState>
      ) : (
        <ul className="flex flex-col">
          {signals.map((s) => (
            <SignalRow
              key={s.id}
              s={s}
              onOpen={() => {
                if (s.status === 'new') setStatus(s, 'seen')
                onOpen({ symbol: s.symbol, ticker: tickerOf(s.symbol), name: '', kind: kindOf(s.symbol) })
              }}
              onStatus={(status) => setStatus(s, status)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function SignalRow({ s, onOpen, onStatus }: { s: Signal; onOpen: () => void; onStatus: (status: Signal['status']) => void }) {
  const dir = DIR[s.direction] ?? DIR.watch
  const fresh = s.status === 'new'
  return (
    <li className={cx('group flex items-stretch border-b border-line transition-colors last:border-b-0 hover:bg-hover', !fresh && 'opacity-70')}>
      <button onClick={onOpen} className="flex min-w-0 flex-1 cursor-pointer items-start gap-3 px-3 py-3 text-left md:px-4">
        <span aria-label={dir.label} className={cx('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full text-[12px]', dir.cls)}>
          {dir.icon}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-1.5">
            {fresh && <span aria-label="New" className="size-1.5 shrink-0 rounded-full bg-accent" />}
            <b className="truncate text-[14px] font-semibold text-fg">{tickerOf(s.symbol)}</b>
            {s.tf && <span className="text-[12px] text-muted">{s.tf}</span>}
            {s.price !== null && (
              <span className="text-[12px] text-muted tabular-nums">· ₹{s.price.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
            )}
            <span className="ml-auto shrink-0 pl-2 text-[11px] text-muted tabular-nums">{when(s.created)}</span>
          </span>
          {s.reason && <span className="line-clamp-2 text-[13px] leading-snug text-muted">{s.reason}</span>}
          <span className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge tone={s.source === 'agent' ? 'accent' : 'neutral'}>{SOURCE[s.source] ?? s.source}</Badge>
            {s.confidence !== null && <Badge>{Math.round(s.confidence * 100)}% confidence</Badge>}
            {s.status === 'acted' && <Badge tone="up">Acted</Badge>}
            {s.status === 'dismissed' && <Badge>Dismissed</Badge>}
          </span>
        </span>
      </button>
      <span className="flex shrink-0 flex-col justify-center gap-1 pr-2 md:flex-row md:items-center md:opacity-60 md:group-hover:opacity-100">
        {s.status !== 'acted' && (
          <IconButton label="Acted on it" className="hover:text-up" onClick={() => onStatus('acted')}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
              <path d="M3 8.5l3.2 3L13 4.5" />
            </svg>
          </IconButton>
        )}
        {s.status !== 'dismissed' && (
          <IconButton label="Dismiss" className="hover:text-down" onClick={() => onStatus('dismissed')}>
            <svg width="16" height="16" viewBox="0 0 18 18" stroke="currentColor" strokeWidth="1.6" aria-hidden>
              <path d="M4.5 4.5l9 9M13.5 4.5l-9 9" />
            </svg>
          </IconButton>
        )}
      </span>
    </li>
  )
}
