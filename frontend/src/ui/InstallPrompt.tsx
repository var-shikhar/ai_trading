import { useState } from 'react'
import { usePref } from '../prefs'
import { useInstall } from '../pwa'
import { Button } from './kit'

const SNOOZE_DAYS = 14

/** "Install Indicator" card: the browser's install dialog on Chrome, Edge
 * and Android; Share → Add to Home Screen instructions on iPhone/iPad.
 * "Not now" hides it for two weeks. On phones it floats above the tab bar
 * and search bar. */
export function InstallPrompt() {
  const { mode, install } = useInstall()
  const [snoozedUntil, setSnoozedUntil] = usePref<number>('installSnoozedUntil', 0)
  const [busy, setBusy] = useState(false)
  const [now] = useState(Date.now)
  if (!mode || now < snoozedUntil) return null

  const snooze = () => setSnoozedUntil(Date.now() + SNOOZE_DAYS * 86400 * 1000)
  const onInstall = async () => {
    setBusy(true)
    try {
      if (!(await install())) snooze()
    } catch {
      snooze()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Install the app"
      className="fixed inset-x-3 bottom-[calc(124px+env(safe-area-inset-bottom))] z-[90] mx-auto flex max-w-[520px] animate-pop flex-wrap items-center gap-3 rounded-2xl border border-line bg-raised p-3 shadow-[var(--shadow)] sm:flex-nowrap md:bottom-[calc(16px+env(safe-area-inset-bottom))]"
    >
      <img src="/icon-192.png" alt="" width={44} height={44} className="size-11 shrink-0 rounded-xl" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <b className="text-[14px] font-semibold text-fg">Install Indicator</b>
        {mode === 'prompt' ? (
          <span className="text-[12px] leading-snug text-muted">Open it from your home screen or desktop, full screen and quicker to start.</span>
        ) : (
          <span className="text-[12px] leading-snug text-muted">
            Tap <ShareIcon /> <b className="text-fg">Share</b>, then <b className="text-fg">Add to Home Screen</b>.
          </span>
        )}
      </div>
      {mode === 'prompt' ? (
        <div className="flex shrink-0 gap-2 max-sm:w-full max-sm:justify-end">
          <Button size="sm" variant="ghost" onClick={snooze}>
            Not now
          </Button>
          <Button size="sm" variant="primary" loading={busy} onClick={onInstall}>
            Install
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="soft" onClick={snooze} className="max-sm:ml-auto">
          Got it
        </Button>
      )}
    </div>
  )
}

function ShareIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      aria-label="Share"
      role="img"
      className="inline align-[-2px] text-accent"
    >
      <path d="M7 1.5v7.5M4.5 4L7 1.5 9.5 4M4 6.5H2.5v6h9v-6H10" />
    </svg>
  )
}
