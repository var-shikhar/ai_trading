import { useEffect, useMemo, useRef, useState } from 'react'
import type { InstrumentHit, Quote, WatchItem } from '../api/client'
import { useLiveStatus, useTicks, type Tick } from '../live/liveClient'
import { Dropdown } from '../ui/Dropdown'
import { SymbolDialog } from '../ui/TopBar'
import { useActiveWatchlist, useQuotes, useWatchlistActions } from './queries'

interface Price {
  ltp: number
  ch: number | null
  chp: number | null
}

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
  const { lists, list, setActiveId, error: loadError } = useActiveWatchlist(current)
  const actions = useWatchlistActions()
  const [adding, setAdding] = useState(false)
  const liveStatus = useLiveStatus()
  const error = (loadError ?? actions.error)?.message ?? null

  const symbols = useMemo(() => list?.items.map((i) => i.symbol) ?? [], [list])
  const ticks = useTicks(symbols)
  const quotes = useQuotes(symbols).data ?? {}

  const add = (s: InstrumentHit) => list && actions.add(list.id, s)
  const toggle = (s: InstrumentHit) => list && actions.toggle(list.id, s)
  const remove = (symbol: string) => list && actions.removeItem(list.id, symbol)
  const move = (symbol: string, delta: number) => list && actions.move(list.id, symbol, delta)

  const newList = async () => {
    const name = window.prompt('Name for the new watchlist', 'Watchlist')?.trim()
    if (!name) return
    const created = await actions.create(name)
    setActiveId(created.id)
  }
  const rename = () => {
    const name = list && window.prompt('Rename watchlist', list.name)?.trim()
    if (list && name) actions.rename(list.id, name)
  }
  const removeList = () => {
    if (!list || !window.confirm(`Delete the watchlist "${list.name}"?`)) return
    actions.removeList(list.id)
    setActiveId((lists ?? []).find((l) => l.id !== list.id)?.id ?? null)
  }

  const inList = list?.items.some((i) => i.symbol === current.symbol) ?? false

  return (
    <aside className="pattern-panel watchlist-panel" aria-label="Watchlist">
      <div className="watch-head">
        <Dropdown label={<b>{list?.name ?? 'Watchlist'}</b>} title="Choose watchlist">
          {(close) => (
            <div className="menu-list">
              {(lists ?? []).map((l) => (
                <div key={l.id} className={`menu-item ${l.id === list?.id ? 'selected' : ''}`}>
                  <button
                    className="menu-main"
                    onClick={() => {
                      setActiveId(l.id)
                      close()
                    }}
                  >
                    {l.name} <span className="muted">· {l.items.length}</span>
                  </button>
                </div>
              ))}
              {!inList && list && (
                <>
                  <div className="menu-heading">Chart</div>
                  <div className="menu-item">
                    <button className="menu-main" onClick={() => (close(), add(current))}>
                      Add {current.ticker} (on the chart)
                    </button>
                  </div>
                </>
              )}
              <div className="menu-heading">List</div>
              <div className="menu-item">
                <button className="menu-main" onClick={() => (close(), newList())}>
                  New list…
                </button>
              </div>
              <div className="menu-item">
                <button className="menu-main" onClick={() => (close(), rename())}>
                  Rename…
                </button>
              </div>
              <div className="menu-item">
                <button className="menu-main" onClick={() => (close(), removeList())}>
                  Delete list
                </button>
              </div>
            </div>
          )}
        </Dropdown>
        <span className="spacer" />
        <span className={`live-status ${liveStatus.status}`} title={liveStatus.message || liveStatus.status}>
          {liveStatus.status === 'connected' ? '● Live' : liveStatus.status === 'error' ? '● Offline' : ''}
        </span>
        <button className="add-button" title="Search and add stocks to this list" disabled={!list} onClick={() => setAdding(true)}>
          <svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
            <path d="M9 3v12M3 9h12" />
          </svg>
          Add
        </button>
      </div>

      <div className="watch-columns">
        <span>Symbol</span>
        <span className="num">Last</span>
        <span className="num">Chg</span>
        <span className="num">Chg%</span>
      </div>
      <div className="panel-body">
        {error && <p className="status err">{error}</p>}
        {!list && !error && <p className="status">Loading…</p>}
        {list && list.items.length === 0 && (
          <div className="empty-state">
            <p>This list is empty.</p>
            <button className="primary-button" onClick={() => setAdding(true)}>
              Add stocks
            </button>
          </div>
        )}
        <ul className="watch-list">
          {list?.items.map((item) => (
            <WatchRow
              key={item.symbol}
              item={item}
              price={priceOf(ticks[item.symbol], quotes[item.symbol])}
              active={item.symbol === activeSymbol}
              onOpen={() => onOpen({ ...item, exchange: item.exchange ?? undefined })}
              onRemove={() => remove(item.symbol)}
              onMove={(d) => move(item.symbol, d)}
            />
          ))}
        </ul>
      </div>
      {adding && (
        <SymbolDialog
          title={`Add to ${list?.name ?? 'watchlist'}`}
          isAdded={(symbol) => list?.items.some((i) => i.symbol === symbol) ?? false}
          onPick={toggle}
          onClose={() => setAdding(false)}
        />
      )}
    </aside>
  )
}

function priceOf(tick: Tick | undefined, quote: Quote | null | undefined): Price | null {
  if (tick) return { ltp: tick.ltp, ch: tick.ch, chp: tick.chp }
  if (quote) return { ltp: quote.ltp, ch: quote.ch, chp: quote.chp }
  return null
}

const fmt = (v: number, digits = 2) => v.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })

function WatchRow({
  item,
  price,
  active,
  onOpen,
  onRemove,
  onMove,
}: {
  item: WatchItem
  price: Price | null
  active: boolean
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

  const dir = (price?.ch ?? 0) >= 0 ? 'pos' : 'neg'
  return (
    <li className={`watch-row ${active ? 'active' : ''} ${flash ? `flash-${flash}` : ''}`}>
      <button className="watch-main" onClick={onOpen} title={item.name}>
        <span className="watch-symbol">
          <b>{item.ticker}</b>
          <span className="muted">{item.exchange ?? item.symbol.split(':')[0]}</span>
        </span>
        <span className="num">{price ? fmt(price.ltp) : '–'}</span>
        <span className={`num ${dir}`}>{price?.ch != null ? `${price.ch >= 0 ? '+' : ''}${fmt(price.ch)}` : ''}</span>
        <span className={`num ${dir}`}>{price?.chp != null ? `${price.chp >= 0 ? '+' : ''}${fmt(price.chp)}%` : ''}</span>
      </button>
      <span className="watch-actions">
        <button title="Move up" onClick={() => onMove(-1)}>
          ↑
        </button>
        <button title="Move down" onClick={() => onMove(1)}>
          ↓
        </button>
        <button title="Remove" onClick={onRemove}>
          ×
        </button>
      </span>
    </li>
  )
}
