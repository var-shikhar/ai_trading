import { useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { api } from '../api/client'
import { Button, ErrorText, Field, Input, Skeleton } from '../ui/kit'
import { AuthLayout, PasswordInput } from './LoginPage'
import { errorMessage } from './util'

/** /signup?code=...: create an account with an invite (no open registration). */
export function SignupPage() {
  const [code] = useState(() => new URLSearchParams(window.location.search).get('code') ?? '')
  const invite = useQuery({
    queryKey: ['session', 'invite', code],
    queryFn: () => api.checkInvite(code),
    enabled: !!code,
    retry: false,
    staleTime: Infinity,
  })
  const [form, setForm] = useState({ username: '', password: '', repeat: '', email: '' })
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const locked = invite.data?.email ?? null
  const email = locked ?? form.email

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (form.password.length < 8) return setError('Password needs at least 8 characters')
    if (form.password !== form.repeat) return setError("Passwords don't match")
    setBusy(true)
    setError(null)
    try {
      await api.signup({ code, username: form.username.trim(), password: form.password, email: email.trim() || null })
      window.location.replace('/') // signed in: open the app
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  const inviteError = !code
    ? 'This page needs an invite link. Ask the admin for one.'
    : invite.isError
      ? errorMessage(invite.error)
      : null

  return (
    <AuthLayout subtitle="Create your account">
      {invite.isLoading ? (
        <div className="flex flex-col gap-4" aria-busy>
          <p className="text-center text-[13px] text-muted">Checking your invite…</p>
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-10 w-full rounded-lg" />
            </div>
          ))}
          <Skeleton className="h-12 w-full rounded-lg" />
        </div>
      ) : inviteError ? (
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-down-soft text-[20px] font-bold text-down">!</div>
          <p className="text-[15px] font-semibold">This invite can't be used</p>
          <p className="text-[13px] text-muted">{inviteError}</p>
          <a
            href="/"
            className="mt-2 inline-flex h-10 w-full items-center justify-center rounded-lg border border-line bg-surface text-[14px] font-semibold text-fg no-underline transition hover:bg-hover"
          >
            Go to sign in
          </a>
        </div>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <Field label="Username" hint="3-32 letters, digits, . _ -">
            <Input
              autoFocus
              required
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
            />
          </Field>
          <Field label={locked ? 'Email (from your invite)' : 'Email (optional, for alerts)'}>
            <Input
              type="email"
              autoComplete="email"
              value={email}
              readOnly={!!locked}
              className={locked ? 'bg-hover text-muted' : undefined}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
          <Field label="Password" hint="At least 8 characters">
            <PasswordInput
              value={form.password}
              onChange={(password) => setForm({ ...form, password })}
              show={showPassword}
              onShow={setShowPassword}
              autoComplete="new-password"
              minLength={8}
            />
          </Field>
          <Field label="Repeat password">
            <Input
              type={showPassword ? 'text' : 'password'}
              required
              autoComplete="new-password"
              value={form.repeat}
              onChange={(e) => setForm({ ...form, repeat: e.target.value })}
            />
          </Field>
          <ErrorText>{error && <span role="alert">{error}</span>}</ErrorText>
          <Button variant="primary" size="lg" type="submit" loading={busy} className="mt-1 w-full">
            {busy ? 'Creating account…' : 'Create account'}
          </Button>
        </form>
      )}
      <p className="mt-5 text-center text-[12px] text-muted">
        Already have an account?{' '}
        <a href="/" className="font-semibold text-accent no-underline hover:underline">
          Sign in
        </a>
      </p>
    </AuthLayout>
  )
}
