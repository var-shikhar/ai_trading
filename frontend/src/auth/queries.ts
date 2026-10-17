import { queryOptions, useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query'
import { api, ApiError, type UserInfo } from '../api/client'

/** Session and account data through TanStack Query. */

export const SESSION_KEY = ['session', 'me'] as const
export const USERS_KEY = ['admin', 'users'] as const
export const INVITES_KEY = ['admin', 'invites'] as const
export const API_KEYS_KEY = ['session', 'apiKeys'] as const

/** The signed-in user, or null when there's no session. Other failures
 * (server down) are errors, so the gate can offer a retry instead of a login
 * form that can't work. */
export const sessionQuery = queryOptions({
  queryKey: SESSION_KEY,
  queryFn: async (): Promise<UserInfo | null> => {
    try {
      return await api.me()
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return null
      throw e
    }
  },
  staleTime: Infinity,
  retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
})

export const useSession = () => useQuery(sessionQuery)

export const useUsers = () => useQuery({ queryKey: USERS_KEY, queryFn: api.users, staleTime: 10_000 })
export const useInvites = () => useQuery({ queryKey: INVITES_KEY, queryFn: api.invites, staleTime: 10_000 })
export const useApiKeys = () => useQuery({ queryKey: API_KEYS_KEY, queryFn: api.apiKeys, staleTime: 10_000 })

/** A mutation that edits a cached list at once and rolls back if the server
 * refuses; the list is refetched afterwards either way. */
export function useOptimisticList<T, V>(
  key: QueryKey,
  mutationFn: (v: V) => Promise<unknown>,
  apply: (list: T[], v: V) => T[],
  onSuccess?: (v: V) => void,
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn,
    onMutate: async (v: V) => {
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<T[]>(key)
      if (prev) qc.setQueryData<T[]>(key, apply(prev, v))
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev)
    },
    onSuccess: (_d, v) => onSuccess?.(v),
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  })
}
