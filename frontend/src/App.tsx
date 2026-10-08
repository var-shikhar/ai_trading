import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type AuthStatus, type ChartData, type Health, type InstrumentHit } from './api/client'
import { EMA_KEYS, PriceChart, type EmaKey } from './chart/PriceChart'
import { useChartTheme } from './chart/theme'

const PAGE_BARS = 500
const DAILY_TIMEFRAMES = new Set(['1D', '1W', '1M'])
const DEFAULT_SYMBOL: InstrumentHit = {
  symbol: 'NSE:NIFTY50-INDEX',
  ticker: 'NIFTY50',
  name: 'NIFTY 50',
  kind: 'INDEX',
}

// Per-browser convenience only; the app works without it.
function loadPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function savePref(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage unavailable (private mode etc.)
  }
}

// ?symbol=NSE:SBIN-EQ&tf=1h opens a specific chart (bookmarkable).
const urlParams = new URLSearchParams(window.location.search)

function App() {
  const theme = useChartTheme()
  const [health, setHealth] = useState<Health | null>(null)
  const [auth, setAuth] = useState<AuthStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [timeframes, setTimeframes] = useState<string[]>([])

  const [symbol, setSymbol] = useState<InstrumentHit>(() => {
    const fromUrl = urlParams.get('symbol')
    if (fromUrl) {
      const ticker = fromUrl.split(':')[1]?.split('-')[0] ?? fromUrl
      return { symbol: fromUrl, ticker, name: '', kind: fromUrl.endsWith('-INDEX') ? 'INDEX' : 'EQ' }
    }
    return loadPref('symbol', DEFAULT_SYMBOL)
  })
  const [tf, setTf] = useState<string>(() => urlParams.get('tf') ?? loadPref('tf', '1D'))
  const [visibleEmas, setVisibleEmas] = useState<Record<EmaKey, boolean>>(() =>
    loadPref('emas', { ema20: true, ema50: true, ema200: true }),
  )
  const [showRsi, setShowRsi] = useState<boolean>(() => loadPref('rsi', true))
  const [showVolume, setShowVolume] = useState<boolean>(() => loadPref('volume', true))

  const [limit, setLimit] = useState(PAGE_BARS)
  const [chart, setChart] = useState<ChartData | null>(null)
  const [chartKey, setChartKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const requestId = useRef(0)

  useEffect(() => {
    Promise.all([api.health(), api.authStatus(), api.timeframes()])
      .then(([h, a, t]) => {
        setHealth(h)
        setAuth(a)
        setTimeframes(t)
      })
      .catch((e: Error) => setError(e.message))
  }, [])

  useEffect(() => savePref('symbol', symbol), [symbol])
  useEffect(() => savePref('tf', tf), [tf])
  useEffect(() => savePref('emas', visibleEmas), [visibleEmas])
  useEffect(() => savePref('rsi', showRsi), [showRsi])
  useEffect(() => savePref('volume', showVolume), [showVolume])

  const authenticated = auth?.fyers.authenticated ?? false
  const key = `${symbol.symbol}|${tf}`

  // New symbol/timeframe starts again from the latest page.
  useEffect(() => setLimit(PAGE_BARS), [key])

  useEffect(() => {
    if (!authenticated) return
    const id = ++requestId.current
    setLoading(true)
    setLoadError(null)
    api
      .chart(symbol.symbol, tf, limit)
      .then((data) => {
        if (id !== requestId.current) return
        setChart(data)
        setChartKey(key)
      })
      .catch((e: Error) => {
        if (id === requestId.current) setLoadError(e.message)
      })
      .finally(() => {
        if (id === requestId.current) setLoading(false)
      })
  }, [authenticated, symbol.symbol, tf, limit, key])

  const loadMore = useCallback(() => {
    if (!loading && chart?.has_more && chartKey === key) setLimit((l) => l + PAGE_BARS)
  }, [loading, chart, chartKey, key])

  const fyers = auth?.fyers
  // Indices have no traded volume (Fyers only reports a recent aggregate).
  const isIndex = symbol.kind === 'INDEX'

  return (
    <div className="app">
      <header className="bar">
        <h1>Indicator</h1>
        {error && <span className="status err">Backend unreachable: {error}</span>}
        {health && (
          <span className="status">
            {health.instruments.toLocaleString()} instruments
          </span>
        )}
        <span className="spacer" />
        {fyers &&
          (fyers.authenticated ? (
            <span className="status ok">● Fyers connected</span>
          ) : fyers.configured ? (
            <a className="button" href={fyers.login_url}>
              Connect Fyers
            </a>
          ) : (
            <span className="status err">Add Fyers keys to backend/.env</span>
          ))}
      </header>

      <section className="toolbar">
        <SymbolSearch onPick={setSymbol} />
        <div className="symbol-title">
          <b>{symbol.ticker}</b> <span className="muted">{symbol.name}</span>
        </div>
        <div className="segmented" role="group" aria-label="Timeframe">
          {timeframes.map((t) => (
            <button key={t} className={t === tf ? 'active' : ''} onClick={() => setTf(t)}>
              {t}
            </button>
          ))}
        </div>
        <div className="toggles" role="group" aria-label="Indicators">
          {EMA_KEYS.map((k) => (
            <label key={k}>
              <input
                type="checkbox"
                checked={visibleEmas[k]}
                onChange={(e) => setVisibleEmas((v) => ({ ...v, [k]: e.target.checked }))}
              />
              <i className="swatch" style={{ background: theme[k] }} />
              EMA {k.slice(3)}
            </label>
          ))}
          <label title={isIndex ? 'Indices have no traded volume' : undefined}>
            <input
              type="checkbox"
              checked={showVolume && !isIndex}
              disabled={isIndex}
              onChange={(e) => setShowVolume(e.target.checked)}
            />
            Volume
          </label>
          <label>
            <input type="checkbox" checked={showRsi} onChange={(e) => setShowRsi(e.target.checked)} />
            RSI
          </label>
        </div>
        <span className="status small">
          {loading
            ? 'Loading…'
            : chart && chartKey === key
              ? `${chart.candles.length.toLocaleString()} bars${chart.has_more ? '' : ' · start of history'}`
              : ''}
        </span>
      </section>

      <main className="chart-area">
        {loadError && <div className="overlay err">{loadError}</div>}
        {!authenticated && fyers && <div className="overlay">Connect Fyers to load charts.</div>}
        {chart && (
          <PriceChart
            data={chart}
            datasetKey={chartKey}
            intraday={!DAILY_TIMEFRAMES.has(tf)}
            theme={theme}
            visibleEmas={visibleEmas}
            showVolume={showVolume && !isIndex}
            showRsi={showRsi}
            onNeedMore={loadMore}
          />
        )}
      </main>
    </div>
  )
}

function SymbolSearch({ onPick }: { onPick: (hit: InstrumentHit) => void }) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<InstrumentHit[]>([])
  const [active, setActive] = useState(0)

  useEffect(() => {
    if (!query.trim()) {
      setHits([])
      return
    }
    const id = setTimeout(
      () =>
        api
          .search(query)
          .then((h) => {
            setHits(h)
            setActive(0)
          })
          .catch(() => setHits([])),
      150,
    )
    return () => clearTimeout(id)
  }, [query])

  const pick = (hit: InstrumentHit) => {
    onPick(hit)
    setQuery('')
    setHits([])
  }

  return (
    <div className="search">
      <input
        placeholder="Search symbol…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, hits.length - 1))
          else if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0))
          else if (e.key === 'Enter' && hits[active]) pick(hits[active])
          else if (e.key === 'Escape') setQuery('')
        }}
      />
      {hits.length > 0 && (
        <ul className="hits">
          {hits.map((h, i) => (
            <li key={h.symbol}>
              <button className={i === active ? 'active' : ''} onClick={() => pick(h)}>
                <b>{h.ticker}</b> <span>{h.name}</span> <em>{h.kind}</em>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default App
