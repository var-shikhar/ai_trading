import { useEffect, useState, type ReactNode } from 'react'
import { api, onSignedOut } from '../api/client'
import { LoginPage } from './LoginPage'

/** Shows the login page until there's a session; returns to it whenever the
 * server says the session ended (expired, signed out elsewhere). */
export function AuthGate({ children }: { children: (user: string, signOut: () => void) => ReactNode }) {
  const [user, setUser] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    api.me().then((m) => setUser(m.username), () => setUser(null))
    return onSignedOut(() => setUser(null))
  }, [])

  const signOut = () => {
    api.logout().finally(() => {
      setUser(null)
      // Drop in-memory state (charts, live socket) from the previous session.
      window.location.reload()
    })
  }

  if (user === undefined) return <div className="login-page" aria-busy="true" />
  if (user === null) return <LoginPage onSignedIn={setUser} />
  return <>{children(user, signOut)}</>
}
