import { useState } from 'react'
import type { InstrumentHit } from '../api/client'
import { useActiveWatchlist, useWatchlistActions } from '../watchlist/queries'
import { SymbolDialog } from './TopBar'

/** Phones: a search field pinned above the tab bar on every screen (as in
 * TradingView). A result opens its chart; + adds it to the active watchlist. */
export function MobileSearchBar({ current, onOpen }: { current: InstrumentHit; onOpen: (s: InstrumentHit) => void }) {
  const [open, setOpen] = useState(false)
  const { list } = useActiveWatchlist(current)
  const actions = useWatchlistActions()
  return (
    <div className="shrink-0 border-t border-line bg-surface px-3 py-2">
      <button
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="flex h-11 w-full items-center gap-2.5 rounded-xl border border-line bg-bg px-3.5 text-left text-[14px] text-muted transition active:scale-[0.99] active:bg-hover"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden className="shrink-0">
          <circle cx="7.5" cy="7.5" r="5" />
          <path d="M11.5 11.5l4.5 4.5" />
        </svg>
        <span className="min-w-0 flex-1 truncate">Search stocks, indices, F&amp;O, MCX</span>
        {list && (
          <span className="max-w-[40%] shrink-0 truncate rounded-md bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent" title="+ adds to this list">
            + {list.name}
          </span>
        )}
      </button>
      {open && (
        <SymbolDialog
          title="Search"
          isAdded={list ? (s) => list.items.some((i) => i.symbol === s) : undefined}
          onToggle={list ? (s) => actions.toggle(list.id, s) : undefined}
          onPick={(s) => {
            setOpen(false)
            onOpen(s)
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}
