import { useMemo, useState, type ReactNode } from 'react'
import type { InstrumentHit, WatchItem } from '../api/client'
import { useLiveStatus, useTicks } from '../live/liveClient'
import { SymbolDialog } from '../ui/TopBar'
import { Button, cx, EmptyState, ErrorText, Skeleton, Tabs } from '../ui/kit'
import { priceOf, useActiveWatchlist, usePriceFlash, useQuotes, useWatchlistActions, type Price } from './queries'
import { ArrowIcon, ListDialog, LiveDot, PlusIcon, type ListDialogState } from './WatchlistPanel'

/** Phone home, like a broker app (Kotak Neo): market indices on top, your
 * watchlists as tabs, big rows with live prices. Tapping a row opens its
 * chart. */

const INDICES: InstrumentHit[] = [
  { symbol: 'NSE:NIFTY50-INDEX', ticker: 'NIFTY 50', name: 'NIFTY 50', kind: 'INDEX' },
  { symbol: 'NSE:NIFTYBANK-INDEX', ticker: 'BANK NIFTY', name: 'NIFTY BANK', kind: 'INDEX' },
  { symbol: 'BSE:SENSEX-INDEX', ticker: 'SENSEX', name: 'SENSEX', kind: 'INDEX' },
  { symbol: 'NSE:FINNIFTY-INDEX', ticker: 'FIN NIFTY', name: 'NIFTY FIN SERVICE', kind: 'INDEX' },
  { symbol: 'NSE:INDIAVIX-INDEX', ticker: 'INDIA VIX', name: 'INDIA VIX', kind: 'INDEX' },
]
const INDEX_SYMBOLS = INDICES.map((i) => i.symbol)

const fmt = (v: number, digits = 2) => v.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })
const signed = (v: number, suffix = '') => `${v >= 0 ? '+' : ''}${fmt(v)}${suffix}`

