import { useEffect, useState } from 'react'
import { api, type AuthStatus, type Candle, type Health, type InstrumentHit } from './api/client'

function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [auth, setAuth] = useState<AuthStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<InstrumentHit[]>([])
  const [symbol, setSymbol] = useState<InstrumentHit | null>(null)
  const [timeframes, setTimeframes] = useState<string[]>([])
  const [tf, setTf] = useState('1D')
  const [candles, setCandles] = useState<Candle[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    Promise.all([api.health(), api.authStatus(), api.timeframes()])
      .then(([h, a, t]) => {
        setHealth(h)
        setAuth(a)
        setTimeframes(t)
      })
      .catch((e: Error) => setError(e.message))
  }, [])

  useEffect(() => {
    if (!query.trim()) {
      setHits([])
      return
    }
    const id = setTimeout(() => api.search(query).then(setHits).catch(() => setHits([])), 200)
    return () => clearTimeout(id)
  }, [query])

  useEffect(() => {
    if (!symbol) return
    setLoading(true)
    setLoadError(null)
    api
      .candles(symbol.symbol, tf)
      .then(setCandles)
      .catch((e: Error) => {
        setCandles([])
        setLoadError(e.message)
      })
      .finally(() => setLoading(false))
  }, [symbol, tf])

  const fyers = auth?.fyers
  const last = candles.at(-1)

  return (
    <main className="app">
      <header className="bar">
        <h1>Indicator</h1>
        {error && <span className="status err">Backend unreachable: {error}</span>}
        {health && (
          <span className="status">
            {health.instruments.toLocaleString()} instruments · {health.candles.toLocaleString()}{' '}
            candles stored
          </span>
        )}
        {fyers &&
          (fyers.authenticated ? (
            <span className="status ok">Fyers connected</span>
          ) : fyers.configured ? (
            <a className="button" href={fyers.login_url}>
              Connect Fyers
            </a>
          ) : (
            <span className="status err">Add Fyers keys to backend/.env</span>
          ))}
      </header>

      <section className="controls">
        <div className="search">
          <input
            placeholder="Search symbol (e.g. SBIN, NIFTY)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {hits.length > 0 && (
            <ul className="hits">
              {hits.map((h) => (
                <li key={h.symbol}>
                  <button
                    onClick={() => {
                      setSymbol(h)
                      setQuery('')
                      setHits([])
                    }}
                  >
                    <b>{h.ticker}</b> <span>{h.name}</span> <em>{h.kind}</em>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <select value={tf} onChange={(e) => setTf(e.target.value)}>
          {timeframes.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </section>

      {symbol && (
        <section className="result">
          <h2>
            {symbol.ticker} <span className="muted">{symbol.name}</span>
          </h2>
          {loading && <p className="status">Loading…</p>}
          {loadError && <p className="status err">{loadError}</p>}
          {!loading && last && (
            <p className="status">
              {candles.length} {tf} candles · last close {last.close} (
              {new Date(last.time * 1000).toISOString().slice(0, 16).replace('T', ' ')} IST)
            </p>
          )}
          <p className="muted">Chart rendering comes in step 3.</p>
        </section>
      )}
    </main>
  )
}

export default App
