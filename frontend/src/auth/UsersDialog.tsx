import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { api, type UserInfo } from '../api/client'
import { useToasts } from '../state/ui'
import { Badge, Button, EmptyState, ErrorText, Field, Input, Modal, Select, Skeleton, Switch, cx } from '../ui/kit'
import { InvitesSection } from './InvitesSection'
import { PasswordInput } from './LoginPage'
import { SESSION_KEY, USERS_KEY, useOptimisticList, useUsers } from './queries'
import { Avatar, CheckIcon, ConfirmDialog, ListCard, SectionTitle } from './shared'
import { errorMessage, formatWhen, useEscapeFirst } from './util'

type Patch = { role?: 'admin' | 'user'; disabled?: boolean; email?: string | null; set_email?: boolean }
const EMPTY_FORM = { username: '', password: '', email: '', role: 'user' as 'user' | 'admin' }

/** Admin: invite people, create accounts and manage existing ones. */
export function UsersDialog({ me, onClose }: { me: UserInfo; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToasts((s) => s.push)
  const users = useUsers()
  const [form, setForm] = useState(EMPTY_FORM)
  const [showCreate, setShowCreate] = useState(false)
  const [action, setAction] = useState<{ kind: 'delete' | 'email' | 'password'; user: UserInfo } | null>(null)

  const update = useOptimisticList<UserInfo, { username: string; patch: Patch; done: string }>(
    USERS_KEY,
    ({ username, patch }) =>
      api.updateUser(username, patch).then((u) => {
        // Your own row edits your session too (email shown in the profile).
        if (u.username === me.username) qc.setQueryData(SESSION_KEY, (s: UserInfo | null | undefined) => (s ? { ...s, ...u } : s))
        return u
      }),
    (list, { username, patch }) =>
      list.map((u) =>
        u.username !== username
          ? u
          : {
              ...u,
              ...(patch.role && { role: patch.role }),
              ...(patch.disabled !== undefined && { disabled: patch.disabled }),
              ...(patch.set_email && { email: patch.email ?? null }),
            },
      ),
    ({ done }) => toast(done),
  )
  const remove = useOptimisticList<UserInfo, string>(
    USERS_KEY,
    (username) => api.deleteUser(username),
    (list, username) => list.filter((u) => u.username !== username),
    (username) => toast(`${username} deleted`),
  )
  const patch = (u: UserInfo, p: Patch, done: string) =>
    update.mutate({ username: u.username, patch: p, done }, { onError: (e) => toast(errorMessage(e), 'err') })

  const create = useMutation({
    mutationFn: () => api.createUser({ ...form, username: form.username.trim(), email: form.email.trim() || null }),
    onSuccess: (u) => {
      toast(`Created ${u.username}`)
      setForm(EMPTY_FORM)
      setShowCreate(false)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: USERS_KEY }),
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!create.isPending) create.mutate()
  }

  const list = users.data ?? []

  return (
    <Modal title="Users & invites" onClose={onClose} width={760}>
      <InvitesSection />

      <SectionTitle
        action={
          !showCreate && (
            <Button size="sm" variant="ghost" onClick={() => setShowCreate(true)}>
              + Create account
            </Button>
          )
        }
      >
        Accounts {users.data && <span className="font-normal text-muted">· {list.length}</span>}
      </SectionTitle>

      {showCreate && (
        <form onSubmit={submit} className="mb-4 flex flex-col gap-3 rounded-xl border border-line bg-bg p-4">
          <p className="text-[13px] text-muted">
            Create an account directly and share the password with them; they can change it from the account menu.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Username">
              <Input
                required
                autoFocus
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                placeholder="e.g. asha"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
              />
            </Field>
            <Field label="Password" hint="At least 8 characters">
              <Input
                required
                type="password"
                minLength={8}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                autoComplete="new-password"
              />
            </Field>
            <Field label="Email (optional)">
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label="Role">
              <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as 'user' | 'admin' })}>
                <option value="user">User</option>
                <option value="admin">Admin (can manage users)</option>
              </Select>
            </Field>
          </div>
          <ErrorText>{create.error && errorMessage(create.error)}</ErrorText>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setShowCreate(false)
                create.reset()
              }}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={create.isPending}>
              Create account
            </Button>
          </div>
        </form>
      )}

      {users.isPending ? (
        <ListCard>
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <Skeleton className="size-9 rounded-full" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-2.5 w-48" />
              </div>
              <Skeleton className="h-5 w-9 rounded-full" />
            </div>
          ))}
        </ListCard>
      ) : users.isError ? (
        <div className="flex flex-col items-start gap-2">
          <ErrorText>{errorMessage(users.error)}</ErrorText>
          <Button size="sm" onClick={() => users.refetch()} loading={users.isFetching}>
            Try again
          </Button>
        </div>
      ) : list.length === 0 ? (
        <EmptyState title="No accounts yet" />
      ) : (
        <ListCard>
          {list.map((u) => {
            const self = u.username === me.username
            return (
              <div key={u.username} className={cx('flex flex-col gap-2 px-4 py-3 transition', u.disabled && 'bg-bg')}>
                <div className="flex items-center gap-3">
                  <Avatar name={u.username} size={36} className={cx(u.disabled && 'opacity-40 grayscale')} />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={cx('truncate text-[14px] font-semibold', u.disabled && 'text-muted line-through')}>
                        {u.username}
                      </span>
                      {self && <Badge>you</Badge>}
                      {u.role === 'admin' && <Badge tone="accent">admin</Badge>}
                      {u.disabled && <Badge tone="down">disabled</Badge>}
                    </div>
                    <span className="truncate text-[12px] text-muted">
                      {u.email ?? 'no email'} · {u.last_login ? `last sign-in ${formatWhen(u.last_login)}` : 'never signed in'}
                    </span>
                  </div>
                  {!self && (
                    <Switch
                      checked={!u.disabled}
                      onChange={(on) => patch(u, { disabled: !on }, on ? `${u.username} enabled` : `${u.username} disabled and signed out`)}
                      label={<span className="text-[12px] text-muted max-sm:sr-only">{u.disabled ? 'Disabled' : 'Active'}</span>}
                    />
                  )}
                </div>
                <div className="-ml-2 flex flex-wrap gap-0.5 sm:pl-12">
                  {!self && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        patch(
                          u,
                          { role: u.role === 'admin' ? 'user' : 'admin' },
                          `${u.username} is now ${u.role === 'admin' ? 'a user' : 'an admin'}`,
                        )
                      }
                    >
                      {u.role === 'admin' ? 'Make user' : 'Make admin'}
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setAction({ kind: 'email', user: u })}>
                    Edit email
                  </Button>
                  {/* Your own password: Change password (resetting it here would end your session). */}
                  {!self && (
                    <Button size="sm" variant="ghost" onClick={() => setAction({ kind: 'password', user: u })}>
                      Reset password
                    </Button>
                  )}
                  {!self && (
                    <Button size="sm" variant="ghost" className="text-down hover:text-down" onClick={() => setAction({ kind: 'delete', user: u })}>
                      Delete
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </ListCard>
      )}
      <p className="mt-4 text-[12px] leading-relaxed text-muted">
        Each user has their own watchlists, drawings, alerts, strategies and backtests. Market data comes from the one shared
        Fyers connection that admins connect.
      </p>

      {action?.kind === 'delete' && (
        <ConfirmDialog
          title={`Delete ${action.user.username}?`}
          confirmLabel="Delete account"
          onConfirm={() => remove.mutateAsync(action.user.username)}
          onClose={() => setAction(null)}
        >
          They lose access immediately, along with their watchlists, alerts and strategies. This can't be undone.
        </ConfirmDialog>
      )}
      {action?.kind === 'email' && (
        <EmailDialog
          user={action.user}
          onClose={() => setAction(null)}
          onSave={(email) =>
            update.mutateAsync({
              username: action.user.username,
              patch: { email: email || null, set_email: true },
              done: email ? 'Email updated' : 'Email removed',
            })
          }
        />
      )}
      {action?.kind === 'password' && (
        <ResetPasswordDialog
          user={action.user}
          onClose={() => setAction(null)}
          onDone={() => toast(`Password reset for ${action.user.username}`)}
        />
      )}
    </Modal>
  )
}

function EmailDialog({ user, onSave, onClose }: { user: UserInfo; onSave: (email: string) => Promise<unknown>; onClose: () => void }) {
  const [email, setEmail] = useState(user.email ?? '')
  const save = useMutation({ mutationFn: () => onSave(email.trim()), onSuccess: onClose })
  useEscapeFirst(onClose)
  return (
    <Modal title={`Email for ${user.username}`} onClose={onClose} width={420}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (!save.isPending) save.mutate()
        }}
      >
        <Field label="Email" hint="Used for alerts. Leave empty to remove it.">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
        </Field>
        <ErrorText>{save.error && errorMessage(save.error)}</ErrorText>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={save.isPending}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function ResetPasswordDialog({ user, onDone, onClose }: { user: UserInfo; onDone: () => void; onClose: () => void }) {
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const reset = useMutation({
    mutationFn: () => api.resetUserPassword(user.username, password),
    onSuccess: () => {
      onDone()
      onClose()
    },
  })
  useEscapeFirst(onClose)
  return (
    <Modal title={`Reset password for ${user.username}`} onClose={onClose} width={420}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (!reset.isPending) reset.mutate()
        }}
      >
        <p className="text-[13px] text-muted">They'll be signed out everywhere and need the new password to sign in.</p>
        <Field label="New password" hint="At least 8 characters">
          <PasswordInput value={password} onChange={setPassword} show={show} onShow={setShow} autoComplete="new-password" minLength={8} />
        </Field>
        <ErrorText>{reset.error && errorMessage(reset.error)}</ErrorText>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" loading={reset.isPending}>
            Reset password
          </Button>
        </div>
      </form>
    </Modal>
  )
}

