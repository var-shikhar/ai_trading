import { useEffect, useState } from 'react'
import { onAlertEvent, type AlertMessage } from '../live/liveClient'
import { IconButton } from '../ui/kit'

/** Pop-up for alerts that fire while the app is open, with a short chime,
 * and a system notification when the tab is in the background. */
export function AlertToasts() {
  const [toasts, setToasts] = useState<(AlertMessage & { key: number })[]>([])

  // (Notification permission is asked when an alert is created, on a tap.)
  useEffect(() => {
    return onAlertEvent((m) => {
      const key = Date.now() + Math.random()
      setToasts((t) => [...t.slice(-4), { ...m, key }])
      setTimeout(() => setToasts((t) => t.filter((x) => x.key !== key)), 10000)
      chime()
      if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        new Notification(m.title, { body: m.body })
      }
    })
  }, [])

  if (!toasts.length) return null
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-2 top-[calc(8px+env(safe-area-inset-top))] z-[110] flex flex-col items-end gap-2 md:inset-x-auto md:right-4 md:w-[360px]"
    >
      {toasts.map((t) => (
        <div
          key={t.key}
          className="pointer-events-auto flex w-full animate-pop items-start gap-3 rounded-xl border border-line bg-raised p-3 shadow-[var(--shadow)]"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[rgba(245,165,36,0.15)] text-star" aria-hidden>
            🔔
          </span>
          <div className="min-w-0 flex-1">
            <b className="block text-[14px] font-semibold text-fg">{t.title}</b>
            <span className="block text-[12px] break-words whitespace-pre-line text-muted">{t.body}</span>
          </div>
          <IconButton label="Dismiss" onClick={() => setToasts((x) => x.filter((y) => y.key !== t.key))}>
            ×
          </IconButton>
        </div>
      ))}
    </div>
  )
}

// One audio context for the app: browsers cap how many can exist, so a new
// one per alert stopped the chime after a few alerts.
let audio: AudioContext | null = null

function chime() {
  try {
    audio ??= new AudioContext()
    const ctx = audio
    if (ctx.state === 'suspended') ctx.resume().catch(() => {})
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.15, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6)
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.6)
  } catch {
    // audio may be blocked until the user interacts with the page
  }
}
