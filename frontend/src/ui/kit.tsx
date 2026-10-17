import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react'
import { createPortal } from 'react-dom'

/** The app's UI building blocks (Tailwind). Colors are the theme tokens from
 * tailwind.css (bg-surface, text-muted, border-line, ...), so light and dark
 * work without dark: variants. */

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

// --- buttons -------------------------------------------------------------------------------

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'soft'
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg shadow-card hover:brightness-110',
  secondary: 'border border-line bg-surface text-fg hover:bg-hover',
  ghost: 'text-muted hover:bg-hover hover:text-fg',
  danger: 'bg-down text-white hover:brightness-110',
  soft: 'bg-accent-soft text-accent hover:brightness-95',
}
const SIZES = { sm: 'h-8 px-3 text-[13px] gap-1.5', md: 'h-10 px-4 text-[14px] gap-2', lg: 'h-12 px-5 text-[15px] gap-2' }

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: keyof typeof SIZES; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        'inline-flex shrink-0 cursor-pointer items-center justify-center rounded-lg font-semibold whitespace-nowrap transition disabled:cursor-default disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
    >
      {loading && <Spinner size={14} />}
      {children}
    </button>
  )
}

export function IconButton({
  label,
  active,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      {...rest}
      aria-label={label}
      title={rest.title ?? label}
      className={cx(
        'inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md transition disabled:cursor-default disabled:opacity-40',
        active ? 'bg-selected text-accent' : 'text-muted hover:bg-hover hover:text-fg',
        className,
      )}
    >
      {children}
    </button>
  )
}

// --- form controls -------------------------------------------------------------------------

export const inputClass =
  'h-10 w-full min-w-0 rounded-lg border border-line bg-surface px-3 text-[14px] text-fg max-md:text-[16px] outline-none transition placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent-soft'

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cx(inputClass, className)} />
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={cx(inputClass, 'cursor-pointer pr-8', className)}>
      {children}
    </select>
  )
}

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('flex min-w-0 flex-col gap-1.5', className)}>
      <span className="text-[12px] font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-muted">{hint}</span>}
    </label>
  )
}

export function Switch({
  checked,
  onChange,
  label,
  className,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label?: ReactNode
  className?: string
}) {
  return (
    <label className={cx('inline-flex cursor-pointer items-center gap-2 text-[13px] text-fg select-none', className)}>
      <span className="relative inline-flex">
        <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="h-5 w-9 rounded-full bg-line transition peer-checked:bg-accent" />
        <span className="absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow transition peer-checked:translate-x-4" />
      </span>
      {label}
    </label>
  )
}

export function Checkbox({
  checked,
  onChange,
  label,
  disabled,
  className,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: ReactNode
  disabled?: boolean
  className?: string
}) {
  return (
    <label className={cx('inline-flex items-center gap-2 text-[13px] text-fg select-none', disabled ? 'opacity-50' : 'cursor-pointer', className)}>
      <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = 'md',
}: {
  value: T
  onChange: (v: T) => void
  options: readonly (readonly [T, ReactNode])[]
  className?: string
  size?: 'sm' | 'md'
}) {
  return (
    <div role="group" className={cx('inline-flex rounded-lg bg-hover p-0.5', className)}>
      {options.map(([v, label]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          aria-pressed={value === v}
          className={cx(
            'flex-1 cursor-pointer rounded-md font-medium whitespace-nowrap transition',
            size === 'sm' ? 'px-2.5 py-1 text-[12px]' : 'px-3 py-1.5 text-[13px]',
            value === v ? 'bg-surface text-fg shadow-card' : 'text-muted hover:text-fg',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

export function Tabs<T extends string>({
  value,
  onChange,
  items,
  className,
}: {
  value: T
  onChange: (v: T) => void
  items: readonly { id: T; label: ReactNode; badge?: ReactNode }[]
  className?: string
}) {
  return (
    <div role="tablist" className={cx('flex gap-1 overflow-x-auto [scrollbar-width:none]', className)}>
      {items.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cx(
            'flex shrink-0 cursor-pointer items-center gap-1.5 border-b-2 px-3 py-2.5 text-[13px] font-medium whitespace-nowrap transition',
            value === t.id ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-fg',
          )}
        >
          {t.label}
          {t.badge != null && (
            <span className="rounded-full bg-accent-soft px-1.5 text-[11px] leading-5 text-accent">{t.badge}</span>
          )}
        </button>
      ))}
    </div>
  )
}

// --- feedback ------------------------------------------------------------------------------

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cx('inline-block animate-spin rounded-full border-2 border-current border-t-transparent opacity-70', className)}
      style={{ width: size, height: size }}
    />
  )
}

/** A shimmering placeholder block while data loads. */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cx('block animate-shimmer rounded-md bg-[length:200%_100%] shimmer-bg', className)} />
}

/** Placeholder list rows: a title line, a sub line and a value on the right. */
export function SkeletonRows({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cx('flex flex-col', className)} aria-busy>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 border-b border-line px-4 py-3">
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-2.5 w-40" />
          </div>
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  )
}

