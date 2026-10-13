import { useEffect, useState } from 'react'
import { api, ApiError } from '../api/client'

/** /signup?code=...: create an account with an invite (no open registration). */
export function SignupPage() {
  const code = new URLSearchParams(window.location.search).get('code') ?? ''
  const [invite, setInvite] = useState<{ email: string | null; expires: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(true)
  const [form, setForm] = useState({ username: '', password: '', repeat: '', email: '' })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!code) {
      setError('This page needs an invite link. Ask the admin for one.')
      setChecking(false)
      return
    }
    api
      .checkInvite(code)
      .then((i) => {
        setInvite(i)
        if (i.email) setForm((f) => ({ ...f, email: i.email ?? '' }))
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setChecking(false))
  }, [code])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (form.password !== form.repeat) return setError("Passwords don't match")
    setBusy(true)
    setError(null)
    try {
      await api.signup({ code, username: form.username, password: form.password, email: form.email || null })
      window.location.replace('/') // signed in: open the app
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server')
      setBusy(false)
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <h1>Indicator</h1>
        <p className="muted">Create your account</p>
        {checking && <p className="status">Checking your invite…</p>}
        {!checking && invite && (
          <>
            <label>
              <span>Username</span>
              <input
                autoFocus
                required
                autoComplete="username"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                placeholder="3-32 letters, digits, . _ -"
              />
            </label>
            <label>
              <span>Email{invite.email ? ' (from your invite)' : ' (optional, for alerts)'}</span>
              <input
                type="email"
                value={form.email}
                readOnly={!!invite.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </label>
            <label>
              <span>Password (min 8 characters)</span>
              <input
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </label>
            <label>
              <span>Repeat password</span>
              <input
                type="password"
                required
                autoComplete="new-password"
                value={form.repeat}
                onChange={(e) => setForm({ ...form, repeat: e.target.value })}
              />
            </label>
          </>
        )}
        {error && (
          <p className="status err" role="alert">
            {error}
          </p>
        )}
        {invite && (
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create account'}
          </button>
        )}
        <p className="note">
          Already have an account? <a href="/">Sign in</a>
        </p>
      </form>
    </div>
  )
}
