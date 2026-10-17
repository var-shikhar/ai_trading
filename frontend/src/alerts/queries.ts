import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { toInput, type Alert, type AlertIn, type AlertList } from './types'

/** Alerts through TanStack Query: one cache for the Alerts panel and the
 * alert lines on the chart. Pause/resume/delete show at once (optimistic)
 * and roll back if the server refuses. */

const KEY = ['alerts'] as const

export function useAlerts() {
  return useQuery({ queryKey: KEY, queryFn: api.alerts, refetchInterval: 30_000 })
}

export function useAlertActions() {
  const qc = useQueryClient()
  const patch = (fn: (alerts: Alert[]) => Alert[]) => {
    const prev = qc.getQueryData<AlertList>(KEY)
    if (prev) qc.setQueryData<AlertList>(KEY, { ...prev, alerts: fn(prev.alerts) })
    return prev
  }
  const optimistic = <V>(mutationFn: (v: V) => Promise<unknown>, apply: (v: V) => (a: Alert[]) => Alert[]) => ({
    // One queue: quick on/off/on taps reach the server in the order tapped.
    scope: { id: 'alerts' },
    mutationFn,
    onMutate: async (v: V) => {
      await qc.cancelQueries({ queryKey: KEY })
      return { prev: patch(apply(v)) }
    },
    onError: (_e: unknown, _v: V, ctx?: { prev?: AlertList }) => ctx?.prev && qc.setQueryData(KEY, ctx.prev),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: KEY })
    },
  })

  const setStatus = useMutation(
    optimistic(
      ({ a, status }: { a: Alert; status: 'active' | 'paused' }) => api.updateAlert(a.id, toInput(a, status)),
      ({ a, status }) => (all) => all.map((x) => (x.id === a.id ? { ...x, status } : x)),
    ),
  )
  const remove = useMutation(
    optimistic(
      (a: Alert) => api.deleteAlert(a.id),
      (a) => (all) => all.filter((x) => x.id !== a.id),
    ),
  )
  // Resolves as soon as the server saved it (the list refreshes in the
  // background), so the dialog closes at once and can't be submitted twice.
  const save = useMutation({
    mutationFn: ({ id, body }: { id?: string; body: AlertIn }) => (id ? api.updateAlert(id, body) : api.createAlert(body)),
    onSuccess: (saved) =>
      patch((all) => (all.some((x) => x.id === saved.id) ? all.map((x) => (x.id === saved.id ? saved : x)) : [saved, ...all])),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: KEY })
    },
  })
  return { setStatus, remove, save, error: (setStatus.error ?? remove.error) as Error | null }
}

/** Active price levels to draw on a symbol's chart. */
export function alertLevels(list: AlertList | undefined, symbol: string): number[] {
  return (list?.alerts ?? [])
    .filter(
      (a) =>
        a.symbol === symbol &&
        a.status === 'active' &&
        a.kind === 'price' &&
        !a.config.op?.startsWith('change') &&
        typeof a.config.value === 'number',
    )
    .map((a) => a.config.value as number)
}
