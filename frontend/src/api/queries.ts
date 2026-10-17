import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect } from 'react'
import type { Drawing } from '../drawings/types'
import { useToasts } from '../state/ui'
import { api, onFyersAuthLost } from './client'

/** App-wide server data through TanStack Query (cached, shared, refetched in
 * the background). Screen-specific queries live next to their screens. */

export function useAuthStatus() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['auth', 'status'], queryFn: api.authStatus, staleTime: 60_000, refetchInterval: 5 * 60_000 })
  // A request that finds the Fyers login gone refreshes the status at once.
  useEffect(() => onFyersAuthLost(() => qc.invalidateQueries({ queryKey: ['auth', 'status'] })), [qc])
  return q
}

export const useStudiesCatalog = () => useQuery({ queryKey: ['studies', 'catalog'], queryFn: api.studiesCatalog, staleTime: Infinity })

export const usePatternCatalog = (enabled: boolean) =>
  useQuery({ queryKey: ['patterns', 'catalog'], queryFn: api.patternCatalog, staleTime: Infinity, enabled })

// --- drawings: per symbol, shared by every chart showing it -------------------------------------

const EMPTY: Drawing[] = []
const saveTimers: Record<string, ReturnType<typeof setTimeout>> = {}
// Symbols whose saved drawings have arrived from the server, and merges in flight.
const loaded = new Set<string>()
const merging = new Set<string>()

const fetchDrawings = async (symbol: string) => {
  const d = await api.drawings(symbol)
  loaded.add(symbol)
  return d
}

/** A symbol's drawings; edits show at once and are saved shortly after (one
 * save per burst of edits, e.g. while dragging). */
export function useDrawings(symbol: string, enabled: boolean) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['drawings', symbol], queryFn: () => fetchDrawings(symbol), enabled, staleTime: Infinity })
  const change = useCallback(
    (items: Drawing[]) => {
      const key = ['drawings', symbol]
      const save = (list: Drawing[]) => {
        clearTimeout(saveTimers[symbol])
        saveTimers[symbol] = setTimeout(
          () => api.saveDrawings(symbol, list).catch(() => useToasts.getState().push("Couldn't save your drawings", 'err')),
          400,
        )
      }
      if (loaded.has(symbol)) {
        qc.setQueryData(key, items)
        return save(items)
      }
      // Drawn before the saved drawings arrived: saving this list as is would
      // replace them on the server. Show it now, load the saved ones, keep both.
      void qc.cancelQueries({ queryKey: key }) // its result would hide the new drawing
      qc.setQueryData(key, items)
      if (merging.has(symbol)) return // the merge in flight picks up this edit too
      merging.add(symbol)
      fetchDrawings(symbol)
        .then((saved) => {
          const mine = qc.getQueryData<Drawing[]>(key) ?? []
          const ids = new Set(mine.map((d) => d.id))
          const all = [...saved.filter((d) => !ids.has(d.id)), ...mine]
          qc.setQueryData(key, all)
          save(all)
        })
        .catch(() => useToasts.getState().push("Couldn't load your drawings; the new one isn't saved yet", 'err'))
        .finally(() => merging.delete(symbol))
    },
    [qc, symbol],
  )
  return { drawings: q.data ?? EMPTY, change }
}
