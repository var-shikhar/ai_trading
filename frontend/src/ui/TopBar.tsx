import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { api, type InstrumentHit, type InstrumentKind } from '../api/client'
import type { ChartType } from '../chart/PriceChart'
import { cx, Dropdown, EmptyState, ErrorText, MenuHeading, MenuItem, Modal, Skeleton, Spinner } from './kit'

export const TIMEFRAME_GROUPS: { label: string; items: { tf: string; name: string }[] }[] = [
  {
    label: 'Minutes',
    items: [
      { tf: '1m', name: '1 minute' },
      { tf: '5m', name: '5 minutes' },
      { tf: '15m', name: '15 minutes' },
      { tf: '30m', name: '30 minutes' },
    ],
  },
  {
    label: 'Hours',
    items: [
      { tf: '1h', name: '1 hour' },
      { tf: '2h', name: '2 hours' },
      { tf: '4h', name: '4 hours' },
    ],
  },
  {
    label: 'Days',
    items: [
      { tf: '1D', name: '1 day' },
      { tf: '1W', name: '1 week' },
      { tf: '1M', name: '1 month' },
    ],
  },
]

export const CHART_TYPES: { type: ChartType; name: string }[] = [
  { type: 'candles', name: 'Candles' },
  { type: 'hollow', name: 'Hollow candles' },
  { type: 'bars', name: 'Bars' },
  { type: 'heikin', name: 'Heikin Ashi' },
  { type: 'line', name: 'Line' },
  { type: 'area', name: 'Area' },
]

interface Props {
  symbol: InstrumentHit
  onSymbol: (s: InstrumentHit) => void
  tf: string
  onTf: (tf: string) => void
  favorites: string[]
  onFavorites: (f: string[]) => void
  chartType: ChartType
  onChartType: (t: ChartType) => void
  onIndicators: () => void
  layoutMenu?: ReactNode
  /** Right end of the bar, e.g. the strategy on the chart. */
  extra?: ReactNode
  /** Keyboard shortcuts on (off while another page is showing). */
  hotkeys: boolean
  /** Phones: back to the tab the stock was opened from. */
  onBack?: () => void
}

const Divider = () => <span className="mx-1 h-[22px] w-px shrink-0 bg-line max-md:mx-0.5" />

const barButton =
  'inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 text-[13px] whitespace-nowrap text-fg transition hover:bg-hover'

/** The chart's own toolbar: symbol, interval, chart type, indicators, layout.
 * App sections live in the nav rail; panels in the chart's right rail. */
