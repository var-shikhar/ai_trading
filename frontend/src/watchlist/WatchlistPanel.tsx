import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import type { InstrumentHit, Watchlist, WatchItem } from '../api/client'
import { useLiveStatus, useTicks, type LiveStatus } from '../live/liveClient'
import { SymbolDialog } from '../ui/TopBar'
import { Button, cx, Dropdown, EmptyState, ErrorText, IconButton, Input, MenuHeading, MenuItem, Modal, Skeleton } from '../ui/kit'
import { priceOf, useActiveWatchlist, usePriceFlash, useQuotes, useWatchlistActions, type Price } from './queries'

/** TradingView-style watchlist: several named lists, live prices, click to
 * open in the active chart. */
export function WatchlistPanel({
  current,
  activeSymbol,
  onOpen,
}: {
  current: InstrumentHit
  activeSymbol: string
  onOpen: (s: InstrumentHit) => void
}) {
  const { lists, list, setActiveId, isPending, error: loadError, refetch } = useActiveWatchlist(current)
  const actions = useWatchlistActions()
  const [adding, setAdding] = useState(false)
  const [dialog, setDialog] = useState<ListDialogState>(null)
  const live = useLiveStatus()

  const symbols = useMemo(() => list?.items.map((i) => i.symbol) ?? [], [list])
  const ticks = useTicks(symbols)
  const quotesQuery = useQuotes(symbols)
  const quotes = quotesQuery.data ?? {}

  const inList = list?.items.some((i) => i.symbol === current.symbol) ?? false

  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-label="Watchlist">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-line px-2">
        <Dropdown
          className="min-w-0"
          buttonClassName="min-w-0 font-semibold"
          title="Choose watchlist"
          label={
            isPending ? (
              <Skeleton className="h-4 w-24" />
            ) : (
              <span className="truncate">{list?.name ?? 'Watchlist'}</span>
            )
          }
        >
          {(close) => (
            <>
              {(lists ?? []).length > 0 && <MenuHeading>Lists</MenuHeading>}
              {(lists ?? []).map((l) => (
                <MenuItem
                  key={l.id}
                  selected={l.id === list?.id}
                  onClick={() => {
                    setActiveId(l.id)
                    close()
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">{l.name}</span>
                  <span className="text-[12px] text-muted tabular-nums">{l.items.length}</span>
                </MenuItem>
              ))}
              {!inList && list && (
                <>
                  <MenuHeading>Chart</MenuHeading>
                  <MenuItem onClick={() => (close(), actions.add(list.id, current))}>
                    <PlusIcon />
                    <span className="truncate">Add {current.ticker} (on the chart)</span>
                  </MenuItem>
                </>
              )}
              <MenuHeading>List</MenuHeading>
              <MenuItem onClick={() => (close(), setDialog({ kind: 'new' }))}>New list…</MenuItem>
              {list && (
                <>
                  <MenuItem onClick={() => (close(), setDialog({ kind: 'rename', list }))}>Rename…</MenuItem>
                  <MenuItem danger onClick={() => (close(), setDialog({ kind: 'delete', list }))}>
                    Delete list
                  </MenuItem>
                </>
              )}
            </>
          )}
        </Dropdown>
        {list && <span className="shrink-0 text-[12px] text-muted tabular-nums">{list.items.length}</span>}
        <span className="flex-1" />
        <LiveDot status={live.status} message={live.message} />
        <Button size="sm" variant="soft" disabled={!list} title="Search and add stocks to this list" onClick={() => setAdding(true)}>
          <PlusIcon />
          Add
        </Button>
      </div>

      <div className={cx(GRID, 'h-7 shrink-0 border-b border-line text-[11px] font-medium tracking-wide text-muted uppercase')}>
        <span>Symbol</span>
        <span className="text-right">Last</span>
        <span className="text-right">Chg</span>
        <span className="text-right">Chg%</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {loadError && (
          <ErrorText className="m-2">
            {loadError.message}{' '}
            <button className="font-semibold underline" onClick={() => void refetch()}>
              Retry
            </button>
          </ErrorText>
        )}
        {isPending && <RowSkeletons />}
        {!isPending && !list && !loadError && (
          <EmptyState
            title="No watchlists"
            action={
              <Button variant="primary" onClick={() => setDialog({ kind: 'new' })}>
                New list
              </Button>
            }
          >
            Make a list to follow prices here.
          </EmptyState>
        )}
        {list && list.items.length === 0 && (
          <EmptyState
            icon={<ListIcon />}
            title={`${list.name} is empty`}
            action={
              <Button variant="primary" onClick={() => setAdding(true)}>
                <PlusIcon />
                Add stocks
              </Button>
            }
          >
            Add stocks, indices or futures to follow their live prices.
          </EmptyState>
        )}
        <ul>
          {list?.items.map((item, i) => (
            <WatchRow
              key={item.symbol}
              item={item}
              price={priceOf(ticks[item.symbol], quotes[item.symbol])}
              priceLoading={quotesQuery.isFetching && quotes[item.symbol] === undefined}
              active={item.symbol === activeSymbol}
              first={i === 0}
              last={i === list.items.length - 1}
              onOpen={() => onOpen({ ...item, exchange: item.exchange ?? undefined })}
              onRemove={() => actions.removeItem(list.id, item.symbol)}
              onMove={(d) => actions.move(list.id, item.symbol, d)}
            />
          ))}
        </ul>
      </div>

      {adding && list && (
        <SymbolDialog
          title={`Add to ${list.name}`}
          isAdded={(symbol) => list.items.some((i) => i.symbol === symbol)}
          onPick={(s) => actions.toggle(list.id, s)}
          onClose={() => setAdding(false)}
        />
      )}
      <ListDialog state={dialog} lists={lists ?? []} setActiveId={setActiveId} onClose={() => setDialog(null)} />
    </div>
  )
}

const GRID = 'grid grid-cols-[minmax(0,1fr)_76px_58px_62px] items-center gap-x-1 px-3'

const fmt = (v: number, digits = 2) => v.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })
const signed = (v: number, suffix = '') => `${v >= 0 ? '+' : ''}${fmt(v)}${suffix}`

