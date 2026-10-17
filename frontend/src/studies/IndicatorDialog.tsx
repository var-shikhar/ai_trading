import { useMemo, useState } from 'react'
import type { StudyDef } from '../api/client'
import { cx, EmptyState, Modal } from '../ui/kit'

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
  // Indicators added while the dialog is open (several of one kind can be added).
  const [added, setAdded] = useState<Record<string, number>>({})

  const categories = useMemo(() => CATEGORY_ORDER.filter((c) => catalog.some((d) => d.category === c)), [catalog])
  const q = query.trim().toLowerCase()
  const items = catalog.filter(
    (d) => (!category || d.category === category) && (!q || d.name.toLowerCase().includes(q) || d.short.toLowerCase().includes(q)),
  )
  const showVolume = volumeHidden && (!category || category === 'Volume') && (!q || 'volume'.includes(q))

  const categoryButton = (value: string | null, label: string) => (
    <button
      key={label}
      aria-pressed={category === value}
      onClick={() => setCategory(value)}
      className={cx(
        'shrink-0 cursor-pointer text-[13px] font-medium whitespace-nowrap transition',
        // Phones: a row of chips; desktop: a side list.
        'max-md:h-8 max-md:rounded-full max-md:border max-md:px-3',
        'md:rounded-lg md:px-3 md:py-2 md:text-left',
        category === value
          ? 'text-accent max-md:border-accent max-md:bg-accent-soft md:bg-selected'
          : 'text-muted hover:text-fg max-md:border-line md:hover:bg-hover',
      )}
    >
      {label}
    </button>
  )

  return (
    <Modal title="Indicators" onClose={onClose} width={680}>
      <div className="-mx-5 -my-4 flex h-[calc(100%+2rem)] flex-col md:h-[min(540px,72vh)]">
        <div className="shrink-0 border-b border-line px-5 pt-4 pb-3">
          <div className="relative">
            <svg
              width="18"
              height="18"
              viewBox="0 0 18 18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
            >
              <circle cx="7.5" cy="7.5" r="5" />
              <path d="M11.5 11.5l4.5 4.5" />
            </svg>
            <input
              autoFocus
              aria-label="Search indicators"
              autoComplete="off"
              className="h-11 w-full min-w-0 rounded-xl border border-line bg-surface pr-3 pl-10 text-[15px] text-fg outline-none transition placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent-soft max-md:text-[16px]"
              placeholder="Search, e.g. RSI, moving average"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
        <div className="flex min-h-0 flex-1 max-md:flex-col">
          <nav
            aria-label="Categories"
            className="flex shrink-0 gap-1.5 max-md:overflow-x-auto max-md:px-5 max-md:py-2.5 max-md:[scrollbar-width:none] md:w-[180px] md:flex-col md:gap-0.5 md:border-r md:border-line md:p-2"
          >
            {categoryButton(null, 'All')}
            {categories.map((c) => categoryButton(c, c))}
          </nav>
          <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 max-md:pt-0">
            {showVolume && (
              <IndicatorRow name="Volume" tag="own pane" onClick={onAddVolume} />
            )}
            {items.map((d) => {
              const disabled = d.needs_volume && !hasVolume
              return (
                <IndicatorRow
                  key={d.id}
                  name={d.name}
                  short={d.short !== d.name ? d.short : undefined}
                  tag={d.overlay ? 'on chart' : 'own pane'}
                  added={added[d.id]}
                  disabled={disabled}
                  title={disabled ? 'Needs traded volume (not available for indices)' : undefined}
                  onClick={() => {
                    onAdd(d)
                    setAdded((a) => ({ ...a, [d.id]: (a[d.id] ?? 0) + 1 }))
                  }}
                />
              )
            })}
            {items.length === 0 && !showVolume && (
              <li>
                <EmptyState title="No indicators match">{q ? `Nothing found for “${query.trim()}”.` : 'This category is empty.'}</EmptyState>
              </li>
            )}
          </ul>
        </div>
      </div>
    </Modal>
  )
}

function IndicatorRow({
  name,
  short,
  tag,
  added,
  disabled,
  title,
  onClick,
}: {
  name: string
  short?: string
  tag: string
  added?: number
  disabled?: boolean
  title?: string
  onClick: () => void
}) {
  return (
    <li>
      <button
        disabled={disabled}
        title={title}
        onClick={onClick}
        className="group flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-hover disabled:cursor-default disabled:opacity-45 disabled:hover:bg-transparent max-md:py-3"
      >
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="truncate text-[14px] text-fg">{name}</span>
          {short && <span className="shrink-0 text-[12px] text-muted">{short}</span>}
        </span>
        {added ? (
          <span className="shrink-0 rounded-full bg-up-soft px-2 py-0.5 text-[11px] font-semibold text-up">
            Added{added > 1 ? ` ×${added}` : ''} ✓
          </span>
        ) : (
          <span
            className={cx(
              'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium',
              tag === 'on chart' ? 'bg-accent-soft text-accent' : 'bg-hover text-muted',
            )}
          >
            {tag}
          </span>
        )}
        <span
          aria-hidden
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[16px] leading-none text-accent opacity-0 transition group-hover:opacity-100 group-disabled:hidden max-md:hidden"
        >
          +
        </span>
      </button>
    </li>
  )
}
