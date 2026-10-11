import { useEffect, useState, type ReactNode } from 'react'
import { api, onSignedOut, type UserInfo } from '../api/client'
import { LoginPage } from './LoginPage'

/** Shows the login page until there's a session; returns to it whenever the
 * server says the session ended (expired, signed out elsewhere). */
export function AuthGate({ children }: { children: (user: UserInfo, signOut: () => void) => ReactNode }) {
  const [user, setUser] = useState<UserInfo | null | undefined>(undefined)

  useEffect(() => {
    api.me().then(setUser, () => setUser(null))
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
  if (user === null) return <LoginPage onSignedIn={() => api.me().then(setUser, () => setUser(null))} />
  return <>{children(user, signOut)}</>
}
