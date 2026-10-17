import { patternKey, type ChartPattern, type ChartPatternResult, type ChartPatternSettings } from './chartPatterns'
import { formatBarTime } from './PatternPanel'

const STATUS_ORDER = { forming: 0, confirmed: 1, failed: 2 }

/** Chart patterns tab of the Patterns side panel. */
export function ChartPatternSection({
  settings,
  onSettings,
  result,
  loading,
  error,
  intraday,
  highlight,
  onPick,
}: {
  settings: ChartPatternSettings
  onSettings: (s: ChartPatternSettings) => void
  result: ChartPatternResult | null
  loading: boolean
  error: string | null
  intraday: boolean
  highlight: string | null
  onPick: (p: ChartPattern) => void
}) {
  const set = (patch: Partial<ChartPatternSettings>) => onSettings({ ...settings, ...patch })
  const patterns = [...(result?.patterns ?? [])]
    .filter((p) => settings.showFailed || p.status !== 'failed')
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.end_time - a.end_time)
  const hidden = new Set(settings.hidden ?? [])
  // Keep only keys of patterns still found, so the list doesn't grow forever.
  const current = new Set((result?.patterns ?? []).map(patternKey))
  const setHidden = (keys: Iterable<string>) => set({ hidden: [...keys].filter((k) => current.has(k)) })
  const toggle = (k: string) => {
    const next = new Set(hidden)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    setHidden(next)
  }
  const allHidden = patterns.length > 0 && patterns.every((p) => hidden.has(patternKey(p)))

  return (
    <>
      <div className="panel-head">
        <div className="segmented small" role="group" aria-label="Sensitivity">
          {(['low', 'medium', 'high'] as const).map((s) => (
            <button
              key={s}
              className={settings.sensitivity === s ? 'active' : ''}
              title={
                s === 'low' ? 'Major swings only (3× ATR)' : s === 'medium' ? 'Swing trading (2× ATR)' : 'Minor swings too (1.3× ATR)'
              }
              onClick={() => set({ sensitivity: s })}
            >
              {s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <label className="check">
          <input type="checkbox" checked={settings.showZones} onChange={(e) => set({ showZones: e.target.checked })} />
          Support / resistance zones
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.showFailed} onChange={(e) => set({ showFailed: e.target.checked })} />
          Show failed patterns
        </label>
      </div>
      <div className="panel-body">
        {error && <p className="status err">{error}</p>}
        {loading && !result && <p className="status">Scanning…</p>}
        {result && patterns.length === 0 && <p className="status">No chart patterns on the loaded bars.</p>}
        {patterns.length > 0 && (
          <div className="pattern-visibility">
            <span className="muted">
              {patterns.length - patterns.filter((p) => hidden.has(patternKey(p))).length} of {patterns.length} on the chart
            </span>
            <button
              className="link-button"
              onClick={() =>
                setHidden(allHidden ? [...hidden].filter((k) => !patterns.some((p) => patternKey(p) === k)) : [...hidden, ...patterns.map(patternKey)])
              }
            >
              {allHidden ? 'Show all' : 'Hide all'}
            </button>
          </div>
        )}
        <ul className="hit-list">
          {patterns.map((p) => (
            <li key={patternKey(p)} className={`with-eye ${hidden.has(patternKey(p)) ? 'is-hidden' : ''}`}>
              <button
                className="eye-button"
                aria-pressed={!hidden.has(patternKey(p))}
                title={hidden.has(patternKey(p)) ? 'Show on the chart' : 'Hide from the chart'}
                onClick={() => toggle(patternKey(p))}
              >
                <EyeIcon off={hidden.has(patternKey(p))} />
              </button>
              <button className={highlight === patternKey(p) ? 'picked' : ''} onClick={() => onPick(p)}>
                <span className={`dir ${p.direction}`}>{p.direction === 'bullish' ? '▲' : p.direction === 'bearish' ? '▼' : '◆'}</span>
                <span className="hit-name">
                  {p.name} <em className={`badge ${p.status}`}>{p.status}</em>
                </span>
                <span className="hit-time">
                  {formatBarTime(p.start_time, intraday)} → {formatBarTime(p.end_time, intraday)}
                </span>
                <span className="hit-move">
                  {p.target !== null && p.status !== 'failed' ? `→ ${p.target.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {result && settings.showZones && result.zones.length > 0 && (
          <>
            <p className="note section-title">Zones (strongest first)</p>
            <table className="stats">
              <thead>
                <tr>
                  <th>Zone</th>
                  <th className="num">Range</th>
                  <th className="num">Touches</th>
                </tr>
              </thead>
              <tbody>
                {result.zones.map((z) => (
                  <tr key={`${z.low}-${z.high}`}>
                    <td>
                      <span className={`dir ${z.kind === 'support' ? 'bullish' : 'bearish'}`}>■</span>{' '}
                      {z.kind === 'support' ? 'Support' : 'Resistance'}
                    </td>
                    <td className="num">
                      {z.low.toLocaleString('en-IN', { maximumFractionDigits: 2 })} –{' '}
                      {z.high.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                    </td>
                    <td className="num">{z.touches}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </>
  )
}

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <path d="M1.5 9s2.8-5 7.5-5 7.5 5 7.5 5-2.8 5-7.5 5-7.5-5-7.5-5z" />
      <circle cx="9" cy="9" r="2.2" />
      {off && <path d="M3 15L15 3" />}
    </svg>
  )
}
