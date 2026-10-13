import { useEffect, useState } from 'react'
import { api, type InviteInfo } from '../api/client'

/** Admin: create one-time invite links and see who used them. */
export function InvitesSection() {
  const [invites, setInvites] = useState<InviteInfo[]>([])
  const [form, setForm] = useState({ email: '', role: 'user' as 'user' | 'admin', days: 7, note: '' })
  const [link, setLink] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = () => api.invites().then(setInvites, (e: Error) => setError(e.message))
  useEffect(() => {
    reload()
  }, [])

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      const inv = await api.createInvite({ ...form, email: form.email || null, note: form.note || null })
      setLink(`${window.location.origin}/signup?code=${encodeURIComponent(inv.code)}`)
      setForm({ email: '', role: 'user', days: 7, note: '' })
      reload()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <section className="user-create">
      <h3>Invite a friend</h3>
      <p className="note">
        Only people with an invite link can sign up. Each link works once and expires. Lock it to an email to make sure
        only that person can use it.
      </p>
      <form className="form-row" onSubmit={create}>
        <label>
          <span>Email (optional)</span>
          <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </label>
        <label>
          <span>Note</span>
          <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="e.g. Rahul" />
        </label>
        <label>
          <span>Valid for</span>
          <select value={form.days} onChange={(e) => setForm({ ...form, days: Number(e.target.value) })}>
            {[1, 3, 7, 14, 30].map((d) => (
              <option key={d} value={d}>
                {d} day{d > 1 ? 's' : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Role</span>
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as 'user' | 'admin' })}>
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <button className="primary-button" type="submit">
          Create invite link
        </button>
      </form>
      {link && (
        <div className="key-reveal">
          <code>{link}</code>
          <button className="secondary-button" type="button" onClick={() => navigator.clipboard?.writeText(link)}>
            Copy
          </button>
          <p className="note">Send this link to your friend. It's shown only once.</p>
        </div>
      )}
      {error && <p className="status err">{error}</p>}
      {invites.length > 0 && (
        <table className="stats users-table">
          <thead>
            <tr>
              <th>Invite</th>
              <th>For</th>
              <th>Status</th>
              <th>Expires</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {invites.map((i) => (
              <tr key={i.id} className={i.status === 'open' ? '' : 'faded'}>
                <td>
                  <code>{i.prefix}…</code> {i.note && <span className="muted">{i.note}</span>}
                </td>
                <td>{i.email ?? <span className="muted">anyone with the link</span>}</td>
                <td>{i.status === 'used' ? `used by ${i.used_by}` : i.status}</td>
                <td>{i.expires.slice(0, 10)}</td>
                <td className="num">
                  {i.status === 'open' && (
                    <button className="link-button danger" onClick={() => api.revokeInvite(i.id).then(reload)}>
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
