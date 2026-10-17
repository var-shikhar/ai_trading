import { useState, type ReactNode } from 'react'
import { api, type AuthStatus, type UserInfo } from '../api/client'
import { ProfileDialog } from '../auth/ProfileDialog'
import { Avatar, BrandMark, CheckIcon } from '../auth/shared'
import { errorMessage } from '../auth/util'
import { PasswordDialog, UsersDialog } from '../auth/UsersDialog'
import type { ThemeMode } from '../chart/theme'
import { useToasts } from '../state/ui'
import { Dropdown, MenuHeading, MenuItem, Spinner, cx } from './kit'

// watchlist and account are phone-only pages (desktop shows them in the
// chart's right rail and the nav rail's menus).
export type Page = 'chart' | 'screener' | 'lab' | 'signals' | 'watchlist' | 'account'

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

const pageDef = (id: Page) => PAGES.find((p) => p.id === id)!

/** Sections hidden for now (their code stays): the Strategy Lab. */
export const HIDDEN_PAGES: Page[] = ['lab']
const shown = (list: typeof PAGES) => list.filter((p) => !HIDDEN_PAGES.includes(p.id))

/** Phone tab bar, watchlist first (as in broker apps): a stock opens its
 * chart from the watchlist, screener or signals, with a back arrow. */
export const MOBILE_PAGES: typeof PAGES = [
  {
    id: 'watchlist',
    label: 'Watchlist',
    title: 'Your watchlists with live prices',
    icon: icon(<path d="M4 6h14M4 11h14M4 16h9" />),
  },
  pageDef('screener'),
  { ...pageDef('lab'), label: 'Strategies', short: undefined },
  pageDef('signals'),
  {
    id: 'account',
    label: 'Me',
    title: 'Account, market data and theme',
    icon: icon(
      <>
        <circle cx="11" cy="8" r="3.5" />
        <path d="M4.5 19a6.5 6.5 0 0 1 13 0" />
      </>,
    ),
  },
]

/** Phones held sideways have little height: the nav shows icons only. */
const LOW_HIDE = '[@media(max-width:950px)_and_(max-height:500px)]:hidden'