export function MobileHome({ current, onOpen }: { current: InstrumentHit; onOpen: (s: InstrumentHit) => void }) {
  const { lists, list, setActiveId, isPending, error, refetch } = useActiveWatchlist(current)
  const actions = useWatchlistActions()
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [dialog, setDialog] = useState<ListDialogState>(null)
  const live = useLiveStatus()

  // Separate queries: switching lists doesn't refetch the indices.
  const indexTicks = useTicks(INDEX_SYMBOLS)
  const indexQuotes = useQuotes(INDEX_SYMBOLS)
  const symbols = useMemo(() => list?.items.map((i) => i.symbol) ?? [], [list])
  const ticks = useTicks(symbols)
  const quotesQuery = useQuotes(symbols)
  const quotes = quotesQuery.data ?? {}

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg">
      {/* Indices */}
      <div className="flex shrink-0 snap-x gap-2 overflow-x-auto px-3 pt-3 pb-2 [scrollbar-width:none]">
        {INDICES.map((ix) => (
          <IndexCard
            key={ix.symbol}
            ix={ix}
            price={priceOf(indexTicks[ix.symbol], indexQuotes.data?.[ix.symbol])}
            loading={indexQuotes.isFetching && indexQuotes.data?.[ix.symbol] === undefined}
            onOpen={() => onOpen(ix)}
          />
        ))}
      </div>

      {/* Watchlist tabs */}
      <div className="flex shrink-0 items-center gap-1 border-b border-line bg-surface pr-2">
        <div className="flex min-w-0 flex-1 items-center overflow-x-auto [scrollbar-width:none]">
          {isPending ? (
            <div className="flex gap-4 px-3 py-3">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-16" />
            </div>
          ) : (
            <Tabs
              className="shrink-0 px-1 [&>button]:text-[14px]"
              value={list?.id ?? ''}
              onChange={(id) => setActiveId(id)}
              items={(lists ?? []).map((l) => ({ id: l.id, label: l.name }))}
            />
          )}
          <RoundButton label="New watchlist" plain className="ml-1 text-accent" onClick={() => setDialog({ kind: 'new' })}>
            <PlusIcon size={16} />
          </RoundButton>
        </div>
        <LiveDot status={live.status} message={live.message} />
        {list && (
          <Button size="sm" variant={editing ? 'primary' : 'soft'} onClick={() => setEditing(!editing)}>
            {editing ? 'Done' : 'Edit'}
          </Button>
        )}
      </div>

      {editing && list && (
        <div className="flex shrink-0 animate-pop items-center gap-2 border-b border-line bg-surface px-4 py-2">
          <span className="min-w-0 flex-1 truncate text-[13px] text-muted">
            <b className="font-semibold text-fg">{list.name}</b> · {list.items.length} {list.items.length === 1 ? 'stock' : 'stocks'}
          </span>
          <Button size="sm" onClick={() => setDialog({ kind: 'rename', list })}>
            Rename
          </Button>
          <Button size="sm" variant="danger" onClick={() => setDialog({ kind: 'delete', list })}>
            Delete
          </Button>
        </div>
      )}

      {/* Rows */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {error && (
          <ErrorText className="m-3">
            {error.message}{' '}
            <button className="font-semibold underline" onClick={() => void refetch()}>
              Retry
            </button>
          </ErrorText>
        )}
        {isPending && <RowSkeletons />}
        {!isPending && !list && !error && (
          <EmptyState
            title="No watchlists yet"
            action={
              <Button variant="primary" onClick={() => setDialog({ kind: 'new' })}>
                Create a watchlist
              </Button>
            }
          >
            Make a list to follow live prices of the stocks you trade.
          </EmptyState>
        )}
        {list && list.items.length === 0 && (
          <EmptyState
            icon={<PlusIcon size={22} />}
            title={`No stocks in ${list.name} yet`}
            action={
              <Button variant="primary" onClick={() => setAdding(true)}>
                Add stocks
              </Button>
            }
          >
            Search stocks, indices, F&amp;O and MCX and add them here.
          </EmptyState>
        )}
        <ul className="bg-surface">
          {list?.items.map((item, i) => (
            <HomeRow
              key={item.symbol}
              item={item}
              price={priceOf(ticks[item.symbol], quotes[item.symbol])}
              priceLoading={quotesQuery.isFetching && quotes[item.symbol] === undefined}
              editing={editing}
              first={i === 0}
              last={i === list.items.length - 1}
              onOpen={() => onOpen({ ...item, exchange: item.exchange ?? undefined })}
              onRemove={() => actions.removeItem(list.id, item.symbol)}
              onMove={(d) => actions.move(list.id, item.symbol, d)}
            />
          ))}
        </ul>
        {list && list.items.length > 0 && (
          <div className="flex justify-center py-5">
            <Button variant="soft" onClick={() => setAdding(true)}>
              <PlusIcon />
              Add stocks
            </Button>
          </div>
        )}
      </div>

      {adding && list && (
        <SymbolDialog
          title={`Add to ${list.name}`}
          isAdded={(s) => list.items.some((i) => i.symbol === s)}
          onPick={(s) => actions.toggle(list.id, s)}
          onClose={() => setAdding(false)}
        />
      )}
      <ListDialog
        state={dialog}
        lists={lists ?? []}
        setActiveId={setActiveId}
        onClose={() => {
          if (dialog?.kind === 'delete') setEditing(false)
          setDialog(null)
        }}
      />
    </div>
  )
}

function IndexCard({ ix, price, loading, onOpen }: { ix: InstrumentHit; price: Price | null; loading: boolean; onOpen: () => void }) {
  const flash = usePriceFlash(price?.ltp)
  const tone = price?.ch == null ? 'text-muted' : price.ch >= 0 ? 'text-up' : 'text-down'
  return (
    <button
      onClick={onOpen}
      className={cx(
        'flex min-w-[132px] shrink-0 snap-start flex-col items-start gap-1 rounded-xl border border-line px-3 py-2.5 text-left shadow-card transition-colors duration-500 active:scale-[0.98]',
        flash === 'up' ? 'bg-up-soft' : flash === 'down' ? 'bg-down-soft' : 'bg-surface',
      )}
    >
      <span className="text-[11px] font-semibold tracking-wide text-muted">{ix.ticker}</span>
      {price ? (
        <>
          <span className="text-[16px] leading-tight font-semibold text-fg tabular-nums">{fmt(price.ltp)}</span>
          <span className={cx('text-[11px] font-medium tabular-nums', tone)}>
            {price.ch != null && price.chp != null ? `${signed(price.ch)} (${signed(price.chp, '%')})` : ' '}
          </span>
        </>
      ) : loading ? (
        <>
          <Skeleton className="h-4.5 w-20" />
          <Skeleton className="h-3 w-24" />
        </>
      ) : (
        <>
          <span className="text-[16px] leading-tight font-semibold text-muted">–</span>
          <span className="text-[11px]"> </span>
        </>
      )}
    </button>
  )
}