function RowSkeletons({ rows = 8 }: { rows?: number }) {
  return (
    <div aria-busy>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={cx(GRID, 'h-10 border-b border-line')}>
          <span className="flex flex-col gap-1">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-2 w-8" />
          </span>
          <Skeleton className="ml-auto h-3 w-14" />
          <Skeleton className="ml-auto h-3 w-10" />
          <Skeleton className="ml-auto h-3 w-11" />
        </div>
      ))}
    </div>
  )
}

function WatchRow({
  item,
  price,
  priceLoading,
  active,
  first,
  last,
  onOpen,
  onRemove,
  onMove,
}: {
  item: WatchItem
  price: Price | null
  priceLoading: boolean
  active: boolean
  first: boolean
  last: boolean
  onOpen: () => void
  onRemove: () => void
  onMove: (delta: number) => void
}) {
  const flash = usePriceFlash(price?.ltp)
  const tone = price?.ch == null ? 'text-muted' : price.ch >= 0 ? 'text-up' : 'text-down'
  return (
    <li
      className={cx(
        'group relative border-b border-line transition-colors duration-500',
        flash === 'up' ? 'bg-up-soft' : flash === 'down' ? 'bg-down-soft' : active ? 'bg-selected' : 'hover:bg-hover',
      )}
    >
      {active && <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-accent" />}
      <button onClick={onOpen} title={item.name} className={cx(GRID, 'h-10 w-full text-left text-[13px] tabular-nums')}>
        <span className="flex min-w-0 flex-col leading-tight">
          <b className="truncate font-semibold text-fg">{item.ticker}</b>
          <span className="truncate text-[10px] text-muted">{item.exchange ?? item.symbol.split(':')[0]}</span>
        </span>
        {price ? (
          <>
            <span className="text-right font-medium text-fg">{fmt(price.ltp)}</span>
            <span className={cx('text-right', tone)}>{price.ch != null ? signed(price.ch) : ''}</span>
            <span className={cx('text-right', tone)}>{price.chp != null ? signed(price.chp, '%') : ''}</span>
          </>
        ) : priceLoading ? (
          <>
            <Skeleton className="ml-auto h-3 w-14" />
            <Skeleton className="ml-auto h-3 w-10" />
            <Skeleton className="ml-auto h-3 w-11" />
          </>
        ) : (
          <span className="col-span-3 text-right text-muted">–</span>
        )}
      </button>
      {/* Mouse: on hover. Touch has no hover, so the open (active) row shows them. */}
      <span
        className={cx(
          'absolute inset-y-0 right-1 hidden items-center gap-0.5 pl-6',
          'bg-[linear-gradient(to_right,transparent,var(--surface)_1.5rem)] group-hover:flex',
          active && 'pointer-coarse:flex',
        )}
      >
        <IconButton label="Move up" disabled={first} onClick={() => onMove(-1)} className="bg-surface">
          <ArrowIcon up />
        </IconButton>
        <IconButton label="Move down" disabled={last} onClick={() => onMove(1)} className="bg-surface">
          <ArrowIcon />
        </IconButton>
        <IconButton label="Remove from list" onClick={onRemove} className="bg-surface">
          <CloseIcon />
        </IconButton>
      </span>
    </li>
  )
}

export function LiveDot({ status, message, className }: { status: LiveStatus; message: string; className?: string }) {
  const label = status === 'connected' ? 'Live' : status === 'error' ? 'Offline' : status === 'connecting' ? 'Connecting' : null
  if (!label) return null
  return (
    <span
      title={message || status}
      className={cx(
        'inline-flex shrink-0 items-center gap-1.5 px-1.5 text-[11px] font-medium',
        status === 'connected' ? 'text-up' : status === 'error' ? 'text-down' : 'text-muted',
        className,
      )}
    >
      <span className="relative flex size-2">
        {status === 'connected' && <span className="absolute inset-0 animate-ping rounded-full bg-up opacity-60" />}
        <span className="relative size-2 rounded-full bg-current" />
      </span>
      {label}
    </span>
  )
}

// --- list dialogs (new / rename / delete), shared with the phone home ---------------------

export type ListDialogState = { kind: 'new' } | { kind: 'rename'; list: Watchlist } | { kind: 'delete'; list: Watchlist } | null

export function ListDialog({
  state,
  lists,
  setActiveId,
  onClose,
}: {
  state: ListDialogState
  lists: Watchlist[]
  setActiveId: (id: string | null) => void
  onClose: () => void
}) {
  const actions = useWatchlistActions()
  if (!state) return null

  if (state.kind === 'delete') {
    const { list } = state
    return (
      <Modal
        title="Delete watchlist?"
        width={400}
        onClose={onClose}
        footer={
          <>
            <span className="flex-1" />
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                // Open a neighbour so the screen doesn't jump to the first list.
                const i = lists.findIndex((l) => l.id === list.id)
                const next = lists[i + 1] ?? lists[i - 1] ?? null
                actions.removeList(list.id)
                setActiveId(next?.id ?? null)
                onClose()
              }}
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="text-[14px] leading-relaxed text-fg">
          <b>{list.name}</b> and its {list.items.length} {list.items.length === 1 ? 'stock' : 'stocks'} will be removed. This can't be
          undone.
        </p>
      </Modal>
    )
  }

  return (
    <NameDialog
      key={state.kind === 'rename' ? state.list.id : 'new'}
      title={state.kind === 'new' ? 'New watchlist' : 'Rename watchlist'}
      initial={state.kind === 'new' ? `Watchlist ${lists.length + 1}` : state.list.name}
      submit={state.kind === 'new' ? 'Create' : 'Save'}
      onClose={onClose}
      onSubmit={(name) => {
        if (state.kind === 'rename') actions.rename(state.list.id, name)
        else actions.create(name, setActiveId).catch(() => {}) // a toast says so and the lists reload
        onClose()
      }}
    />
  )
}

