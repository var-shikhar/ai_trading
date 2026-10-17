import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { InstrumentHit, Quote, WatchItem } from '../api/client'
import { useLiveStatus, useTicks, type Tick } from '../live/liveClient'
import { SymbolDialog } from '../ui/TopBar'
import { useActiveWatchlist, useQuotes, useWatchlistActions } from './queries'

/** Phone home, like a broker app (Kotak Neo): market indices on top, your
 * watchlists as tabs, big rows with live prices. Tapping a row opens its
 * chart. Built with Tailwind + TanStack Query. */

const INDICES: InstrumentHit[] = [
  { symbol: 'NSE:NIFTY50-INDEX', ticker: 'NIFTY 50', name: 'NIFTY 50', kind: 'INDEX' },
  { symbol: 'NSE:NIFTYBANK-INDEX', ticker: 'BANK NIFTY', name: 'NIFTY BANK', kind: 'INDEX' },
  { symbol: 'BSE:SENSEX-INDEX', ticker: 'SENSEX', name: 'SENSEX', kind: 'INDEX' },
  { symbol: 'NSE:FINNIFTY-INDEX', ticker: 'FIN NIFTY', name: 'NIFTY FIN SERVICE', kind: 'INDEX' },
  { symbol: 'NSE:INDIAVIX-INDEX', ticker: 'INDIA VIX', name: 'INDIA VIX', kind: 'INDEX' },
]

interface Price {
  ltp: number
  ch: number | null
  chp: number | null
}

const priceOf = (tick: Tick | undefined, quote: Quote | null | undefined): Price | null =>
  tick ? { ltp: tick.ltp, ch: tick.ch, chp: tick.chp } : quote ? { ltp: quote.ltp, ch: quote.ch, chp: quote.chp } : null

const fmt = (v: number, digits = 2) =>
  v.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })
const signed = (v: number, suffix = '') => `${v >= 0 ? '+' : ''}${fmt(v)}${suffix}`

