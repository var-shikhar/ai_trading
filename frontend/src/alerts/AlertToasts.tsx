import { useEffect, useState } from 'react'
import { onAlertEvent, type AlertMessage } from '../live/liveClient'

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
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.key} className="toast">
          <b>🔔 {t.title}</b>
          <span>{t.body}</span>
          <button className="icon-button" aria-label="Dismiss" onClick={() => setToasts((x) => x.filter((y) => y.key !== t.key))}>
            ×
          </button>
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