/** App-level navigation: a rail down the left edge on desktop (the chart is
 * one section; screening, strategy research and signals sit beside it), a
 * bottom tab bar on phones. */
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
  mobile,
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
  mobile: boolean
}) {
  const [accountDialog, setAccountDialog] = useState<'users' | 'password' | 'profile' | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)
  const toast = useToasts((s) => s.push)
  const fyers = auth?.fyers
  const admin = user.role === 'admin'

  if (mobile)
    return (
      <nav aria-label="Sections" className="flex w-full shrink-0 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]">
        {shown(MOBILE_PAGES).map((p) => {
          const active = page === p.id
          return (
            <button
              key={p.id}
              aria-current={active ? 'page' : undefined}
              aria-label={p.label}
              title={p.title}
              onClick={() => onPage(p.id)}
              className={cx(
                'flex h-[60px] min-w-0 flex-1 basis-0 cursor-pointer flex-col items-center justify-center gap-0.5 text-[10.5px] font-medium transition-colors [-webkit-tap-highlight-color:transparent] [@media(max-width:950px)_and_(max-height:500px)]:h-11',
                active ? 'text-accent' : 'text-muted active:text-fg',
              )}
            >
              <span className={cx('flex h-7 w-14 items-center justify-center rounded-full transition-colors', active && 'bg-accent-soft')}>
                {p.icon}
              </span>
              <span className={cx('max-w-full truncate px-1', active && 'font-semibold', LOW_HIDE)}>{p.short ?? p.label}</span>
            </button>
          )
        })}
      </nav>
    )

  const disconnect = () => {
    setDisconnecting(true)
    api
      .fyersLogout()
      .then(
        () => toast('Fyers disconnected'),
        (e) => toast(errorMessage(e), 'err'),
      )
      .finally(() => {
        setDisconnecting(false)
        onFyersChanged()
      })
  }
  const railButton = 'h-auto min-h-10 w-14 flex-col justify-center gap-1 px-1 py-1.5 text-muted hover:text-fg'

  return (
    <nav aria-label="Sections" className="flex h-full w-[68px] shrink-0 flex-col items-center gap-1 border-r border-line bg-surface py-2.5">
      <div className="mb-2 flex h-9 items-center" title="Indicator">
        <BrandMark size={28} />
      </div>
      {shown(PAGES).map((p) => {
        const active = page === p.id
        return (
          <button
            key={p.id}
            aria-current={active ? 'page' : undefined}
            aria-label={p.label}
            title={p.title}
            onClick={() => onPage(p.id)}
            className={cx(
              'relative flex w-[60px] cursor-pointer flex-col items-center gap-1 rounded-lg px-0.5 pt-2 pb-1.5 text-[10.5px] leading-tight font-medium transition-colors',
              active ? 'bg-selected text-accent' : 'text-muted hover:bg-hover hover:text-fg',
            )}
          >
            {active && <span aria-hidden className="absolute inset-y-2 -left-1 w-[3px] rounded-r-full bg-accent" />}
            {p.icon}
            <span className={cx('text-center', LOW_HIDE)}>{p.label}</span>
          </button>
        )
      })}

      <span className="flex-1" />

      {error && (
        <span className="flex flex-col items-center gap-1 py-1" title={`Backend unreachable: ${error}`}>
          <StatusDot tone="err" />
          <span className={cx('text-[10px] text-down', LOW_HIDE)}>Offline</span>
        </span>
      )}
      {!fyers && !error && (
        <span className="py-2" title="Checking market data…">
          <StatusDot tone="pending" />
        </span>
      )}
      {fyers && !admin && (
        <span
          className="flex flex-col items-center gap-1 py-1"
          title={fyers.authenticated ? 'Live market data connected' : 'Market data paused: an admin needs to connect Fyers.'}
        >
          <StatusDot tone={fyers.authenticated ? 'ok' : 'err'} />
          <span className={cx('text-[10px] text-muted', LOW_HIDE)}>{fyers.authenticated ? 'Live' : 'Paused'}</span>
        </span>
      )}
      {fyers && admin && (
        <Dropdown
          align="side"
          caret={false}
          buttonClassName={railButton}
          title={fyers.authenticated ? 'Fyers connected (until end of day)' : 'Fyers not connected'}
          label={
            <>
              {disconnecting ? <Spinner size={10} /> : <StatusDot tone={fyers.authenticated ? 'ok' : 'err'} />}
              <span className={cx('text-[10px]', LOW_HIDE)}>Fyers</span>
            </>
          }
        >
          {(close) => (
            <div className="w-[248px]">
              <MenuHeading>Market data</MenuHeading>
              <div className="flex items-center gap-2 px-2.5 pb-2 text-[13px]">
                <StatusDot tone={fyers.authenticated ? 'ok' : 'err'} />
                {fyers.authenticated ? 'Connected until end of day' : fyers.configured ? 'Not connected' : 'Fyers keys missing'}
              </div>
              {fyers.configured ? (
                <MenuItem href={fyers.login_url}>{fyers.authenticated ? 'Reconnect Fyers' : 'Connect Fyers'}</MenuItem>
              ) : (
                <p className="px-2.5 pb-2 text-[12px] leading-snug text-muted">Add FYERS_APP_ID and FYERS_SECRET to backend/.env.</p>
              )}
              {fyers.authenticated && (
                <MenuItem
                  danger
                  onClick={() => {
                    close()
                    disconnect()
                  }}
                >
                  Disconnect
                </MenuItem>
              )}
            </div>
          )}
        </Dropdown>
      )}

      <Dropdown align="side" caret={false} buttonClassName={cx(railButton, 'min-h-9')} title="Theme" label={<ThemeIcon dark={dark} />}>
        {(close) => (
          <>
            <MenuHeading>Theme</MenuHeading>
            {THEMES.map(([mode, name]) => (
              <MenuItem
                key={mode}
                selected={themeMode === mode}
                onClick={() => {
                  onThemeMode(mode)
                  close()
                }}
              >
                <span className="flex-1">{name}</span>
                {themeMode === mode && <CheckIcon />}
              </MenuItem>
            ))}
          </>
        )}
      </Dropdown>

      <Dropdown
        align="side"
        caret={false}
        buttonClassName={cx(railButton, 'min-h-9')}
        title="Account"
        label={<Avatar name={user.username} size={28} />}
      >
        {(close) => {
          const open = (d: 'users' | 'password' | 'profile') => () => {
            close()
            setAccountDialog(d)
          }
          return (
            <div className="w-[248px]">
              <div className="flex items-center gap-2.5 px-2.5 pt-2 pb-2.5">
                <Avatar name={user.username} size={34} />
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-[14px] font-semibold">{user.username}</span>
                  <span className="truncate text-[12px] text-muted">{admin ? 'Admin' : 'Member'}</span>
                </div>
              </div>
              <div className="mb-1 h-px bg-line" />
              {admin && <MenuItem onClick={open('users')}>Manage users &amp; invites</MenuItem>}
              <MenuItem onClick={open('profile')}>Profile, notifications &amp; API keys</MenuItem>
              <MenuItem onClick={open('password')}>Change password</MenuItem>
              <div className="my-1 h-px bg-line" />
              <MenuItem
                danger
                onClick={() => {
                  close()
                  onSignOut()
                }}
              >
                Sign out
              </MenuItem>
            </div>
          )
        }}
      </Dropdown>

      {accountDialog === 'users' && <UsersDialog me={user} onClose={() => setAccountDialog(null)} />}
      {accountDialog === 'password' && <PasswordDialog onClose={() => setAccountDialog(null)} />}
      {accountDialog === 'profile' && <ProfileDialog me={user} onClose={() => setAccountDialog(null)} />}
    </nav>
  )
}

const THEMES = [
  ['dark', 'Dark'],
  ['light', 'Light'],
  ['system', 'Same as device'],
] as const satisfies readonly (readonly [ThemeMode, string])[]

/** Connection status: green (live), red (off), grey pulse (checking). */
export function StatusDot({ tone }: { tone: 'ok' | 'err' | 'pending' }) {
  return (
    <span
      aria-hidden
      className={cx(
        'inline-block size-2.5 shrink-0 rounded-full',
        tone === 'ok' && 'bg-up shadow-[0_0_0_3px_var(--ok-soft)]',
        tone === 'err' && 'bg-down shadow-[0_0_0_3px_var(--err-soft)]',
        tone === 'pending' && 'animate-pulse bg-line',
      )}
    />
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
