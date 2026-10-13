import { useEffect, useState } from 'react'
import { api, type ApiKeyInfo, type UserInfo } from '../api/client'
import { Modal } from '../ui/Modal'

/** Your notification settings and API keys (for scripts and agents). */
export function ProfileDialog({ me, onClose }: { me: UserInfo; onClose: () => void }) {
  const [email, setEmail] = useState(me.email ?? '')
  const [chat, setChat] = useState(me.telegram_chat_id ?? '')
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [keys, setKeys] = useState<ApiKeyInfo[]>([])
  const [newKey, setNewKey] = useState<string | null>(null)
  const [keyName, setKeyName] = useState('')

  const loadKeys = () => api.apiKeys().then(setKeys, () => {})
  useEffect(() => {
    loadKeys()
  }, [])

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setNotice(null)
    try {
      await api.updateMe({ email: email || null, set_email: true, telegram_chat_id: chat || null, set_telegram: true })
      setNotice('Saved.')
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <Modal title="Profile & notifications" onClose={onClose} width={560}>
      <form className="form-grid" onSubmit={save}>
        <label>
          <span>Email (alerts)</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          <span>Telegram chat id</span>
          <input value={chat} onChange={(e) => setChat(e.target.value)} placeholder="e.g. 123456789" />
        </label>
        <p className="note">
          For Telegram alerts: open the app’s bot in Telegram (ask the admin for its name), send it any message, then open{' '}
          <code>@userinfobot</code> to see your chat id and paste it here.
        </p>
        {error && <p className="status err">{error}</p>}
        {notice && <p className="status ok">{notice}</p>}
        <button className="primary-button" type="submit">
          Save
        </button>
      </form>

      <h3 className="section-title">API keys</h3>
      <p className="note">
        For your own scripts or AI agents: send <code>Authorization: Bearer &lt;key&gt;</code>. A key acts as you (your
        watchlists, alerts, strategies, signals), so keep it secret.
      </p>
      {newKey && (
        <div className="key-reveal">
          <code>{newKey}</code>
          <button className="secondary-button" onClick={() => navigator.clipboard?.writeText(newKey)}>
            Copy
          </button>
          <p className="note">Copy it now. It won’t be shown again.</p>
        </div>
      )}
      <form
        className="inline-fields"
        onSubmit={async (e) => {
          e.preventDefault()
          const k = await api.createApiKey(keyName || 'API key')
          setNewKey(k.key)
          setKeyName('')
          loadKeys()
        }}
      >
        <input value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder="Key name, e.g. my agent" />
        <button className="secondary-button" type="submit">
          Create key
        </button>
      </form>
      <table className="stats users-table">
        <tbody>
          {keys.map((k) => (
            <tr key={k.id}>
              <td>
                <b>{k.name}</b> <span className="muted">{k.prefix}…</span>
              </td>
              <td className="muted">{k.last_used ? `used ${k.last_used.replace('T', ' ')}` : 'never used'}</td>
              <td className="num">
                <button
                  className="link-button danger"
                  onClick={() => window.confirm(`Revoke "${k.name}"?`) && api.revokeApiKey(k.id).then(loadKeys)}
                >
                  Revoke
                </button>
              </td>
            </tr>
          ))}
          {keys.length === 0 && (
            <tr>
              <td className="muted">No API keys.</td>
            </tr>
          )}
        </tbody>
      </table>
    </Modal>
  )
}
