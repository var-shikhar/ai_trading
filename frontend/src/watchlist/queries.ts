import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type InstrumentHit, type Quote, type Watchlist, type WatchItem } from '../api/client'
import { useSharedPref } from '../prefs'

/** Watchlists through TanStack Query: one cache shared by the phone home,
 * the chart's dock and the search bar. Edits show at once (optimistic) and
 * are sent in order; a failed save reloads the lists from the server. */

const KEY = ['watchlists'] as const

export const toItem = (s: InstrumentHit): WatchItem => ({
  symbol: s.symbol,
  ticker: s.ticker,
  name: s.name,
  kind: s.kind,
  exchange: s.exchange ?? s.symbol.split(':')[0],
})

export function useWatchlists(seed?: InstrumentHit) {
  return useQuery({
    queryKey: KEY,
    queryFn: async () => {
      const all = await api.watchlists()
      // First use: start a list with the symbol on the chart.
      return all.length || !seed ? all : [await api.createWatchlist('Watchlist', [toItem(seed)])]
    },
    staleTime: Infinity,
  })
}

/** The list being shown, chosen on any screen. */
export function useActiveWatchlist(seed: InstrumentHit) {
  const query = useWatchlists(seed)
  const [activeId, setActiveId] = useSharedPref<string | null>('watchlistId', null)
  const lists = query.data ?? null
  const list = lists?.find((l) => l.id === activeId) ?? lists?.[0] ?? null
  return { ...query, lists, list, setActiveId }
}

export function useWatchlistActions() {
  const qc = useQueryClient()
  const lists = () => qc.getQueryData<Watchlist[]>(KEY) ?? []
  const setLists = (fn: (all: Watchlist[]) => Watchlist[]) => qc.setQueryData<Watchlist[]>(KEY, (all) => fn(all ?? []))
  const resync = () => qc.invalidateQueries({ queryKey: KEY })

  // One scope: saves run one after another, in the order they were made.
  const save = useMutation({
    scope: { id: 'watchlists' },
    mutationFn: ({ id, patch }: { id: string; patch: { name?: string; items?: WatchItem[] } }) =>
      api.updateWatchlist(id, patch),
    onError: resync,
  })
  const create = useMutation({
    scope: { id: 'watchlists' },
    mutationFn: (name: string) => api.createWatchlist(name),
    onSuccess: (created, _name) => setLists((all) => [...all.filter((l) => !l.id.startsWith('tmp-')), created]),
    onError: resync,
  })
  const remove = useMutation({
    scope: { id: 'watchlists' },
    mutationFn: (id: string) => api.deleteWatchlist(id),
    onError: resync,
  })

  // Patches are computed from the cache at call time, so quick taps in a row
  // build on each other instead of on a stale render.
  const update = (id: string, patch: (l: Watchlist) => { name?: string; items?: WatchItem[] }) => {
    const current = lists().find((l) => l.id === id)
    if (!current) return
    const p = patch(current)
    setLists((all) => all.map((l) => (l.id === id ? { ...l, ...p } : l)))
    save.mutate({ id, patch: p })
  }

  return {
    error: save.error ?? create.error ?? remove.error,
    add: (id: string, s: InstrumentHit) =>
      update(id, (l) => ({ items: l.items.some((i) => i.symbol === s.symbol) ? l.items : [...l.items, toItem(s)] })),
    /** Several at once (e.g. scan results), in one save. */
    addMany: (id: string, list: InstrumentHit[]) =>
      update(id, (l) => {
        const have = new Set(l.items.map((i) => i.symbol))
        return { items: [...l.items, ...list.filter((s) => !have.has(s.symbol)).map(toItem)] }
      }),
    removeItem: (id: string, symbol: string) => update(id, (l) => ({ items: l.items.filter((i) => i.symbol !== symbol) })),
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
    rename: (id: string, name: string) => update(id, () => ({ name })),
    /** Resolves with the new list (shown at once under a temporary id). */
    create: async (name: string) => {
      setLists((all) => [...all, { id: `tmp-${Date.now()}`, name, items: [], position: all.length } as Watchlist])
      return create.mutateAsync(name)
    },
    removeList: (id: string) => {
      setLists((all) => all.filter((l) => l.id !== id))
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
