import { usePref } from '../prefs'
import { useInstall } from '../pwa'

const SNOOZE_DAYS = 14

/** "Install Indicator" banner: the browser's install dialog on Chrome, Edge
 * and Android; Share → Add to Home Screen instructions on iPhone/iPad.
 * "Not now" hides it for two weeks. */
export function InstallPrompt() {
  const { mode, install } = useInstall()
  const [snoozedUntil, setSnoozedUntil] = usePref<number>('installSnoozedUntil', 0)
  if (!mode || Date.now() < snoozedUntil) return null

  const snooze = () => {
    const until = Date.now() + SNOOZE_DAYS * 86400 * 1000
    setSnoozedUntil(until)
  }

  return (
    <div className="install-prompt" role="dialog" aria-label="Install the app">
      <img src="/icon-192.png" alt="" width={40} height={40} />
      <div className="install-text">
        <b>Install Indicator</b>
        {mode === 'prompt' ? (
          <span>Open it from your home screen or desktop, full screen and quicker to start.</span>
        ) : (
          <span>
            Tap <ShareIcon /> <b>Share</b>, then <b>Add to Home Screen</b>.
          </span>
        )}
      </div>
      <div className="install-actions">
        {mode === 'prompt' && (
          <button className="primary-button small" onClick={() => install().then((ok) => !ok && snooze())}>
            Install
          </button>
        )}
        <button className="secondary-button small" onClick={snooze}>
          {mode === 'prompt' ? 'Not now' : 'Got it'}
        </button>
      </div>
    </div>
  )
}

function ShareIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" aria-label="Share" role="img">
      <path d="M7 1.5v7.5M4.5 4L7 1.5 9.5 4M4 6.5H2.5v6h9v-6H10" />
    </svg>
  )
}
