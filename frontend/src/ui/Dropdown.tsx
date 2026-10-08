import { useEffect, useRef, useState, type ReactNode } from 'react'

/** Toolbar button that opens a menu below it; closes on outside click or Esc. */
export function Dropdown({
  label,
  title,
  children,
  align = 'left',
  className = '',
}: {
  label: ReactNode
  title?: string
  children: (close: () => void) => ReactNode
  align?: 'left' | 'right'
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className={`dropdown ${className}`}>
      <button
        className={`tool-button ${open ? 'active' : ''}`}
        title={title}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className="caret">
          <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      </button>
      {open && <div className={`menu ${align}`}>{children(() => setOpen(false))}</div>}
    </div>
  )
}
