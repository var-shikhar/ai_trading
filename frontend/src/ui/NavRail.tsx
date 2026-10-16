import { useState, type ReactNode } from 'react'
import { api, type AuthStatus, type UserInfo } from '../api/client'
import { PasswordDialog, UsersDialog } from '../auth/UsersDialog'
import { ProfileDialog } from '../auth/ProfileDialog'
import type { ThemeMode } from '../chart/theme'
import { Dropdown } from './Dropdown'

export type Page = 'chart' | 'screener' | 'lab' | 'signals'

const icon = (d: ReactNode) => (
  <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
    {d}
  </svg>
)

export const PAGES: { id: Page; label: string; short?: string; title: string; icon: ReactNode }[] = [
  {
    id: 'chart',
    label: 'Charts',
    title: 'Charts, indicators, drawings and the strategy on the chart',
    icon: icon(
      <>
        <path d="M7 3v3M7 15v4M15 5v3M15 16v2" />
        <rect x="5" y="6" width="4" height="9" rx=".6" />
        <rect x="13" y="8" width="4" height="8" rx=".6" />
      </>,
    ),
  },
  {
    id: 'screener',
    label: 'Screener',
    title: 'Scan a list of stocks for setups',
    icon: icon(<path d="M3 5h16l-6 7v5l-4 2v-7z" />),
  },
  {
    id: 'lab',
    label: 'Strategy Lab',
    short: 'Lab',
    title: 'Backtest strategies over many symbols; saved results',
    icon: icon(
      <>
        <path d="M8.5 3h5M9.5 3v5L4.5 17a1.5 1.5 0 0 0 1.3 2.2h10.4a1.5 1.5 0 0 0 1.3-2.2L12.5 8V3" />
        <path d="M7 13h8" />
      </>,
    ),
  },
  {
    id: 'signals',
    label: 'Signals',
    title: 'Signals from alerts, scans and (later) agents',
    icon: icon(<path d="M12 2L5 12.5h5.5L9.5 20 17 9.5h-5.5z" />),
  },
]

/** App-level navigation down the left edge: the chart is one section of the
 * app; screening, strategy research and signals sit beside it. */
export function NavRail({
  page,
  onPage,
  user,
  onSignOut,
  auth,
  error,
  onFyersChanged,
  themeMode,
  onThemeMode,
  dark,
}: {
  page: Page
  onPage: (p: Page) => void
  user: UserInfo
  onSignOut: () => void
  auth: AuthStatus | null
  error: string | null
  onFyersChanged: () => void
  themeMode: ThemeMode
  onThemeMode: (m: ThemeMode) => void
  dark: boolean
}) {
  const [accountDialog, setAccountDialog] = useState<'users' | 'password' | 'profile' | null>(null)
  const fyers = auth?.fyers
  const admin = user.role === 'admin'
  const item = (label: string, onClick: () => void, close: () => void) => (
    <div className="menu-item">
      <button
        className="menu-main"
        onClick={() => {
          close()
          onClick()
        }}
      >
        {label}
      </button>
    </div>
  )

  return (
    <nav className="nav-rail" aria-label="Sections">
      <div className="nav-brand" title="Indicator">
        <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden>
          <rect width="26" height="26" rx="7" fill="var(--accent)" />
          <path d="M6 17l4.5-5 3.5 3 6-7" fill="none" stroke="var(--accent-fg)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      {PAGES.map((p) => (
        <button
          key={p.id}
          className={`nav-item ${page === p.id ? 'active' : ''}`}
          aria-current={page === p.id ? 'page' : undefined}
          title={p.title}
          onClick={() => onPage(p.id)}
        >
          {p.icon}
          <span className="nav-label">{p.label}</span>
          {p.short && <span className="nav-label short">{p.short}</span>}
        </button>
      ))}

      <span className="spacer" />

      {error && (
        <span className="nav-dot err" title="Backend unreachable">
          ●
        </span>
      )}
      {fyers && !admin && (
        <span
          className={`nav-dot ${fyers.authenticated ? 'ok' : 'err'}`}
          title={fyers.authenticated ? 'Live market data connected' : 'Market data paused: an admin needs to connect Fyers.'}
        >
          ●<small>{fyers.authenticated ? 'Live' : 'Paused'}</small>
        </span>
      )}
      {fyers && admin && (
        <Dropdown
          align="side"
          className="nav-dropdown"
          title={fyers.authenticated ? 'Fyers connected (until end of day)' : 'Fyers not connected'}
          label={
            <span className={`nav-dot ${fyers.authenticated ? 'ok' : 'err'}`}>
              ●<small>Fyers</small>
            </span>
          }
        >
          {(close) => (
            <div className="menu-list">
              <div className="menu-heading">
                {fyers.authenticated ? 'Fyers connected until end of day' : fyers.configured ? 'Fyers not connected' : 'Fyers keys missing'}
              </div>
              {fyers.configured ? (
                <div className="menu-item">
                  <a className="menu-main" href={fyers.login_url}>
                    {fyers.authenticated ? 'Reconnect Fyers' : 'Connect Fyers'}
                  </a>
                </div>
              ) : (
                <p className="note pad">Add FYERS_APP_ID and FYERS_SECRET to backend/.env.</p>
              )}
              {fyers.authenticated && item('Disconnect', () => api.fyersLogout().finally(onFyersChanged), close)}
            </div>
          )}
        </Dropdown>
      )}

      <Dropdown align="side" className="nav-dropdown" title="Theme" label={<ThemeIcon dark={dark} />}>
        {(close) => (
          <div className="menu-list">
            <div className="menu-heading">Theme</div>
            {(
              [
                ['dark', 'Dark'],
                ['light', 'Light'],
                ['system', 'Same as Windows'],
              ] as const
            ).map(([mode, name]) => (
              <div key={mode} className={`menu-item ${themeMode === mode ? 'selected' : ''}`}>
                <button
                  className="menu-main"
                  onClick={() => {
                    onThemeMode(mode)
                    close()
                  }}
                >
                  {name}
                </button>
              </div>
            ))}
          </div>
        )}
      </Dropdown>

      <Dropdown
        align="side"
        className="nav-dropdown"
        title="Account"
        label={<span className="user-chip">{user.username.slice(0, 1).toUpperCase()}</span>}
      >
        {(close) => (
          <div className="menu-list">
            <div className="menu-heading">
              Signed in as {user.username}
              {admin ? ' · admin' : ''}
            </div>
            {admin && item('Manage users & invites', () => setAccountDialog('users'), close)}
            {item('Profile, notifications & API keys', () => setAccountDialog('profile'), close)}
            {item('Change password', () => setAccountDialog('password'), close)}
            {item('Sign out', onSignOut, close)}
          </div>
        )}
      </Dropdown>

      {accountDialog === 'users' && <UsersDialog me={user} onClose={() => setAccountDialog(null)} />}
      {accountDialog === 'password' && <PasswordDialog onClose={() => setAccountDialog(null)} />}
      {accountDialog === 'profile' && <ProfileDialog me={user} onClose={() => setAccountDialog(null)} />}
    </nav>
  )
}

function ThemeIcon({ dark }: { dark: boolean }) {
  return dark ? (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <path d="M14.5 11.5A6 6 0 0 1 6.5 3.5a6 6 0 1 0 8 8z" />
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <circle cx="9" cy="9" r="3.2" />
      <path d="M9 1.5v2M9 14.5v2M1.5 9h2M14.5 9h2M3.7 3.7l1.4 1.4M12.9 12.9l1.4 1.4M3.7 14.3l1.4-1.4M12.9 5.1l1.4-1.4" />
    </svg>
  )
}
