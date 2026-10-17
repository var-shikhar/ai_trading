import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type InstrumentHit, type Quote, type Watchlist, type WatchItem } from '../api/client'
import type { Tick } from '../live/liveClient'
import { useSharedPref } from '../prefs'
import { useToasts } from '../state/ui'

/** Watchlists through TanStack Query: one cache shared by the phone home,
 * the chart's dock and the search bar. Edits show at once (optimistic) and
 * are sent in order; a failed save reloads the lists from the server. */

const KEY = ['watchlists'] as const
const SCOPE = { id: 'watchlists' }

export const toItem = (s: InstrumentHit): WatchItem => ({
  symbol: s.symbol,
  ticker: s.ticker,
  name: s.name,
  kind: s.kind,
  exchange: s.exchange ?? s.symbol.split(':')[0],
})

// A new list is shown at once under a temporary id. Saves made to it before
// the server answers are queued behind the create (same scope), so by the
// time they run the real id is known here.
const realIds = new Map<string, string>()
const isTemp = (id: string) => id.startsWith('tmp-')
const resolveId = (id: string) => realIds.get(id) ?? id

// Shared by every component's mutations: after a failure, reload only once
// nothing else is queued, so the refetch can't wipe out newer optimistic edits.
let pending = 0
let failed = false

export function useWatchlists(seed?: InstrumentHit) {
  return useQuery({
    queryKey: KEY,
    queryFn: async () => {
      const all = await api.watchlists()
      // First use: start a list with the symbol on the chart (NIFTY 50 when
      // the first screen to load these has no chart symbol, e.g. the Screener).
      if (all.length) return all
      const first = seed?.symbol ? seed : { symbol: 'NSE:NIFTY50-INDEX', ticker: 'NIFTY50', name: 'NIFTY 50', kind: 'INDEX' as const }
      return [await api.createWatchlist('Watchlist', [toItem(first)])]
    },
    staleTime: Infinity,
  })
}

/** The list being shown, chosen on any screen. */
export function useActiveWatchlist(seed: InstrumentHit) {
  const query = useWatchlists(seed)
  const [activeId, setActiveId] = useSharedPref<string | null>('watchlistId', null)
  const id = activeId && resolveId(activeId)
  const lists = query.data ?? null
  const list = lists?.find((l) => l.id === id) ?? lists?.[0] ?? null
  // Don't keep a temporary id once the list is saved (it would not survive a reload).
  useEffect(() => {
    if (activeId && id !== activeId) setActiveId(id)
  }, [activeId, id, setActiveId])
  return { ...query, lists, list, setActiveId }
}

