import { useEffect, useState } from 'react'
import { api, type Health } from './api/client'

function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.health().then(setHealth).catch((e: Error) => setError(e.message))
  }, [])

  return (
    <main className="app">
      <h1>Indicator</h1>
      {error && <p className="status err">Backend unreachable: {error}</p>}
      {health && (
        <p className="status ok">
          Backend {health.status} · {health.candles.toLocaleString()} candles stored
        </p>
      )}
      {!health && !error && <p className="status">Connecting…</p>}
    </main>
  )
}

export default App
