import { useToasts } from '../state/ui'
import { cx } from './kit'

/** Short confirmations at the bottom of the screen ("Alert created"). */
export function Toaster() {
  const { toasts, dismiss } = useToasts()
  if (!toasts.length) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(88px+env(safe-area-inset-bottom))] z-[120] flex flex-col items-center gap-2 px-4 md:bottom-6">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={cx(
            'pointer-events-auto flex animate-pop items-center gap-2 rounded-full px-4 py-2.5 text-[13px] font-medium shadow-[var(--shadow)]',
            t.tone === 'err' ? 'bg-down text-white' : t.tone === 'ok' ? 'bg-fg text-bg' : 'bg-raised text-fg',
          )}
        >
          {t.tone === 'ok' ? '✓' : t.tone === 'err' ? '!' : 'ℹ'} {t.text}
        </button>
      ))}
    </div>
  )
}
