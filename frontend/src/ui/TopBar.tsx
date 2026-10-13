import { useEffect, useState, type ReactNode } from 'react'
import { api, type AuthStatus, type InstrumentHit, type InstrumentKind, type UserInfo } from '../api/client'
import { PasswordDialog, UsersDialog } from '../auth/UsersDialog'
import { ProfileDialog } from '../auth/ProfileDialog'
import type { ChartType } from '../chart/PriceChart'
import type { ThemeMode } from '../chart/theme'
import { Dropdown } from './Dropdown'
import { Modal } from './Modal'

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
  showPatterns: boolean
  onTogglePatterns: () => void
  patternCount: number | null
  themeMode: ThemeMode
  onThemeMode: (m: ThemeMode) => void
  dark: boolean
  auth: AuthStatus | null
  error: string | null
  onFyersChanged: () => void
  layoutMenu?: ReactNode
  showScanner: boolean
  onToggleScanner: () => void
  showWatchlist: boolean
  onToggleWatchlist: () => void
  user: UserInfo
  onSignOut: () => void
  showTester: boolean
  onToggleTester: () => void
  showAlerts: boolean
  onToggleAlerts: () => void
}

export function TopBar(p: Props) {
  const [searchOpen, setSearchOpen] = useState(false)
  const [accountDialog, setAccountDialog] = useState<'users' | 'password' | 'profile' | null>(null)
  const fyers = p.auth?.fyers
  const allTfs = TIMEFRAME_GROUPS.flatMap((g) => g.items)
  const favoriteTfs = allTfs.filter((i) => p.favorites.includes(i.tf))

  // Typing a letter anywhere (outside inputs) opens symbol search, like TradingView.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('input, textarea, select, [role=dialog]') || e.ctrlKey || e.metaKey || e.altKey) return
      if (/^[a-z]$/i.test(e.key)) setSearchOpen(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <header className="topbar">
      <button className="tool-button symbol-button" title="Symbol search" onClick={() => setSearchOpen(true)}>
        <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
          <circle cx="7.5" cy="7.5" r="5" />
          <path d="M11.5 11.5l4.5 4.5" />
        </svg>
        <b>{p.symbol.ticker}</b>
      </button>
      <span className="divider" />

      {favoriteTfs.map((i) => (
        <button
          key={i.tf}
          className={`tool-button tf ${p.tf === i.tf ? 'selected' : ''}`}
          title={i.name}
          onClick={() => p.onTf(i.tf)}
        >
          {i.tf}
        </button>
      ))}
      <Dropdown
        label={favoriteTfs.some((i) => i.tf === p.tf) ? '' : <b className="tf selected">{p.tf}</b>}
        title="Interval"
      >
        {(close) => (
          <div className="menu-list">
            {TIMEFRAME_GROUPS.map((g) => (
              <div key={g.label}>
                <div className="menu-heading">{g.label}</div>
                {g.items.map((i) => {
                  const fav = p.favorites.includes(i.tf)
                  return (
                    <div key={i.tf} className={`menu-item ${p.tf === i.tf ? 'selected' : ''}`}>
                      <button
                        className="menu-main"
                        onClick={() => {
                          p.onTf(i.tf)
                          close()
                        }}
                      >
                        {i.name}
                      </button>
                      <button
                        className={`star ${fav ? 'on' : ''}`}
                        title={fav ? 'Remove from favorites' : 'Add to favorites'}
                        aria-pressed={fav}
                        onClick={() =>
                          p.onFavorites(fav ? p.favorites.filter((f) => f !== i.tf) : [...p.favorites, i.tf])
                        }
                      >
                        ★
                      </button>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        )}
      </Dropdown>
      <span className="divider" />

      <Dropdown label={<ChartTypeIcon type={p.chartType} />} title="Chart type">
        {(close) => (
          <div className="menu-list">
            {CHART_TYPES.map((c) => (
              <div key={c.type} className={`menu-item ${p.chartType === c.type ? 'selected' : ''}`}>
                <button
                  className="menu-main"
                  onClick={() => {
                    p.onChartType(c.type)
                    close()
                  }}
                >
                  <ChartTypeIcon type={c.type} /> {c.name}
                </button>
              </div>
            ))}
          </div>
        )}
      </Dropdown>
      <span className="divider" />

      <button className="tool-button" onClick={p.onIndicators} title="Indicators">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
          <path d="M2 14c2.5 0 3-9 5.5-9S10 12 12 12s2.5-5 4-5" />
        </svg>
        Indicators
      </button>
      <button
        className={`tool-button ${p.showPatterns ? 'selected' : ''}`}
        aria-pressed={p.showPatterns}
        onClick={p.onTogglePatterns}
        title="Candlestick patterns"
      >
        Patterns{p.showPatterns && p.patternCount !== null ? ` · ${p.patternCount}` : ''}
      </button>
      <button
        className={`tool-button ${p.showScanner ? 'selected' : ''}`}
        aria-pressed={p.showScanner}
        onClick={p.onToggleScanner}
        title="Scan a list of stocks for setups"
      >
        <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
          <path d="M2 4h14M4 9h10M7 14h4" />
        </svg>
        Scanner
      </button>
      <button
        className={`tool-button ${p.showWatchlist ? 'selected' : ''}`}
        aria-pressed={p.showWatchlist}
        onClick={p.onToggleWatchlist}
        title="Watchlists with live prices"
      >
        <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
          <path d="M3 4h12M3 9h12M3 14h8" />
        </svg>
        Watchlist
      </button>
      <button
        className={`tool-button ${p.showTester ? 'selected' : ''}`}
        aria-pressed={p.showTester}
        onClick={p.onToggleTester}
        title="Backtest a strategy (Strategy Tester)"
      >
        <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
          <path d="M2 15h14M4 12l3-4 3 2 5-6" />
        </svg>
        Backtest
      </button>
      <button
        className={`tool-button ${p.showAlerts ? 'selected' : ''}`}
        aria-pressed={p.showAlerts}
        onClick={p.onToggleAlerts}
        title="Price, indicator and scan alerts"
      >
        <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
          <path d="M5 13V8a4 4 0 0 1 8 0v5l1.5 1.5h-11zM7.5 16h3" />
        </svg>
        Alerts
      </button>

      <span className="spacer" />
      {p.error && <span className="status err">Backend unreachable</span>}
      {fyers && p.user.role !== 'admin' &&
        (fyers.authenticated ? (
          <span className="status ok" title="Market data connected">
            ● Live data
          </span>
        ) : (
          <span className="status err" title="The shared Fyers connection is off. An admin needs to connect it.">
            ● Data paused
          </span>
        ))}
      {fyers && p.user.role === 'admin' &&
        (fyers.authenticated ? (
          <Dropdown align="right" title="Fyers session (valid until end of day)" label={<span className="status ok">● Fyers</span>}>
            {(close) => (
              <div className="menu-list">
                <div className="menu-heading">Fyers connected until end of day</div>
                <div className="menu-item">
                  <a className="menu-main" href={fyers.login_url}>
                    Reconnect Fyers
                  </a>
                </div>
                <div className="menu-item">
                  <button
                    className="menu-main"
                    onClick={() => {
                      close()
                      api.fyersLogout().finally(p.onFyersChanged)
                    }}
                  >
                    Disconnect
                  </button>
                </div>
              </div>
            )}
          </Dropdown>
        ) : fyers.configured ? (
          <a className="primary-button" href={fyers.login_url}>
            Connect Fyers
          </a>
        ) : (
          <span className="status err">Add Fyers keys to backend/.env</span>
        ))}
      {p.layoutMenu}
      <Dropdown
        align="right"
        title="Theme"
        label={
          <>
            <ThemeIcon dark={p.dark} /> {p.dark ? 'Dark' : 'Light'}
          </>
        }
      >
        {(close) => (
          <div className="menu-list">
            <div className="menu-heading">Theme</div>
            {(
              [
                ['dark', 'Dark'],
                ['light', 'Light'],
                ['system', 'Same as Windows'],
              ] as const
            ).map(([mode, name]) => (
              <div key={mode} className={`menu-item ${p.themeMode === mode ? 'selected' : ''}`}>
                <button
                  className="menu-main"
                  onClick={() => {
                    p.onThemeMode(mode)
                    close()
                  }}
                >
                  {name}
                </button>
              </div>
            ))}
          </div>
        )}
      </Dropdown>

      <Dropdown align="right" title="Account" label={<span className="user-chip">{p.user.username.slice(0, 1).toUpperCase()}</span>}>
        {(close) => (
          <div className="menu-list">
            <div className="menu-heading">
              Signed in as {p.user.username}
              {p.user.role === 'admin' ? ' · admin' : ''}
            </div>
            {p.user.role === 'admin' && (
              <div className="menu-item">
                <button
                  className="menu-main"
                  onClick={() => {
                    close()
                    setAccountDialog('users')
                  }}
                >
                  Manage users
                </button>
              </div>
            )}
            <div className="menu-item">
              <button
                className="menu-main"
                onClick={() => {
                  close()
                  setAccountDialog('profile')
                }}
              >
                Profile, notifications &amp; API keys
              </button>
            </div>
            <div className="menu-item">
              <button
                className="menu-main"
                onClick={() => {
                  close()
                  setAccountDialog('password')
                }}
              >
                Change password
              </button>
            </div>
            <div className="menu-item">
              <button
                className="menu-main"
                onClick={() => {
                  close()
                  p.onSignOut()
                }}
              >
                Sign out
              </button>
            </div>
          </div>
        )}
      </Dropdown>

      {accountDialog === 'users' && <UsersDialog me={p.user} onClose={() => setAccountDialog(null)} />}
      {accountDialog === 'password' && <PasswordDialog onClose={() => setAccountDialog(null)} />}
      {accountDialog === 'profile' && <ProfileDialog me={p.user} onClose={() => setAccountDialog(null)} />}

      {searchOpen && (
        <SymbolDialog
          onPick={(s) => {
            p.onSymbol(s)
            setSearchOpen(false)
          }}
          onClose={() => setSearchOpen(false)}
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

export function SymbolDialog({ onPick, onClose }: { onPick: (s: InstrumentHit) => void; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<InstrumentKind | null>(null)
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
          .search(query, kind)
          .then((h) => {
            setHits(h)
            setActive(0)
          })
          .catch(() => setHits([])),
      120,
    )
    return () => clearTimeout(id)
  }, [query, kind])

  const shown = hits

  return (
    <Modal title="Symbol Search" onClose={onClose} width={560}>
      <input
        className="dialog-search"
        placeholder="Symbol, e.g. RELIANCE, NIFTY1!, CRUDEOIL"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, shown.length - 1))
          else if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0))
          else if (e.key === 'Enter' && shown[active]) onPick(shown[active])
        }}
      />
      <div className="chip-row">
        {KIND_FILTERS.map((f) => (
          <button key={f.label} className={`chip ${kind === f.kind ? 'active' : ''}`} onClick={() => setKind(f.kind)}>
            {f.label}
          </button>
        ))}
      </div>
      <ul className="symbol-results">
        {shown.map((h, i) => (
          <li key={h.symbol}>
            <button className={i === active ? 'active' : ''} onClick={() => onPick(h)} onMouseEnter={() => setActive(i)}>
              <b>{h.ticker}</b>
              <span className="name">{h.name}</span>
              <span className="kind">
                {h.symbol.endsWith('1!') ? 'continuous' : KIND_LABELS[h.kind] ?? h.kind}
              </span>
              <span className="exchange">{h.exchange ?? h.symbol.split(':')[0]}</span>
            </button>
          </li>
        ))}
        {query.trim() && shown.length === 0 && <li className="empty">No symbols match.</li>}
      </ul>
    </Modal>
  )
}

function ThemeIcon({ dark }: { dark: boolean }) {
  return dark ? (
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <path d="M14.5 11.5A6 6 0 0 1 6.5 3.5a6 6 0 1 0 8 8z" />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <circle cx="9" cy="9" r="3.2" />
      <path d="M9 1.5v2M9 14.5v2M1.5 9h2M14.5 9h2M3.7 3.7l1.4 1.4M12.9 12.9l1.4 1.4M3.7 14.3l1.4-1.4M12.9 5.1l1.4-1.4" />
    </svg>
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
