import { useEffect, useState } from 'react'
import { api, type UserInfo } from '../api/client'
import { Modal } from '../ui/Modal'
import { InvitesSection } from './InvitesSection'

/** Admin: create accounts and manage existing ones (there is no sign-up). */
export function UsersDialog({ me, onClose }: { me: UserInfo; onClose: () => void }) {
  const [users, setUsers] = useState<UserInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [form, setForm] = useState({ username: '', password: '', email: '', role: 'user' as 'user' | 'admin' })

  const reload = () => api.users().then(setUsers, (e: Error) => setError(e.message))
  useEffect(() => {
    reload()
  }, [])

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setError(null)
    setNotice(null)
    try {
      await fn()
      setNotice(done)
      await reload()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const create = (e: React.FormEvent) => {
    e.preventDefault()
    act(async () => {
      await api.createUser({ ...form, email: form.email || null })
      setForm({ username: '', password: '', email: '', role: 'user' })
    }, `Created ${form.username.toLowerCase()}. Share the password with them; they can change it from the account menu.`)
  }

  const resetPassword = (u: UserInfo) => {
    const password = window.prompt(`New password for ${u.username} (min 8 characters). They'll be signed out.`)
    if (password) act(() => api.resetUserPassword(u.username, password), `Password reset for ${u.username}.`)
  }

  const editEmail = (u: UserInfo) => {
    const email = window.prompt(`Email for ${u.username} (leave empty to remove)`, u.email ?? '')
    if (email !== null) act(() => api.updateUser(u.username, { email: email || null, set_email: true }), 'Email updated.')
  }

  return (
    <Modal title="Manage users" onClose={onClose} width={760}>
      <InvitesSection />

      <form className="user-create" onSubmit={create}>
        <h3>Or create an account directly</h3>
        <div className="form-row">
          <label>
            <span>Username</span>
            <input
              required
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              placeholder="e.g. asha"
              autoComplete="off"
            />
          </label>
          <label>
            <span>Password</span>
            <input
              required
              type="password"
              minLength={8}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              autoComplete="new-password"
            />
          </label>
          <label>
            <span>Email (optional)</span>
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </label>
          <label>
            <span>Role</span>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as 'user' | 'admin' })}>
              <option value="user">User</option>
              <option value="admin">Admin (can manage users)</option>
            </select>
          </label>
        </div>
        <button className="primary-button" type="submit">
          Create account
        </button>
      </form>

      {error && (
        <p className="status err" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="status ok">{notice}</p>}

      <table className="stats users-table">
        <thead>
          <tr>
            <th>User</th>
            <th>Role</th>
            <th>Email</th>
            <th>Last sign-in</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {users?.map((u) => {
            const self = u.username === me.username
            return (
              <tr key={u.username} className={u.disabled ? 'faded' : ''}>
                <td>
                  <b>{u.username}</b>
                  {self && <span className="muted"> (you)</span>}
                </td>
                <td>{u.role}</td>
                <td>{u.email ?? <span className="muted">–</span>}</td>
                <td>{u.last_login ? u.last_login.replace('T', ' ') : <span className="muted">never</span>}</td>
                <td>{u.disabled ? 'disabled' : 'active'}</td>
                <td className="num user-actions">
                  {!self && (
                    <button
                      className="link-button"
                      onClick={() =>
                        act(
                          () => api.updateUser(u.username, { role: u.role === 'admin' ? 'user' : 'admin' }),
                          `${u.username} is now ${u.role === 'admin' ? 'a user' : 'an admin'}.`,
                        )
                      }
                    >
                      {u.role === 'admin' ? 'Make user' : 'Make admin'}
                    </button>
                  )}
                  {!self && (
                    <button
                      className="link-button"
                      onClick={() =>
                        act(
                          () => api.updateUser(u.username, { disabled: !u.disabled }),
                          u.disabled ? `${u.username} enabled.` : `${u.username} disabled and signed out.`,
                        )
                      }
                    >
                      {u.disabled ? 'Enable' : 'Disable'}
                    </button>
                  )}
                  <button className="link-button" onClick={() => editEmail(u)}>
                    Email
                  </button>
                  <button className="link-button" onClick={() => resetPassword(u)}>
                    Reset password
                  </button>
                  {!self && (
                    <button
                      className="link-button danger"
                      onClick={() =>
                        window.confirm(`Delete ${u.username}? They lose access immediately.`) &&
                        act(() => api.deleteUser(u.username), `${u.username} deleted.`)
                      }
                    >
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="note">
        Each user has their own watchlists, drawings, alerts, strategies and backtests. Market data comes from the one
        shared Fyers connection that admins connect.
      </p>
    </Modal>
  )
}

/** Any user: change your own password (other devices get signed out). */
export function PasswordDialog({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (next !== repeat) return setError("New passwords don't match")
    setError(null)
    try {
      await api.changePassword(current, next)
      setDone(true)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <Modal title="Change password" onClose={onClose} width={380}>
      {done ? (
        <p className="status ok">Password changed. Other devices were signed out.</p>
      ) : (
        <form className="form-grid" onSubmit={submit}>
          <label>
            <span>Current password</span>
            <input type="password" required value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
          </label>
          <label>
            <span>New password</span>
            <input type="password" required minLength={8} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
          </label>
          <label>
            <span>Repeat new password</span>
            <input type="password" required value={repeat} onChange={(e) => setRepeat(e.target.value)} autoComplete="new-password" />
          </label>
          {error && <p className="status err">{error}</p>}
          <button className="primary-button" type="submit">
            Change password
          </button>
        </form>
      )}
    </Modal>
  )
}
