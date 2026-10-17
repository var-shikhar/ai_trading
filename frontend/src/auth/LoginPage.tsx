import { useState, type FormEvent, type ReactNode } from 'react'
import { api } from '../api/client'
import { Button, ErrorText, Field, Input } from '../ui/kit'
import { BrandMark } from './shared'
import { errorMessage } from './util'

export function LoginPage({ onSignedIn }: { onSignedIn: (username: string) => void | Promise<unknown> }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const me = await api.login(username.trim(), password)
      // Stay busy until the app has loaded the session (this page unmounts then).
      await onSignedIn(me.username)
    } catch (err) {
      setError(errorMessage(err))
    }
    setBusy(false)
  }

  return (
    <AuthLayout subtitle="Sign in to continue">
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <Field label="Username">
          <Input
            autoFocus
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </Field>
        <Field label="Password">
          <PasswordInput
            value={password}
            onChange={setPassword}
            show={showPassword}
            onShow={setShowPassword}
            autoComplete="current-password"
          />
        </Field>
        <ErrorText>{error && <span role="alert">{error}</span>}</ErrorText>
        <Button variant="primary" size="lg" type="submit" loading={busy} className="mt-1 w-full">
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
      <p className="mt-5 text-center text-[12px] text-muted">Invite only: to join, ask the admin for an invite link.</p>
    </AuthLayout>
  )
}

/** Centered card with the brand mark, shared by sign-in and sign-up. */
export function AuthLayout({ subtitle, children }: { subtitle: ReactNode; children: ReactNode }) {
  return (
    <div className="fixed inset-0 overflow-y-auto bg-bg text-fg">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(ellipse_at_top,var(--accent-soft),transparent_70%)]" />
      <div className="relative flex min-h-full flex-col items-center justify-center px-4 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))]">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <BrandMark size={48} className="drop-shadow-sm" />
          <div>
            <h1 className="text-[22px] font-bold tracking-tight">Indicator</h1>
            <p className="mt-0.5 text-[14px] text-muted">{subtitle}</p>
          </div>
        </div>
        <div className="w-full max-w-[380px] animate-pop rounded-2xl border border-line bg-surface p-6 shadow-[var(--shadow)] max-sm:p-5">
          {children}
        </div>
      </div>
    </div>
  )
}

/** Password field with a show/hide toggle. */
export function PasswordInput({
  value,
  onChange,
  show,
  onShow,
  autoComplete,
  minLength,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  show: boolean
  onShow: (v: boolean) => void
  autoComplete: string
  minLength?: number
  placeholder?: string
}) {
  return (
    <div className="relative">
      <Input
        type={show ? 'text' : 'password'}
        required
        minLength={minLength}
        autoComplete={autoComplete}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pr-16"
      />
      <button
        type="button"
        onClick={() => onShow(!show)}
        aria-pressed={show}
        className="absolute inset-y-0 right-1 my-auto h-8 cursor-pointer rounded-md px-2.5 text-[12px] font-medium text-muted transition hover:bg-hover hover:text-fg"
      >
        {show ? 'Hide' : 'Show'}
      </button>
    </div>
  )
}
