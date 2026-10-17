import { useEffect, useRef } from 'react'

/** Error message for a failed request (fetch throws TypeError when offline). */
export const errorMessage = (e: unknown) =>
  e instanceof TypeError ? 'Could not reach the server' : e instanceof Error && e.message ? e.message : 'Something went wrong'

/** navigator.clipboard only exists on https/localhost; on a LAN http address
 * fall back to the old execCommand copy. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to the fallback
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0'
  document.body.appendChild(ta)
  ta.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  ta.remove()
  return ok
}

/** For a dialog opened over another dialog: Esc closes only this one (every
 * Modal listens on window, so the one underneath would close too). */
export function useEscapeFirst(onClose: () => void) {
  const ref = useRef(onClose)
  useEffect(() => {
    ref.current = onClose
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      ref.current()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
}

/** Date and time from the server's ISO strings, in the browser's locale. */
export function formatWhen(iso: string | null | undefined, withTime = true): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.replace('T', ' ').slice(0, withTime ? 16 : 10)
  return d.toLocaleString(undefined, withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' })
}
