import { useState, type ReactNode } from 'react'
import { api, type AuthStatus, type UserInfo } from '../api/client'
import { ProfileDialog } from '../auth/ProfileDialog'
import { useSession } from '../auth/queries'
import { Avatar, ConfirmDialog } from '../auth/shared'
import { PasswordDialog, UsersDialog } from '../auth/UsersDialog'
import type { ThemeMode } from '../chart/theme'
import { useToasts } from '../state/ui'
import { Badge, Segmented, Skeleton, cx } from './kit'
import { StatusDot } from './NavRail'

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
  const [dialog, setDialog] = useState<'users' | 'password' | 'profile' | 'signout' | 'disconnect' | null>(null)
  const toast = useToasts((s) => s.push)
  const me = useSession().data ?? user
  const fyers = auth?.fyers
  const admin = me.role === 'admin'
  const close = () => setDialog(null)

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-bg">
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-6 px-4 pt-5 pb-10">
        <div className="flex items-center gap-4 rounded-2xl border border-line bg-surface p-4 shadow-card">
          <Avatar name={me.username} size={56} className="shadow-card" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h1 className="truncate text-[19px] leading-tight font-bold">{me.username}</h1>
            <div className="flex min-w-0 items-center gap-2">
              <Badge tone={admin ? 'accent' : 'neutral'}>{admin ? 'Admin' : 'Member'}</Badge>
              {me.email && <span className="truncate text-[12px] text-muted">{me.email}</span>}
            </div>
          </div>
        </div>

        <Group title="Market data">
          <Row
            icon={<PulseIcon />}
            label="Fyers"
            sub={
              !fyers
                ? undefined
                : fyers.authenticated
                  ? 'Live until end of day'
                  : admin && !fyers.configured
                    ? 'Add FYERS_APP_ID and FYERS_SECRET to backend/.env'
                    : admin
                      ? 'Connect for live prices and charts'
                      : 'An admin needs to connect Fyers for live prices'
            }
            right={
              fyers ? (
                <span className={cx('flex items-center gap-2 text-[13px] font-medium', fyers.authenticated ? 'text-up' : 'text-down')}>
                  <StatusDot tone={fyers.authenticated ? 'ok' : 'err'} />
                  {fyers.authenticated ? 'Live' : 'Off'}
                </span>
              ) : (
                <Skeleton className="h-4 w-14" />
              )
            }
          />
          {admin && fyers?.configured && (
            <Row href={fyers.login_url} icon={<PlugIcon />} label={fyers.authenticated ? 'Reconnect Fyers' : 'Connect Fyers'} chevron />
          )}
          {admin && fyers?.authenticated && (
            <Row icon={<UnplugIcon />} label="Disconnect Fyers" danger onClick={() => setDialog('disconnect')} />
          )}
        </Group>

        <Group title="Appearance">
          <Row
            icon={<ThemeIcon />}
            label="Theme"
            right={
              <Segmented
                size="sm"
                value={themeMode}
                onChange={onThemeMode}
                options={[
                  ['light', 'Light'],
                  ['dark', 'Dark'],
                  ['system', 'Auto'],
                ]}
              />
            }
          />
        </Group>

        <Group title="Account">
          {admin && <Row icon={<UsersIcon />} label="Users & invites" sub="Invite friends, manage accounts" chevron onClick={() => setDialog('users')} />}
          <Row icon={<BellIcon />} label="Profile & notifications" sub="Email, Telegram and API keys" chevron onClick={() => setDialog('profile')} />
          <Row icon={<KeyIcon />} label="Change password" chevron onClick={() => setDialog('password')} />
        </Group>

        <Group>
          <Row label={<span className="w-full text-center">Sign out</span>} danger onClick={() => setDialog('signout')} />
        </Group>
      </div>

      {dialog === 'users' && <UsersDialog me={me} onClose={close} />}
      {dialog === 'password' && <PasswordDialog onClose={close} />}
      {dialog === 'profile' && <ProfileDialog me={me} onClose={close} />}
      {dialog === 'signout' && (
        <ConfirmDialog
          title="Sign out?"
          confirmLabel="Sign out"
          onConfirm={onSignOut}
          onClose={close}
        >
          You'll need your username and password to sign in again on this device.
        </ConfirmDialog>
      )}
      {dialog === 'disconnect' && (
        <ConfirmDialog
          title="Disconnect Fyers?"
          confirmLabel="Disconnect"
          onConfirm={async () => {
            try {
              await api.fyersLogout()
              toast('Fyers disconnected')
            } finally {
              onFyersChanged()
            }
          }}
          onClose={close}
        >
          Live prices and charts stop for every user until an admin connects again.
        </ConfirmDialog>
      )}
    </div>
  )
}

