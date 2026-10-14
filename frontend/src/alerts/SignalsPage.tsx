import type { InstrumentHit } from '../api/client'
import { SignalsList } from './SignalsList'

/** Signals as a page of their own: the inbox screening and (later) agents feed. */
export function SignalsPage({ onOpen }: { onOpen: (s: InstrumentHit) => void }) {
  return (
    <div className="page-scroll">
      <div className="page-inner narrow">
        <h1 className="page-title">Signals</h1>
        <p className="note">
          Indicator and scan alerts add a signal each time they fire; agents will post here too (with an API key, via{' '}
          <code>POST /api/signals</code>). Open one to see its chart.
        </p>
        <div className="signals-card">
          <SignalsList onOpen={onOpen} />
        </div>
      </div>
    </div>
  )
}
