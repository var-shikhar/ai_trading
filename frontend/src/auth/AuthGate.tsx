import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { api, onSignedOut, type UserInfo } from '../api/client'
import { Button, Spinner } from '../ui/kit'
import { LoginPage } from './LoginPage'
import { SESSION_KEY, sessionQuery, useSession } from './queries'
import { BrandMark } from './shared'
import { errorMessage } from './util'

// What a person set up in this browser (charts, layout, pages, setups): cleared
// when someone else signs in here, so one user never sees another's.
const PER_USER_KEYS = [
  'charts', 'ui', 'panels', 'symbol', 'tf', 'chartType', 'scaleMode', 'volume', 'studies', 'patterns',
  'patternSettings', 'layout', 'layoutSync', 'tfFavorites', 'chartStrategy', 'backtestSetup', 'scannerSetup',
  'watchlistId', 'page', 'pageMobile', 'chartFrom', 'dock',
]
const LAST_USER = 'lastUser'

function rememberUser(username: string) {
  try {
    const last = localStorage.getItem(LAST_USER)
    if (last && last !== username) PER_USER_KEYS.forEach((k) => localStorage.removeItem(k))
    localStorage.setItem(LAST_USER, username)
  } catch {
    // storage unavailable
  }
}

/** Shows the login page until there's a session; returns to it whenever the
 * server says the session ended (expired, signed out elsewhere). */
export function AuthGate({ children }: { children: (user: UserInfo, signOut: () => void) => ReactNode }) {
  const qc = useQueryClient()
  const session = useSession()
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => onSignedOut(() => qc.setQueryData(SESSION_KEY, null)), [qc])

  const signOut = useCallback(() => {
    setSigningOut(true)
    api.logout().finally(() => {
      qc.setQueryData(SESSION_KEY, null)
      // Drop in-memory state (charts, live socket) from the previous session.
      window.location.reload()
    })
  }, [qc])

  // A session found on load is this browser's user from now on.
  const username = session.data?.username
  useEffect(() => {
    if (username) rememberUser(username)
  }, [username])

  const signedIn = useCallback(async () => {
    // Throws (shown on the login form) if the session didn't take.
    const user = await qc.fetchQuery({ ...sessionQuery, staleTime: 0 })
    if (!user) throw new Error("Signed in, but the session didn't start. Please try again.")
    rememberUser(user.username)
    // A fresh start: no cache, live socket or in-memory state from whoever
    // was signed in before (e.g. after a session expired mid-use).
    window.location.reload()
  }, [qc])

  if (signingOut) return <Splash label="Signing out…" />
  if (session.isPending) return <Splash />
  if (session.isError && session.data === undefined)
    return (
      <Splash>
        <p className="text-[15px] font-semibold text-fg">Can't reach the server</p>
        <p className="max-w-xs text-center text-[13px] text-muted">{errorMessage(session.error)}. Check your connection and try again.</p>
        <Button variant="primary" className="mt-2" loading={session.isFetching} onClick={() => session.refetch()}>
          Try again
        </Button>
      </Splash>
    )
  if (!session.data) return <LoginPage onSignedIn={signedIn} />
  return <>{children(session.data, signOut)}</>
}

/** Full-screen placeholder while the session is checked (no flash of the
 * login form for signed-in users). */
function Splash({ label, children }: { label?: string; children?: ReactNode }) {
  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center gap-3 bg-bg px-6 text-fg"
      aria-busy={!children}
      aria-live="polite"
    >
      <BrandMark size={52} className="animate-pop drop-shadow-sm" />
      {children ?? (
        <div className="flex items-center gap-2 text-[13px] text-muted">
          <Spinner size={14} />
          {label ?? 'Loading…'}
        </div>
      )}
    </div>
  )
}