function NameDialog({
  title,
  initial,
  submit,
  onSubmit,
  onClose,
}: {
  title: ReactNode
  initial: string
  submit: string
  onSubmit: (name: string) => void
  onClose: () => void
}) {
  const [name, setName] = useState(initial)
  const trimmed = name.trim()
  const go = (e?: FormEvent) => {
    e?.preventDefault()
    if (trimmed) onSubmit(trimmed.slice(0, 60))
  }
  return (
    <Modal
      title={title}
      width={400}
      onClose={onClose}
      footer={
        <>
          <span className="flex-1" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!trimmed} onClick={() => go()}>
            {submit}
          </Button>
        </>
      }
    >
      <form onSubmit={go}>
        <Input value={name} onFocus={(e) => e.target.select()} maxLength={60} placeholder="List name" aria-label="List name" onChange={(e) => setName(e.target.value)} />
      </form>
    </Modal>
  )
}

// --- icons ---------------------------------------------------------------------------------

export function PlusIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M9 3v12M3 9h12" />
    </svg>
  )
}

export function ArrowIcon({ up }: { up?: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden className={up ? '' : 'rotate-180'}>
      <path d="M9 15V3M4 8l5-5 5 5" />
    </svg>
  )
}

export function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <path d="M4.5 4.5l9 9M13.5 4.5l-9 9" />
    </svg>
  )
}

function ListIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M3 4.5h12M3 9h12M3 13.5h7" />
    </svg>
  )
}
