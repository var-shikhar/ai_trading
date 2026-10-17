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
    <div className="tw shrink-0 border-t border-line bg-surface px-3 pt-2 pb-1">
      <button
        onClick={() => setOpen(true)}
        className="flex w-full cursor-pointer items-center gap-2 rounded-full border border-line bg-bg px-4 py-2.5 text-left text-[14px] text-muted"
      >
        <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
          <circle cx="7.5" cy="7.5" r="5" />
          <path d="M11.5 11.5l4.5 4.5" />
        </svg>
        Search stocks, indices, F&amp;O, MCX
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