export function useWatchlistActions() {
  const qc = useQueryClient()
  const lists = () => qc.getQueryData<Watchlist[]>(KEY) ?? []
  const setLists = (fn: (all: Watchlist[]) => Watchlist[]) => qc.setQueryData<Watchlist[]>(KEY, (all) => fn(all ?? []))
  const tracked = {
    scope: SCOPE,
    onMutate: () => {
      pending++
    },
    onError: (e: Error) => {
      failed = true
      useToasts.getState().push(`Couldn't save the watchlist: ${e.message}`, 'err')
    },
    onSettled: () => {
      pending--
      if (pending === 0 && failed) {
        failed = false
        void qc.invalidateQueries({ queryKey: KEY })
      }
    },
  }

  // One scope: saves run one after another, in the order they were made.
  const save = useMutation({
    ...tracked,
    mutationFn: async ({ id, patch }: { id: string; patch: { name?: string; items?: WatchItem[] } }) => {
      const real = resolveId(id)
      if (isTemp(real)) return null // its create failed; the reload drops it
      return api.updateWatchlist(real, patch)
    },
  })
  const create = useMutation({
    ...tracked,
    mutationFn: async ({ tmpId, name }: { tmpId: string; name: string }) => {
      const created = await api.createWatchlist(name)
      realIds.set(tmpId, created.id)
      return created
    },
    // Swap the placeholder in place, keeping edits made to it meanwhile (their
    // saves are queued and go to the real id). If it was deleted meanwhile,
    // the queued delete removes the real one too.
    onSuccess: (created, { tmpId }) =>
      setLists((all) => all.map((l) => (l.id === tmpId ? { ...created, name: l.name, items: l.items } : l))),
  })
  const remove = useMutation({
    ...tracked,
    mutationFn: async (id: string) => {
      const real = resolveId(id)
      if (isTemp(real)) return { ok: true }
      return api.deleteWatchlist(real)
    },
  })

  // Patches are computed from the cache at call time, so quick taps in a row
  // build on each other instead of on a stale render.
  const update = (given: string, patch: (l: Watchlist) => { name?: string; items?: WatchItem[] }) => {
    // A dialog opened on a just-created list may still hold its temporary id.
    const id = lists().some((l) => l.id === given) ? given : resolveId(given)
    const current = lists().find((l) => l.id === id)
    if (!current) return
    const p = patch(current)
    if (p.name === undefined && p.items === undefined) return
    void qc.cancelQueries({ queryKey: KEY }) // an in-flight load would overwrite this edit
    setLists((all) => all.map((l) => (l.id === id ? { ...l, ...p } : l)))
    save.mutate({ id, patch: p })
  }

  return {
    error: save.error ?? create.error ?? remove.error,
    add: (id: string, s: InstrumentHit) =>
      update(id, (l) => (l.items.some((i) => i.symbol === s.symbol) ? {} : { items: [...l.items, toItem(s)] })),
    /** Several at once (e.g. scan results), in one save. */
    addMany: (id: string, list: InstrumentHit[]) =>
      update(id, (l) => {
        const have = new Set(l.items.map((i) => i.symbol))
        const added = list.filter((s) => !have.has(s.symbol) && have.add(s.symbol)).map(toItem)
        return added.length ? { items: [...l.items, ...added] } : {}
      }),
    removeItem: (id: string, symbol: string) =>
      update(id, (l) => (l.items.some((i) => i.symbol === symbol) ? { items: l.items.filter((i) => i.symbol !== symbol) } : {})),
    toggle: (id: string, s: InstrumentHit) =>
      update(id, (l) => ({
        items: l.items.some((i) => i.symbol === s.symbol)
          ? l.items.filter((i) => i.symbol !== s.symbol)
          : [...l.items, toItem(s)],
      })),
    move: (id: string, symbol: string, delta: number) =>
      update(id, (l) => {
        const items = [...l.items]
        const i = items.findIndex((x) => x.symbol === symbol)
        const j = i + delta
        if (i < 0 || j < 0 || j >= items.length) return {}
        ;[items[i], items[j]] = [items[j], items[i]]
        return { items }
      }),
    rename: (id: string, name: string) => update(id, (l) => (l.name === name ? {} : { name })),
    /** Resolves with the saved list. The list shows at once under a temporary
     * id, passed to onTemp so a caller can open it right away (the active id
     * moves to the real one by itself). */
    create: (name: string, onTemp?: (tmpId: string) => void) => {
      const tmpId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      void qc.cancelQueries({ queryKey: KEY })
      setLists((all) => [...all, { id: tmpId, name, items: [], position: all.length }])
      onTemp?.(tmpId)
      return create.mutateAsync({ tmpId, name })
    },
    removeList: (id: string) => {
      void qc.cancelQueries({ queryKey: KEY })
      const real = resolveId(id)
      setLists((all) => all.filter((l) => l.id !== id && l.id !== real))
      remove.mutate(id)
    },
  }
}

/** Snapshot prices (also outside market hours); live ticks take over on top. */
export function useQuotes(symbols: string[]) {
  return useQuery({
    queryKey: ['quotes', [...symbols].sort().join('|')],
    queryFn: () => api.quotes(symbols),
    enabled: symbols.length > 0,
    staleTime: 60_000,
    refetchInterval: 60_000,
    placeholderData: (prev) => prev as Record<string, Quote | null> | undefined,
  })
}

export interface Price {
  ltp: number
  ch: number | null
  chp: number | null
}

/** Live tick over the snapshot quote. A tick without a change (no previous
 * close in the feed) borrows the quote's previous close, so the change
 * doesn't blink out when ticks start. */
export function priceOf(tick: Tick | undefined, quote: Quote | null | undefined): Price | null {
  if (!tick) return quote ? { ltp: quote.ltp, ch: quote.ch, chp: quote.chp } : null
  if (tick.ch != null && tick.chp != null) return { ltp: tick.ltp, ch: tick.ch, chp: tick.chp }
  const prev = tick.prev_close ?? quote?.prev_close ?? (quote?.ch != null ? quote.ltp - quote.ch : null)
  if (!prev) return { ltp: tick.ltp, ch: tick.ch, chp: tick.chp }
  const ch = tick.ch ?? tick.ltp - prev
  return { ltp: tick.ltp, ch, chp: tick.chp ?? (ch / prev) * 100 }
}

/** Brief green/red flash when the price ticks up/down. */
export function usePriceFlash(ltp: number | null | undefined) {
  const [flash, setFlash] = useState<'up' | 'down' | null>(null)
  const prev = useRef<number | null>(null)
  useEffect(() => {
    const v = ltp ?? null
    const before = prev.current
    prev.current = v
    if (v === null || before === null || v === before) return
    setFlash(v > before ? 'up' : 'down')
    const id = setTimeout(() => setFlash(null), 600)
    return () => clearTimeout(id)
  }, [ltp])
  return flash
}
