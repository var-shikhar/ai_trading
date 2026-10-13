import { useCallback, useEffect, useState } from 'react'
import { api, type InstrumentHit, type Signal } from '../api/client'

const when = (iso: string) => iso.replace('T', ' ').slice(0, 16)

/** Signals from condition/scan alerts and (later) agents, newest first. */
export function SignalsList({ onOpen }: { onOpen: (s: InstrumentHit) => void }) {
  const [signals, setSignals] = useState<Signal[]>([])
  const [filter, setFilter] = useState<'new' | 'all'>('new')

  const reload = useCallback(() => {
    api.signals(filter === 'new' ? { status: 'new' } : {}).then(setSignals, () => {})
  }, [filter])
  useEffect(() => {
    reload()
    const id = setInterval(reload, 60000)
    return () => clearInterval(id)
  }, [reload])

  const mark = async (s: Signal, status: Signal['status']) => {
    await api.updateSignal(s.id, status)
    reload()
  }

  return (
    <>
      <div className="segmented small signal-filter" role="group" aria-label="Signal filter">
        <button className={filter === 'new' ? 'active' : ''} onClick={() => setFilter('new')}>
          New
        </button>
        <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
          All
        </button>
      </div>
      {signals.length === 0 && (
        <p className="status">No {filter === 'new' ? 'new ' : ''}signals. Indicator and scan alerts add them here.</p>
      )}
      <ul className="alert-list">
        {signals.map((s) => {
          const ticker = s.symbol.split(':')[1]?.replace(/-[A-Z]+$/, '') ?? s.symbol
          return (
            <li key={s.id} className={`alert-item ${s.status === 'new' ? '' : 'paused'}`}>
              <button
                className="alert-main"
                onClick={() => {
                  if (s.status === 'new') mark(s, 'seen')
                  onOpen({ symbol: s.symbol, ticker, name: '', kind: s.symbol.startsWith('MCX:') ? 'COM' : 'EQ' })
                }}
              >
                <b>
                  <span className={`dir ${s.direction === 'long' ? 'bullish' : s.direction === 'short' ? 'bearish' : 'neutral'}`}>
                    {s.direction === 'long' ? '▲' : s.direction === 'short' ? '▼' : '●'}
                  </span>{' '}
                  {ticker} <span className="muted">· {s.tf ?? ''}</span>
                </b>
                <span className="muted">{s.reason}</span>
                <span className="alert-meta">
                  <em className="badge">{s.source}</em> <span className="muted">{when(s.created)}</span>
                  {s.confidence !== null && <span className="muted"> · {Math.round(s.confidence * 100)}%</span>}
                </span>
              </button>
              <span className="alert-actions">
                <button title="Acted on it" onClick={() => mark(s, 'acted')}>
                  ✓
                </button>
                <button title="Dismiss" onClick={() => mark(s, 'dismissed')}>
                  ×
                </button>
              </span>
            </li>
          )
        })}
      </ul>
    </>
  )
}
