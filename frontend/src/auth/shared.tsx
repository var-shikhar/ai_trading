import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, ErrorText, Modal, cx } from '../ui/kit'
import { copyText, errorMessage, useEscapeFirst } from './util'

/** Bits shared by the auth screens, account dialogs, nav rail and "Me" page. */

export function BrandMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" aria-hidden className={className}>
      <rect width="26" height="26" rx="7" fill="var(--accent)" />
      <path d="M6 17l4.5-5 3.5 3 6-7" fill="none" stroke="var(--accent-fg)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** The user's initial in a colored circle. */
export function Avatar({ name, size = 28, className }: { name: string; size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cx('inline-flex shrink-0 items-center justify-center rounded-full bg-accent font-semibold text-accent-fg select-none', className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
    >
      {name.slice(0, 1).toUpperCase() || '?'}
    </span>
  )
}

/** A secret or link shown once, with a copy button that confirms the copy. */
export function CopyField({ value, hint }: { value: string; hint?: ReactNode }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const copy = async () => {
    const ok = await copyText(value)
    setState(ok ? 'copied' : 'failed')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setState('idle'), 2000)
  }
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-accent/40 bg-accent-soft p-3">
      <div className="flex items-center gap-2">
        <input
          readOnly
          value={value}
          onFocus={(e) => e.currentTarget.select()}
          aria-label="Value to copy"
          className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2.5 font-mono text-[12px] text-fg outline-none"
        />
        <Button size="sm" variant={state === 'copied' ? 'soft' : 'primary'} onClick={copy} className="min-w-[84px]">
          {state === 'copied' ? (
            <>
              <CheckIcon /> Copied
            </>
          ) : state === 'failed' ? (
            'Select & copy'
          ) : (
            'Copy'
          )}
        </Button>
      </div>
      {hint && <p className="text-[12px] text-muted">{hint}</p>}
    </div>
  )
}

export function CheckIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M2.5 7.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** "Are you sure?" for destructive actions; stays open with the error if the
 * action fails. */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  danger = true,
  onConfirm,
  onClose,
}: {
  title: ReactNode
  children?: ReactNode
  confirmLabel: string
  danger?: boolean
  onConfirm: () => unknown
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEscapeFirst(() => !busy && onClose())
  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
      onClose()
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }
  return (
    <Modal
      title={title}
      onClose={() => !busy && onClose()}
      width={420}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={confirm} autoFocus={!danger}>
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 text-[14px] leading-relaxed text-muted">
        {children}
        <ErrorText>{error}</ErrorText>
      </div>
    </Modal>
  )
}

/** A heading over a group of rows in a dialog. */
export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mt-6 mb-2 flex items-center gap-2 first:mt-0">
      <h3 className="flex-1 text-[13px] font-semibold tracking-wide text-fg">{children}</h3>
      {action}
    </div>
  )
}

/** Rounded list container; its children are rows separated by lines. */
export function ListCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('overflow-hidden rounded-xl border border-line bg-surface [&>*+*]:border-t [&>*+*]:border-line', className)}>
      {children}
    </div>
  )
}
