import { useEffect, useState } from 'react'

/** Chrome/Edge/Android's install event (not in TypeScript's DOM types yet). */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((fn) => fn())

export function registerPwa() {
  // The install event can fire before React mounts: keep it for later.
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as BeforeInstallPromptEvent
    notify()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    notify()
  })
  // Dev builds skip the service worker so Vite's hot reload isn't cached.
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}))
  }
}

export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true

// iOS Safari has no install event: users add it from the Share menu.
export const isIos = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

/** How (and whether) this browser can install the app right now. */
export function useInstall(): { mode: 'prompt' | 'ios' | null; install: () => Promise<boolean> } {
  const [, force] = useState(0)
  useEffect(() => {
    const fn = () => force((n) => n + 1)
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  }, [])
  const mode = isStandalone() ? null : deferred ? 'prompt' : isIos() ? 'ios' : null
  const install = async () => {
    if (!deferred) return false
    const e = deferred
    deferred = null
    await e.prompt()
    const { outcome } = await e.userChoice
    notify()
    return outcome === 'accepted'
  }
  return { mode, install }
}

/** True when the viewport matches `query` (updates on resize/rotation). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setMatches(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return matches
}

export const MOBILE_QUERY = '(max-width: 767px)'
