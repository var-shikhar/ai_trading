import { useMemo, useState } from 'react'
import type { StudyDef } from '../api/client'
import { Modal } from '../ui/Modal'

const CATEGORY_ORDER = ['Moving averages', 'Trend', 'Momentum', 'Volatility', 'Volume']

/** TradingView-style "Indicators" picker: search + category filter; clicking
 * adds the indicator (the dialog stays open so several can be added). */
export function IndicatorDialog({
  catalog,
  hasVolume,
  volumeHidden,
  onAddVolume,
  onAdd,
  onClose,
}: {
  catalog: StudyDef[]
  hasVolume: boolean
  volumeHidden: boolean
  onAddVolume: () => void
  onAdd: (def: StudyDef) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [added, setAdded] = useState<string | null>(null)

  const categories = useMemo(
    () => CATEGORY_ORDER.filter((c) => catalog.some((d) => d.category === c)),
    [catalog],
  )
  const q = query.trim().toLowerCase()
  const items = catalog.filter(
    (d) =>
      (!category || d.category === category) &&
      (!q || d.name.toLowerCase().includes(q) || d.short.toLowerCase().includes(q)),
  )

  return (
    <Modal title="Indicators" onClose={onClose} width={640}>
      <div className="indicator-dialog">
        <input
          className="dialog-search"
          placeholder="Search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="indicator-columns">
          <nav className="indicator-categories">
            <button className={category === null ? 'active' : ''} onClick={() => setCategory(null)}>
              All
            </button>
            {categories.map((c) => (
              <button key={c} className={category === c ? 'active' : ''} onClick={() => setCategory(c)}>
                {c}
              </button>
            ))}
          </nav>
          <ul className="indicator-list">
            {volumeHidden && (!category || category === 'Volume') && (!q || 'volume'.includes(q)) && (
              <li>
                <button onClick={onAddVolume}>
                  <span>Volume</span>
                  <span className="muted">own pane</span>
                </button>
              </li>
            )}
            {items.map((d) => {
              const disabled = d.needs_volume && !hasVolume
              return (
                <li key={d.id}>
                  <button
                    disabled={disabled}
                    title={disabled ? 'Needs traded volume (not available for indices)' : undefined}
                    onClick={() => {
                      onAdd(d)
                      setAdded(d.id)
                    }}
                  >
                    <span>{d.name}</span>
                    <span className="muted">{added === d.id ? 'Added ✓' : d.overlay ? 'on chart' : 'own pane'}</span>
                  </button>
                </li>
              )
            })}
            {items.length === 0 && <li className="empty">No indicators match “{query}”.</li>}
          </ul>
        </div>
      </div>
    </Modal>
  )
}