export function MobileHome({ current, onOpen }: { current: InstrumentHit; onOpen: (s: InstrumentHit) => void }) {
  const { lists, list, setActiveId, isPending, error } = useActiveWatchlist(current)
  const actions = useWatchlistActions()
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  const live = useLiveStatus()

  const symbols = useMemo(() => [...INDICES.map((i) => i.symbol), ...(list?.items.map((i) => i.symbol) ?? [])], [list])
  const ticks = useTicks(symbols)
  const quotes = useQuotes(symbols).data ?? {}
  const price = (s: string) => priceOf(ticks[s], quotes[s])

  const newList = async () => {
    const name = window.prompt('Name for the new watchlist', `Watchlist ${(lists?.length ?? 0) + 1}`)?.trim()
    if (name) setActiveId((await actions.create(name)).id)
  }

  return (
    <div className="tw flex min-h-0 flex-1 flex-col bg-bg">
      {/* Indices */}
      <div className="flex shrink-0 gap-2 overflow-x-auto px-3 pt-3 pb-2 [scrollbar-width:none]">
        {INDICES.map((ix) => {
          const p = price(ix.symbol)
          const up = (p?.ch ?? 0) >= 0
          return (
            <button
              key={ix.symbol}
              onClick={() => onOpen(ix)}
              className="flex min-w-[124px] shrink-0 cursor-pointer flex-col items-start gap-0.5 rounded-xl border border-line bg-surface px-3 py-2 text-left shadow-card active:bg-hover"
            >
              <span className="text-[11px] font-semibold tracking-wide text-muted">{ix.ticker}</span>
              <span className="text-[15px] font-semibold tabular-nums text-fg">{p ? fmt(p.ltp) : '–'}</span>
              <span className={`text-[11px] font-medium tabular-nums ${up ? 'text-up' : 'text-down'}`}>
                {p?.chp != null ? `${up ? '▲' : '▼'} ${signed(p.chp, '%')}` : ' '}
              </span>
            </button>
          )
        })}
      </div>

      {/* Watchlist tabs */}
      <div className="flex shrink-0 items-center gap-1 border-b border-line px-2">
        <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto [scrollbar-width:none]">
          {(lists ?? []).map((l) => {
            const on = l.id === list?.id
            return (
              <button
                key={l.id}
                onClick={() => setActiveId(l.id)}
                className={`shrink-0 cursor-pointer border-b-2 px-3 py-2.5 text-[14px] whitespace-nowrap ${
                  on ? 'border-accent font-semibold text-accent' : 'border-transparent text-muted'
                }`}
              >
                {l.name}
              </button>
            )
          })}
          <button onClick={newList} className="shrink-0 cursor-pointer px-3 py-2.5 text-[14px] text-muted" title="New watchlist">
            + New
          </button>
        </div>
        <span
          className={`shrink-0 text-[11px] ${live.status === 'connected' ? 'text-up' : 'text-muted'}`}
          title={live.message || live.status}
        >
          {live.status === 'connected' ? '● Live' : live.status === 'error' ? '● Offline' : ''}
        </span>
        <button
          onClick={() => setEditing(!editing)}
          className={`shrink-0 cursor-pointer rounded-md px-2 py-1 text-[13px] font-medium ${editing ? 'bg-accent text-accent-fg' : 'text-accent'}`}
        >
          {editing ? 'Done' : 'Edit'}
        </button>
      </div>

      {editing && list && (
        <div className="flex shrink-0 items-center gap-3 border-b border-line bg-surface px-4 py-2 text-[13px]">
          <button
            className="cursor-pointer text-accent"
            onClick={() => {
              const name = window.prompt('Rename watchlist', list.name)?.trim()
              if (name) actions.rename(list.id, name)
            }}
          >
            Rename
          </button>
          <button
            className="cursor-pointer text-down"
            onClick={() => {
              if (!window.confirm(`Delete the watchlist "${list.name}"?`)) return
              actions.removeList(list.id)
              setActiveId(lists?.find((l) => l.id !== list.id)?.id ?? null)
            }}
          >
            Delete list
          </button>
          <span className="ml-auto text-muted">{list.items.length} stocks</span>
        </div>
      )}

      {/* Rows */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {(error || actions.error) && (
          <p className="px-4 py-3 text-down">{(error ?? actions.error)?.message}</p>
        )}
        {isPending && <p className="px-4 py-6 text-center text-muted">Loading…</p>}
        {list && list.items.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center text-muted">
            <p className="m-0 text-[15px]">No stocks in {list.name} yet.</p>
            <button
              onClick={() => setAdding(true)}
              className="cursor-pointer rounded-full bg-accent px-5 py-2 text-[14px] font-semibold text-accent-fg"
            >
              Add stocks
            </button>
          </div>
        )}
        <ul className="m-0 list-none p-0">
          {list?.items.map((item, i) => (
            <HomeRow
              key={item.symbol}
              item={item}
              price={price(item.symbol)}
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
          <button
            onClick={() => setAdding(true)}
            className="mx-auto my-4 block cursor-pointer rounded-full border border-accent px-4 py-1.5 text-[13px] font-semibold text-accent"
          >
            + Add stocks
          </button>
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
    </div>
  )
}

function HomeRow({
  item,
  price,
  editing,
  first,
  last,
  onOpen,
  onRemove,
  onMove,
}: {
  item: WatchItem
  price: Price | null
  editing: boolean
  first: boolean
  last: boolean
  onOpen: () => void
  onRemove: () => void
  onMove: (delta: number) => void
}) {
  // Brief green/red flash when the price ticks up/down.
  const [flash, setFlash] = useState<'up' | 'down' | null>(null)
  const prev = useRef<number | null>(null)
  useEffect(() => {
    const ltp = price?.ltp ?? null
    if (ltp !== null && prev.current !== null && ltp !== prev.current) {
      setFlash(ltp > prev.current ? 'up' : 'down')
      const id = setTimeout(() => setFlash(null), 500)
      prev.current = ltp
      return () => clearTimeout(id)
    }
    prev.current = ltp
  }, [price?.ltp])

  const up = (price?.ch ?? 0) >= 0
  const tone = up ? 'text-up' : 'text-down'
  return (
    <li
      className={`flex items-center border-b border-line transition-colors duration-500 ${
        flash === 'up' ? 'bg-up-soft' : flash === 'down' ? 'bg-down-soft' : 'bg-surface'
      }`}
    >
      <button onClick={onOpen} className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 px-4 py-3 text-left active:bg-hover">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <b className="truncate text-[15px] font-semibold text-fg">{item.ticker}</b>
          <span className="truncate text-[11px] text-muted">
            {item.exchange ?? item.symbol.split(':')[0]}
            {item.name && item.name !== item.ticker ? ` · ${item.name}` : ''}
          </span>
        </span>
        {!editing && (
          <span className="flex shrink-0 flex-col items-end gap-0.5 tabular-nums">
            <span className={`text-[15px] font-semibold ${price ? tone : 'text-muted'}`}>{price ? fmt(price.ltp) : '–'}</span>
            <span className="text-[12px] text-muted">
              {price?.ch != null && price.chp != null ? `${signed(price.ch)} (${signed(price.chp, '%')})` : ''}
            </span>
          </span>
        )}
      </button>
      {editing && (
        <span className="flex shrink-0 items-center gap-1 pr-3">
          <IconBtn label="Move up" disabled={first} onClick={() => onMove(-1)}>
            ↑
          </IconBtn>
          <IconBtn label="Move down" disabled={last} onClick={() => onMove(1)}>
            ↓
          </IconBtn>
          <IconBtn label="Remove" danger onClick={onRemove}>
            ×
          </IconBtn>
        </span>
      )}
    </li>
  )
}

function IconBtn({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  children: ReactNode
}) {
  return (
    <button
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`flex size-9 cursor-pointer items-center justify-center rounded-full border border-line bg-raised text-[16px] disabled:opacity-30 ${
        danger ? 'text-down' : 'text-fg'
      }`}
    >
      {children}
    </button>
  )
}
