import { useEffect, useRef, type ReactNode } from 'react'

/** Centered dialog with a dimmed backdrop. Esc or a backdrop click closes it. */
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
  // Parents often pass a new onClose each render (e.g. on every live price
  // tick); read it through a ref so the effects below run once.
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  // Focus once on open, a text field first: refocusing on every render moved
  // focus to the close button and dismissed the phone keyboard mid-typing.
  useEffect(() => {
    const el = ref.current
    if (!el || el.contains(document.activeElement)) return
    ;(el.querySelector<HTMLElement>('input:not([type=checkbox]), textarea, select') ?? el.querySelector<HTMLElement>('button'))?.focus()
  }, [])

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="modal" role="dialog" aria-modal="true" style={{ width }}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 18 18" stroke="currentColor" strokeWidth="1.5" aria-hidden>
              <path d="M4.5 4.5l9 9M13.5 4.5l-9 9" />
            </svg>
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}