function RowSkeletons({ rows = 8 }: { rows?: number }) {
  return (
    <div aria-busy className="bg-surface">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex min-h-16 items-center gap-3 border-b border-line px-4">
          <span className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-36" />
          </span>
          <span className="flex flex-col items-end gap-2">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-3 w-24" />
          </span>
        </div>
      ))}
    </div>
  )
}

function HomeRow({
  item,
  price,
  priceLoading,
  editing,
  first,
  last,
  onOpen,
  onRemove,
  onMove,
}: {
  item: WatchItem
  price: Price | null
  priceLoading: boolean
  editing: boolean
  first: boolean
  last: boolean
  onOpen: () => void
  onRemove: () => void
  onMove: (delta: number) => void
}) {
  const flash = usePriceFlash(price?.ltp)
  const tone = price?.ch == null ? 'text-fg' : price.ch >= 0 ? 'text-up' : 'text-down'
  return (
    <li
      className={cx(
        'flex min-h-16 items-center border-b border-line transition-colors duration-500',
        flash === 'up' ? 'bg-up-soft' : flash === 'down' ? 'bg-down-soft' : 'bg-surface',
      )}
    >
      {editing && (
        <RoundButton label={`Remove ${item.ticker}`} plain onClick={onRemove} className="ml-2">
          <span className="flex size-5 items-center justify-center rounded-full bg-down text-white">
            <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.8" aria-hidden>
              <path d="M2 5h6" />
            </svg>
          </span>
        </RoundButton>
      )}
      <button
        onClick={onOpen}
        disabled={editing}
        className="flex min-h-16 min-w-0 flex-1 items-center gap-3 px-4 py-2.5 text-left active:bg-hover disabled:cursor-default"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <b className="truncate text-[15px] font-semibold text-fg">{item.ticker}</b>
          <span className="truncate text-[12px] text-muted">
            <span className="mr-1 rounded bg-hover px-1 py-px text-[10px] font-semibold tracking-wide">
              {item.exchange ?? item.symbol.split(':')[0]}
            </span>
            {item.name && item.name !== item.ticker ? item.name : ''}
          </span>
        </span>
        {!editing && (
          <span className="flex shrink-0 flex-col items-end gap-0.5 tabular-nums">
            {price ? (
              <>
                <span className={cx('text-[15px] font-semibold', tone)}>{fmt(price.ltp)}</span>
                <span className="text-[12px] text-muted">
                  {price.ch != null && price.chp != null ? `${signed(price.ch)} (${signed(price.chp, '%')})` : ''}
                </span>
              </>
            ) : priceLoading ? (
              <>
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-3 w-24" />
              </>
            ) : (
              <span className="text-[15px] text-muted">–</span>
            )}
          </span>
        )}
      </button>
      {editing && (
        <span className="flex shrink-0 items-center gap-1 pr-3">
          <RoundButton label="Move up" disabled={first} onClick={() => onMove(-1)}>
            <ArrowIcon up />
          </RoundButton>
          <RoundButton label="Move down" disabled={last} onClick={() => onMove(1)}>
            <ArrowIcon />
          </RoundButton>
        </span>
      )}
    </li>
  )
}

// 40px touch target (the kit IconButton is 32px).
function RoundButton({
  label,
  onClick,
  disabled,
  plain,
  className,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  /** No ring. */
  plain?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <button
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'flex size-10 shrink-0 items-center justify-center rounded-full transition active:bg-hover disabled:opacity-30',
        !plain && 'border border-line',
        className,
      )}
    >
      {children}
    </button>
  )
}
