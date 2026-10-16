import { useState } from 'react'
import { api, type AuthStatus, type UserInfo } from '../api/client'
import { PasswordDialog, UsersDialog } from '../auth/UsersDialog'
import { ProfileDialog } from '../auth/ProfileDialog'
import type { ThemeMode } from '../chart/theme'

/** "Me" tab on phones: account, market-data connection, theme and sign-out
 * (what the desktop nav rail keeps in its bottom menus). */
export function AccountPage({
  user,
  onSignOut,
  auth,
  onFyersChanged,
  themeMode,
  onThemeMode,
}: {
  user: UserInfo
  onSignOut: () => void
  auth: AuthStatus | null
  onFyersChanged: () => void
  themeMode: ThemeMode
  onThemeMode: (m: ThemeMode) => void
}) {
  const [dialog, setDialog] = useState<'users' | 'password' | 'profile' | null>(null)
  const fyers = auth?.fyers
  const admin = user.role === 'admin'

  return (
    <div className="page-scroll">
      <div className="page-inner narrow account-page">
        <div className="account-head">
          <span className="user-chip large">{user.username.slice(0, 1).toUpperCase()}</span>
          <div>
            <h1 className="page-title">{user.username}</h1>
            <span className="muted">{admin ? 'Admin' : 'Member'}</span>
          </div>
        </div>

        <h2 className="list-heading">Market data</h2>
        <div className="settings-list">
          <div className="settings-row">
            <span>Fyers</span>
            <span className={`status ${fyers?.authenticated ? 'ok' : 'err'}`}>
              ● {fyers?.authenticated ? 'Live (until end of day)' : 'Not connected'}
            </span>
          </div>
          {admin && fyers?.configured && (
            <a className="settings-row link" href={fyers.login_url}>
              <span>{fyers.authenticated ? 'Reconnect Fyers' : 'Connect Fyers'}</span>
              <Chevron />
            </a>
          )}
          {admin && fyers?.authenticated && (
            <button className="settings-row link" onClick={() => api.fyersLogout().finally(onFyersChanged)}>
              <span>Disconnect Fyers</span>
              <Chevron />
            </button>
          )}
          {!admin && !fyers?.authenticated && (
            <p className="note pad">An admin needs to connect Fyers for live prices and charts.</p>
          )}
        </div>

        <h2 className="list-heading">Appearance</h2>
        <div className="settings-list">
          <div className="settings-row">
            <span>Theme</span>
            <div className="segmented small" role="group" aria-label="Theme">
              {(
                [
                  ['light', 'Light'],
                  ['dark', 'Dark'],
                  ['system', 'Auto'],
                ] as const
              ).map(([mode, name]) => (
                <button key={mode} className={themeMode === mode ? 'active' : ''} onClick={() => onThemeMode(mode)}>
                  {name}
                </button>
              ))}
            </div>
          </div>
        </div>

        <h2 className="list-heading">Account</h2>
        <div className="settings-list">
          {admin && (
            <button className="settings-row link" onClick={() => setDialog('users')}>
              <span>Manage users &amp; invites</span>
              <Chevron />
            </button>
          )}
          <button className="settings-row link" onClick={() => setDialog('profile')}>
            <span>Profile, notifications &amp; API keys</span>
            <Chevron />
          </button>
          <button className="settings-row link" onClick={() => setDialog('password')}>
            <span>Change password</span>
            <Chevron />
          </button>
          <button className="settings-row link danger" onClick={onSignOut}>
            <span>Sign out</span>
          </button>
        </div>
      </div>

      {dialog === 'users' && <UsersDialog me={user} onClose={() => setDialog(null)} />}
      {dialog === 'password' && <PasswordDialog onClose={() => setDialog(null)} />}
      {dialog === 'profile' && <ProfileDialog me={user} onClose={() => setDialog(null)} />}
    </div>
  )
}

function Chevron() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M5 3l4 4-4 4" />
    </svg>
  )
}