export function TopBar(p: Props) {
  // Open search, with the letter that opened it (typed on the chart) as the start of the query.
  const [search, setSearch] = useState<{ query: string } | null>(null)
  const allTfs = TIMEFRAME_GROUPS.flatMap((g) => g.items)
  const favoriteTfs = allTfs.filter((i) => p.favorites.includes(i.tf))
  const tfIsFavorite = favoriteTfs.some((i) => i.tf === p.tf)

  // Typing a letter anywhere (outside inputs and dialogs) opens symbol search, like TradingView.
  useEffect(() => {
    if (!p.hotkeys) return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('input, textarea, select, [role=dialog]') || e.ctrlKey || e.metaKey || e.altKey) return
      if (document.querySelector('[role=dialog]')) return
      if (/^[a-z]$/i.test(e.key)) {
        e.preventDefault()
        setSearch((s) => s ?? { query: e.key.toUpperCase() })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [p.hotkeys])

  return (
    <header className="flex h-11 shrink-0 items-center gap-0.5 border-b-4 border-line bg-surface px-2 text-fg max-md:border-b max-md:px-1">
      {p.onBack && (
        <button
          className="inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md text-fg transition hover:bg-hover active:bg-hover"
          aria-label="Back"
          onClick={p.onBack}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
            <path d="M12.5 4l-6 6 6 6" />
          </svg>
        </button>
      )}
      {/* The one item that gives way on narrow phones (the ticker truncates). */}
      <button
        className={cx(barButton.replace('shrink-0', 'shrink'), 'min-w-0 max-w-[40vw] md:max-w-[220px]')}
        title="Symbol search" onClick={() => setSearch({ query: '' })}>
        <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden className="shrink-0 text-muted">
          <circle cx="7.5" cy="7.5" r="5" />
          <path d="M11.5 11.5l4.5 4.5" />
        </svg>
        <b className="truncate text-[14px] font-semibold">{p.symbol.ticker}</b>
      </button>
      <Divider />

      {favoriteTfs.map((i) => (
        <button
          key={i.tf}
          className={cx(barButton, 'min-w-8 justify-center font-medium max-md:hidden', p.tf === i.tf && 'text-accent')}
          title={i.name}
          aria-pressed={p.tf === i.tf}
          onClick={() => p.onTf(i.tf)}
        >
          {i.tf}
        </button>
      ))}
      <Dropdown
        // The current interval shows here when it isn't a favorite, and always on phones (no favorites row).
        label={<b className={cx('font-semibold text-accent', tfIsFavorite && 'md:hidden')}>{p.tf}</b>}
        title="Interval"
      >
        {(close) => (
          <div className="w-[230px]">
            {TIMEFRAME_GROUPS.map((g) => (
              <div key={g.label}>
                <MenuHeading>{g.label}</MenuHeading>
                {g.items.map((i) => {
                  const fav = p.favorites.includes(i.tf)
                  return (
                    <MenuItem
                      key={i.tf}
                      selected={p.tf === i.tf}
                      onClick={() => {
                        p.onTf(i.tf)
                        close()
                      }}
                      right={
                        <button
                          className={cx(
                            'ml-0.5 inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-[15px] transition hover:bg-hover',
                            fav ? 'text-star' : 'text-muted/50 hover:text-star',
                          )}
                          title={fav ? 'Remove from favorites' : 'Add to favorites'}
                          aria-label={fav ? `Remove ${i.name} from favorites` : `Add ${i.name} to favorites`}
                          aria-pressed={fav}
                          onClick={() => p.onFavorites(fav ? p.favorites.filter((f) => f !== i.tf) : [...p.favorites, i.tf])}
                        >
                          ★
                        </button>
                      }
                    >
                      <span className="w-9 shrink-0 font-semibold">{i.tf}</span>
                      <span className="text-muted">{i.name}</span>
                    </MenuItem>
                  )
                })}
              </div>
            ))}
          </div>
        )}
      </Dropdown>
      <Divider />

      <Dropdown label={<ChartTypeIcon type={p.chartType} />} title="Chart type">
        {(close) =>
          CHART_TYPES.map((c) => (
            <MenuItem
              key={c.type}
              selected={p.chartType === c.type}
              onClick={() => {
                p.onChartType(c.type)
                close()
              }}
            >
              <ChartTypeIcon type={c.type} /> {c.name}
            </MenuItem>
          ))
        }
      </Dropdown>
      <Divider />

      <button className={barButton} onClick={p.onIndicators} title="Indicators" aria-label="Indicators">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
          <path d="M2 14c2.5 0 3-9 5.5-9S10 12 12 12s2.5-5 4-5" />
        </svg>
        <span className="max-md:hidden">Indicators</span>
      </button>
      {p.layoutMenu}

      <span className="min-w-1 flex-1" />
      {p.extra}

      {search && (
        <SymbolDialog
          initialQuery={search.query}
          onPick={(s) => {
            p.onSymbol(s)
            setSearch(null)
          }}
          onClose={() => setSearch(null)}
        />
      )}
    </header>
  )
}

const KIND_FILTERS: { kind: InstrumentKind | null; label: string }[] = [
  { kind: null, label: 'All' },
  { kind: 'EQ', label: 'Stocks' },
  { kind: 'INDEX', label: 'Indices' },
  { kind: 'FUT', label: 'Futures' },
  { kind: 'COM', label: 'Commodities' },
  { kind: 'ETF', label: 'ETFs' },
]

const KIND_LABELS: Record<InstrumentKind, string> = {
  EQ: 'stock',
  ETF: 'fund',
  INDEX: 'index',
  FUT: 'futures',
  COM: 'commodity',
}

/** `value`, once it has stopped changing for `ms`. */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return v
}