function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      {title && <h2 className="px-1 text-[12px] font-semibold tracking-wider text-muted uppercase">{title}</h2>}
      <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card [&>*+*]:border-t [&>*+*]:border-line">
        {children}
      </div>
    </section>
  )
}

/** A settings row: a link, a button, or a static row with a control on the right. */
function Row({
  icon,
  label,
  sub,
  right,
  chevron,
  danger,
  onClick,
  href,
}: {
  icon?: ReactNode
  label: ReactNode
  sub?: ReactNode
  right?: ReactNode
  chevron?: boolean
  danger?: boolean
  onClick?: () => void
  href?: string
}) {
  const body = (
    <>
      {icon && (
        <span
          className={cx(
            'flex size-8 shrink-0 items-center justify-center rounded-lg',
            danger ? 'bg-down-soft text-down' : 'bg-accent-soft text-accent',
          )}
        >
          {icon}
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cx('flex text-[15px] font-medium', danger ? 'text-down' : 'text-fg')}>{label}</span>
        {sub && <span className="truncate text-[12px] text-muted">{sub}</span>}
      </span>
      {right}
      {chevron && <Chevron />}
    </>
  )
  const cls = 'flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left'
  const interactive = 'cursor-pointer transition-colors hover:bg-hover active:bg-hover [-webkit-tap-highlight-color:transparent]'
  if (href)
    return (
      <a href={href} className={cx(cls, interactive, 'text-fg no-underline')}>
        {body}
      </a>
    )
  if (onClick)
    return (
      <button type="button" onClick={onClick} className={cx(cls, interactive)}>
        {body}
      </button>
    )
  return <div className={cls}>{body}</div>
}

const ico = (d: ReactNode) => (
  <svg width="17" height="17" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {d}
  </svg>
)
const PulseIcon = () => ico(<path d="M1.5 9h3l2-5 4 10 2-5h4" />)
const PlugIcon = () => ico(<path d="M6 2v4M12 2v4M4 6h10v3a5 5 0 0 1-10 0zM9 14v2.5" />)
const UnplugIcon = () => ico(<path d="M6 2v4M12 2v4M4 6h10v3a5 5 0 0 1-10 0zM9 14v2.5M2 2l14 14" />)
const ThemeIcon = () => ico(<path d="M14.5 11.5A6 6 0 0 1 6.5 3.5a6 6 0 1 0 8 8z" />)
const UsersIcon = () =>
  ico(
    <>
      <circle cx="7" cy="6" r="2.8" />
      <path d="M1.8 15.5a5.2 5.2 0 0 1 10.4 0M12 3.4a2.8 2.8 0 0 1 0 5.2M13.5 10.6a5.2 5.2 0 0 1 2.7 4.9" />
    </>,
  )
const BellIcon = () => ico(<path d="M4.5 12.5V8a4.5 4.5 0 0 1 9 0v4.5l1.5 1.5H3zM7.5 16h3" />)
const KeyIcon = () =>
  ico(
    <>
      <circle cx="6" cy="12" r="3.5" />
      <path d="M8.5 9.5L15 3M12.5 5.5l2 2" />
    </>,
  )

function Chevron() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden className="shrink-0 text-muted">
      <path d="M5 3l4 4-4 4" />
    </svg>
  )
}