export function Badge({ tone = 'neutral', children, className }: { tone?: 'neutral' | 'up' | 'down' | 'accent' | 'warn'; children: ReactNode; className?: string }) {
  const tones = {
    neutral: 'bg-hover text-muted',
    up: 'bg-up-soft text-up',
    down: 'bg-down-soft text-down',
    accent: 'bg-accent-soft text-accent',
    warn: 'bg-[rgba(245,165,36,0.15)] text-[#d48806]',
  }
  return <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold', tones[tone], className)}>{children}</span>
}

export function EmptyState({ icon, title, children, action, className }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex flex-col items-center gap-2 px-6 py-10 text-center', className)}>
      {icon && <div className="mb-1 flex size-12 items-center justify-center rounded-full bg-accent-soft text-accent">{icon}</div>}
      <p className="text-[15px] font-semibold text-fg">{title}</p>
      {children && <div className="max-w-sm text-[13px] leading-relaxed text-muted">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function ErrorText({ children, className }: { children: ReactNode; className?: string }) {
  if (!children) return null
  return <p className={cx('rounded-lg bg-down-soft px-3 py-2 text-[13px] text-down', className)}>{children}</p>
}

// --- dialog --------------------------------------------------------------------------------

// Open dialogs, newest last: Esc closes only the top one.
const modalStack: object[] = []

/** Centered dialog on desktop, full-screen sheet on phones. Rendered into
 * <body>, so no panel's overflow or transform can clip or trap it. Esc or a
 * backdrop click closes it; the first text field is focused once on open. */
export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 520,
}: {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  // Parents often pass a new onClose each render (live prices): read it via a ref.
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })
  useEffect(() => {
    const me = {}
    modalStack.push(me)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || modalStack[modalStack.length - 1] !== me) return
      e.stopImmediatePropagation()
      closeRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      modalStack.splice(modalStack.indexOf(me), 1)
    }
  }, [])
  useEffect(() => {
    const el = ref.current
    if (!el || el.contains(document.activeElement)) return
    ;(el.querySelector<HTMLElement>('input:not([type=checkbox]), textarea, select') ?? el.querySelector<HTMLElement>('button'))?.focus()
  }, [])

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-stretch justify-center bg-[var(--backdrop)] md:items-center md:p-6"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        style={{ ['--w' as string]: `${width}px` }}
        className="flex h-full w-full animate-pop flex-col overflow-hidden bg-surface pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-fg md:h-auto md:max-h-[88vh] md:w-[var(--w)] md:max-w-full md:rounded-2xl md:border md:border-line md:p-0 md:shadow-[var(--shadow)]"
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-line px-5 py-3.5">
          <h2 className="min-w-0 flex-1 truncate text-[16px] font-semibold">{title}</h2>
          <IconButton label="Close" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 18 18" stroke="currentColor" strokeWidth="1.6" aria-hidden>
              <path d="M4.5 4.5l9 9M13.5 4.5l-9 9" />
            </svg>
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

// --- menus ---------------------------------------------------------------------------------

/** A button that opens a menu; closes on outside click or Esc. */
export function Dropdown({
  label,
  title,
  children,
  align = 'left',
  className,
  buttonClassName,
  caret = true,
}: {
  label: ReactNode
  title?: string
  children: (close: () => void) => ReactNode
  /** side: opens to the right of the button, bottom-aligned (nav rail). */
  align?: 'left' | 'right' | 'side' | 'up'
  className?: string
  buttonClassName?: string
  caret?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  const pos = {
    left: 'top-full left-0 mt-1',
    right: 'top-full right-0 mt-1',
    side: 'bottom-0 left-full ml-2 max-md:bottom-full max-md:left-auto max-md:right-0 max-md:mb-2 max-md:ml-0',
    up: 'bottom-full right-0 mb-2',
  }[align]
  return (
    <div ref={ref} className={cx('relative inline-flex', className)}>
      <button
        title={title}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cx(
          'inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-2 text-[13px] whitespace-nowrap text-fg transition hover:bg-hover',
          open && 'bg-hover',
          buttonClassName,
        )}
      >
        {label}
        {caret && (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className="text-muted">
            <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        )}
      </button>
      {open && (
        <div
          role="menu"
          className={cx(
            'absolute z-50 max-h-[70vh] min-w-[200px] animate-pop overflow-y-auto rounded-xl border border-line bg-raised p-1 text-fg shadow-[var(--shadow)]',
            pos,
          )}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

export function MenuItem({
  onClick,
  selected,
  danger,
  children,
  right,
  href,
}: {
  onClick?: () => void
  selected?: boolean
  danger?: boolean
  children: ReactNode
  right?: ReactNode
  href?: string
}) {
  const cls = cx(
    'flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] transition hover:bg-hover',
    selected && 'bg-selected text-accent',
    danger && 'text-down',
  )
  return (
    <div className="flex items-center">
      {href ? (
        <a role="menuitem" href={href} className={cx(cls, 'no-underline')}>
          {children}
        </a>
      ) : (
        <button role="menuitem" onClick={onClick} className={cls}>
          {children}
        </button>
      )}
      {right}
    </div>
  )
}

export function MenuHeading({ children }: { children: ReactNode }) {
  return <div className="px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-wider text-muted uppercase">{children}</div>
}