/** Any user: change your own password (other devices get signed out). */
export function PasswordDialog({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [show, setShow] = useState(false)
  const [mismatch, setMismatch] = useState(false)
  const change = useMutation({ mutationFn: () => api.changePassword(current, next) })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (change.isPending) return
    if (next !== repeat) return setMismatch(true)
    setMismatch(false)
    change.mutate()
  }

  return (
    <Modal title="Change password" onClose={onClose} width={420}>
      {change.isSuccess ? (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-up-soft text-up">
            <CheckIcon size={22} />
          </div>
          <p className="text-[15px] font-semibold">Password changed</p>
          <p className="text-[13px] text-muted">Other devices were signed out.</p>
          <Button variant="primary" className="mt-2 min-w-32" onClick={onClose} autoFocus>
            Done
          </Button>
        </div>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <Field label="Current password">
            <PasswordInput value={current} onChange={setCurrent} show={show} onShow={setShow} autoComplete="current-password" />
          </Field>
          <Field label="New password" hint="At least 8 characters">
            <Input
              type={show ? 'text' : 'password'}
              required
              minLength={8}
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoComplete="new-password"
            />
          </Field>
          <Field label="Repeat new password">
            <Input
              type={show ? 'text' : 'password'}
              required
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
              autoComplete="new-password"
            />
          </Field>
          <ErrorText>{mismatch ? "New passwords don't match" : change.error && errorMessage(change.error)}</ErrorText>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={change.isPending}>
              Change password
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}
