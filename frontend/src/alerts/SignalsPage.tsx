import type { InstrumentHit } from '../api/client'
import { SignalsList } from './SignalsList'

/** Signals as a page of their own: the inbox screening and (later) agents feed. */
export function SignalsPage({ onOpen }: { onOpen: (s: InstrumentHit) => void }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-bg">
      <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-4 md:px-6 md:py-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-[20px] font-semibold text-fg">Signals</h1>
          <p className="text-[13px] leading-relaxed text-muted">
            Indicator and scan alerts add a signal each time they fire; agents will post here too (with an API key, via{' '}
            <code className="rounded bg-hover px-1 py-0.5 font-mono text-[12px] text-fg">POST /api/signals</code>). Open one to see
            its chart.
          </p>
        </header>
        <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
          <SignalsList onOpen={onOpen} />
        </div>
      </div>
    </div>
  )
}