export function SymbolDialog({
  onPick,
  onClose,
  title = 'Symbol Search',
  isAdded,
  onToggle,
  initialQuery = '',
}: {
  onPick: (s: InstrumentHit) => void
  onClose: () => void
  title?: string
  /** Add mode (watchlists): the dialog stays open and marks symbols already added. */
  isAdded?: (symbol: string) => boolean
  /** With isAdded: the +/✓ is its own button calling this, and a row tap still calls onPick. */
  onToggle?: (s: InstrumentHit) => void
  /** Text the search starts with. */
  initialQuery?: string
}) {
  const [query, setQuery] = useState(initialQuery)
  const [kind, setKind] = useState<InstrumentKind | null>(null)
  const q = useDebounced(query.trim(), 150)
  const search = useQuery({
    queryKey: ['instruments', 'search', q, kind],
    queryFn: () => api.search(q, kind),
    enabled: q.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  })
  const hits = q ? (search.data ?? []) : []
  // The highlighted row; back to the first whenever the results change.
  const resultsKey = `${q}|${kind}`
  const [sel, setSel] = useState({ key: '', i: 0 })
  const active = sel.key === resultsKey ? Math.min(sel.i, Math.max(hits.length - 1, 0)) : 0
  const setActive = (i: number) => setSel({ key: resultsKey, i })
  const listRef = useRef<HTMLUListElement>(null)
  useEffect(() => {
    listRef.current?.querySelector('[data-active=true]')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const typing = query.trim() !== q
  const busy = typing || search.isFetching
  // A query's first results: placeholders instead of an empty list.
  const firstLoad = !!query.trim() && hits.length === 0 && busy
  const ownAddButton = !!isAdded && !!onToggle

  return (
    <Modal title={title} onClose={onClose} width={600}>
      <div className="-mx-5 -my-4 flex h-[calc(100%+2rem)] flex-col md:h-[min(560px,72vh)]">
        <div className="flex shrink-0 flex-col gap-3 border-b border-line px-5 pt-4 pb-3">
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
              enterKeyHint="search"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="characters"
              spellCheck={false}
              aria-label="Search symbols"
              className="h-11 w-full min-w-0 rounded-xl border border-line bg-surface pr-10 pl-10 text-[15px] text-fg outline-none transition placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent-soft max-md:text-[16px]"
              placeholder="Symbol, e.g. RELIANCE, NIFTY1!, CRUDEOIL"
              value={query}
              // A query started by typing on the chart: keep typing after it.
              onFocus={(e) => e.currentTarget.setSelectionRange(query.length, query.length)}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setActive(Math.min(active + 1, hits.length - 1))
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setActive(Math.max(active - 1, 0))
                } else if (e.key === 'Enter' && hits[active] && !typing) onPick(hits[active])
              }}
            />
            <span className="absolute top-1/2 right-2.5 flex -translate-y-1/2 items-center text-muted">
              {busy && query.trim() ? (
                <Spinner size={16} />
              ) : query ? (
                <button
                  className="inline-flex size-7 cursor-pointer items-center justify-center rounded-full hover:bg-hover hover:text-fg"
                  aria-label="Clear search"
                  onClick={() => setQuery('')}
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.6" aria-hidden>
                    <path d="M3 3l6 6M9 3l-6 6" />
                  </svg>
                </button>
              ) : null}
            </span>
          </div>
          <div className="-mx-5 flex gap-1.5 overflow-x-auto px-5 [scrollbar-width:none]">
            {KIND_FILTERS.map((f) => (
              <button
                key={f.label}
                aria-pressed={kind === f.kind}
                className={cx(
                  'h-8 shrink-0 cursor-pointer rounded-full border px-3 text-[13px] font-medium whitespace-nowrap transition',
                  kind === f.kind ? 'border-accent bg-accent-soft text-accent' : 'border-line text-muted hover:bg-hover hover:text-fg',
                )}
                onClick={() => setKind(f.kind)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {!query.trim() ? (
            <EmptyState title="Search for a symbol">Stocks, indices, futures (e.g. NIFTY1!), commodities and ETFs.</EmptyState>
          ) : search.isError && !busy ? (
            <ErrorText className="m-4">Search failed: {search.error.message}</ErrorText>
          ) : firstLoad ? (
            <ResultSkeleton />
          ) : hits.length === 0 ? (
            <EmptyState title="No symbols match">Check the spelling, or try another filter.</EmptyState>
          ) : (
            <ul ref={listRef} role="listbox" aria-label="Symbols" className={cx('py-1 transition-opacity', busy && 'opacity-60')}>
              {hits.map((h, i) => {
                const added = isAdded?.(h.symbol) ?? false
                const kindLabel = h.symbol.endsWith('1!') ? 'continuous' : (KIND_LABELS[h.kind] ?? h.kind)
                return (
                  <li
                    key={h.symbol}
                    data-active={i === active}
                    className={cx('flex items-center gap-1 border-b border-line/60 pr-3 last:border-b-0', i === active && 'bg-hover')}
                  >
                    <button
                      role="option"
                      aria-selected={i === active}
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 py-2.5 pl-5 text-left"
                      onClick={() => onPick(h)}
                      onMouseMove={() => i !== active && setActive(i)}
                    >
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5 md:flex-row md:items-center md:gap-3">
                        <b className="shrink-0 truncate text-[14px] font-semibold text-fg md:w-[120px]">{h.ticker}</b>
                        <span className="min-w-0 truncate text-[13px] text-muted">{h.name}</span>
                      </span>
                      <span className="shrink-0 rounded bg-hover px-1.5 py-0.5 text-[11px] text-muted">{kindLabel}</span>
                      <span className="w-12 shrink-0 text-right text-[12px] font-medium text-muted max-md:hidden">
                        {h.exchange ?? h.symbol.split(':')[0]}
                      </span>
                      {isAdded && !onToggle && <AddMark added={added} />}
                    </button>
                    {ownAddButton && (
                      <button
                        className="shrink-0 cursor-pointer rounded-full p-1 transition hover:bg-accent-soft"
                        title={added ? 'Remove from watchlist' : 'Add to watchlist'}
                        aria-label={added ? `Remove ${h.ticker} from watchlist` : `Add ${h.ticker} to watchlist`}
                        aria-pressed={added}
                        onClick={() => onToggle(h)}
                      >
                        <AddMark added={added} />
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  )
}

function AddMark({ added }: { added: boolean }) {
  return (
    <span
      aria-label={added ? 'In list' : 'Add'}
      className={cx(
        'inline-flex size-[26px] shrink-0 items-center justify-center rounded-full border border-accent text-[14px] leading-none font-bold transition',
        added ? 'bg-accent text-accent-fg' : 'text-accent',
      )}
    >
      {added ? '✓' : '+'}
    </span>
  )
}

function ResultSkeleton() {
  return (
    <div className="py-1" aria-busy aria-label="Searching">
      {Array.from({ length: 7 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 border-b border-line/60 px-5 py-3.5">
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="h-3 max-w-56 flex-1" />
          <Skeleton className="ml-auto h-4 w-12" />
        </div>
      ))}
    </div>
  )
}

function ChartTypeIcon({ type }: { type: ChartType }) {
  const common = { width: 18, height: 18, viewBox: '0 0 18 18', fill: 'none', stroke: 'currentColor', 'aria-hidden': true }
  switch (type) {
    case 'line':
      return (
        <svg {...common} strokeWidth="1.5">
          <path d="M2 13l4-5 3 3 5-7 2 2" />
        </svg>
      )
    case 'area':
      return (
        <svg {...common} strokeWidth="1.5">
          <path d="M2 13l4-5 3 3 5-7 2 2" />
          <path d="M2 16h14" opacity=".5" />
        </svg>
      )
    case 'bars':
      return (
        <svg {...common} strokeWidth="1.4">
          <path d="M5 3v12M3 6h2M5 12h2M12 5v10M10 7h2M12 13h2" />
        </svg>
      )
    default:
      return (
        <svg {...common} strokeWidth="1.3">
          <path d="M6 2v3M6 13v3M12 4v3M12 13v2" />
          <rect x="4" y="5" width="4" height="8" rx=".5" fill={type === 'hollow' ? 'none' : 'currentColor'} />
          <rect x="10" y="7" width="4" height="6" rx=".5" />
        </svg>
      )
  }
}
