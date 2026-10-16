import { useEffect, useMemo, useRef, useState } from 'react'
import { api, type InstrumentHit, type Quote, type Watchlist, type WatchItem } from '../api/client'
import { useLiveStatus, useTicks, type Tick } from '../live/liveClient'
import { usePref } from '../prefs'
import { Dropdown } from '../ui/Dropdown'
import { SymbolDialog } from '../ui/TopBar'

interface Price {
  ltp: number
  ch: number | null
  chp: number | null
}

const toItem = (s: InstrumentHit): WatchItem => ({
  symbol: s.symbol,
  ticker: s.ticker,
  name: s.name,
  kind: s.kind,
  exchange: s.exchange ?? s.symbol.split(':')[0],
})

/** TradingView-style watchlist: several named lists, live prices, click to
 * open in the active chart. */
export function WatchlistPanel({
  current,
  activeSymbol,
  onOpen,
  page = false,
}: {
  current: InstrumentHit
  activeSymbol: string
  onOpen: (s: InstrumentHit) => void
  /** Full screen (the phone home tab) rather than a side panel. */
  page?: boolean
}) {
  const [lists, setLists] = useState<Watchlist[] | null>(null)
  const [activeId, setActiveId] = usePref<string | null>('watchlistId', null)
  const [adding, setAdding] = useState(false)
  const [quotes, setQuotes] = useState<Record<string, Quote | null>>({})
  const [error, setError] = useState<string | null>(null)
  const liveStatus = useLiveStatus()

  useEffect(() => {
    api
      .watchlists()
      .then(async (all) => {
        // First use: start a list with the symbol on the chart.
        if (!all.length) all = [await api.createWatchlist('Watchlist', [toItem(current)])]
        setLists(all)
      })
      .catch((e: Error) => setError(e.message))
    // only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const list = lists?.find((l) => l.id === activeId) ?? lists?.[0] ?? null
  const symbols = useMemo(() => list?.items.map((i) => i.symbol) ?? [], [list])
  const ticks = useTicks(symbols)

  // Snapshot prices (also outside market hours); live ticks then take over.
  useEffect(() => {
    if (!symbols.length) return
    api.quotes(symbols).then((q) => setQuotes((prev) => ({ ...prev, ...q })), () => {})
  }, [symbols.join('|')]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (patch: { name?: string; items?: WatchItem[] }) => {
    if (!list) return
    const optimistic = { ...list, ...patch }
    setLists((all) => all?.map((l) => (l.id === list.id ? optimistic : l)) ?? null)
    try {
      await api.updateWatchlist(list.id, patch)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const add = (s: InstrumentHit) => {
    if (!list || list.items.some((i) => i.symbol === s.symbol)) return
    save({ items: [...list.items, toItem(s)] })
  }
  const remove = (symbol: string) => list && save({ items: list.items.filter((i) => i.symbol !== symbol) })
  const move = (symbol: string, delta: number) => {
    if (!list) return
    const items = [...list.items]
    const i = items.findIndex((x) => x.symbol === symbol)
    const j = i + delta
    if (i < 0 || j < 0 || j >= items.length) return
    ;[items[i], items[j]] = [items[j], items[i]]
    save({ items })
  }

  const newList = async () => {
    const name = window.prompt('Name for the new watchlist', 'Watchlist')?.trim()
    if (!name) return
    const created = await api.createWatchlist(name)
    setLists((all) => [...(all ?? []), created])
    setActiveId(created.id)
  }
  const rename = () => {
    const name = list && window.prompt('Rename watchlist', list.name)?.trim()
    if (name) save({ name })
  }
  const removeList = async () => {
    if (!list || !window.confirm(`Delete the watchlist "${list.name}"?`)) return
    await api.deleteWatchlist(list.id)
    const rest = (lists ?? []).filter((l) => l.id !== list.id)
    setLists(rest)
    setActiveId(rest[0]?.id ?? null)
  }

  const inList = list?.items.some((i) => i.symbol === current.symbol) ?? false

  return (
    <aside className={`pattern-panel watchlist-panel ${page ? 'page' : ''}`} aria-label="Watchlist">
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
        <button className="icon-button" title={`Add ${current.ticker}`} disabled={inList} onClick={() => add(current)}>
          <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
            <path d="M9 3v12M3 9h12" />
          </svg>
        </button>
        <button className="icon-button" title="Add symbol" onClick={() => setAdding(true)}>
          <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
            <circle cx="7.5" cy="7.5" r="5" />
            <path d="M11.5 11.5l4.5 4.5" />
          </svg>
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
        {list && list.items.length === 0 && <p className="status">Empty list. Add symbols with + or search.</p>}
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
          onPick={(s) => {
            add(s)
            setAdding(false)
          }}
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
