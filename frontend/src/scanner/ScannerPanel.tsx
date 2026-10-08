import { useEffect, useMemo, useRef, useState } from 'react'
import { api, type InstrumentHit } from '../api/client'
import { usePref } from '../prefs'
import { CONDITION_DEFS, type ScanCatalog, type ScanCondition, type ScanJob, type ScanMatch } from './types'

type SortKey = 'ticker' | 'close' | 'change_pct'

interface Setup {
  universe: string
  tf: string
  custom: string
  presetId: string | null
  conditions: ScanCondition[]
}

/** Scanner side panel: pick a universe + conditions, run, open results. */
export function ScannerPanel({ onOpen }: { onOpen: (s: InstrumentHit) => void }) {
  const [catalog, setCatalog] = useState<ScanCatalog | null>(null)
  const [setup, setSetup] = usePref<Setup>('scannerSetup', {
    universe: 'nifty50',
    tf: '1D',
    custom: '',
    presetId: null,
    conditions: [],
  })
  const [job, setJob] = useState<ScanJob | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'change_pct', desc: true })
  const [picked, setPicked] = useState<string | null>(null)
  const poll = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    api
      .scannerCatalog()
      .then((c) => {
        setCatalog(c)
        // First visit: start from the first preset.
        setSetup((s) => (s.conditions.length ? s : { ...s, presetId: c.presets[0].id, conditions: c.presets[0].conditions }))
      })
      .catch((e: Error) => setError(e.message))
    return () => {
      if (poll.current) clearInterval(poll.current)
    }
  }, [setSetup])

  const set = (patch: Partial<Setup>) => setSetup((s) => ({ ...s, ...patch }))
  const setConditions = (conditions: ScanCondition[]) => set({ conditions, presetId: null })
  const running = job?.status === 'running'

  const run = async () => {
    setError(null)
    try {
      const custom = setup.custom.split(/[\s,]+/).filter(Boolean)
      const started = await api.runScan(setup.universe, setup.tf, setup.conditions, custom)
      setJob(started)
      if (poll.current) clearInterval(poll.current)
      poll.current = setInterval(async () => {
        try {
          const next = await api.scanJob(started.id)
          setJob(next)
          if (next.status !== 'running' && poll.current) clearInterval(poll.current)
        } catch (e) {
          setError((e as Error).message)
          if (poll.current) clearInterval(poll.current)
        }
      }, 1500)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const results = useMemo(() => {
    const list = [...(job?.matches ?? [])]
    list.sort((a, b) => {
      const v = sort.key === 'ticker' ? a.ticker.localeCompare(b.ticker) : (a[sort.key] as number) - (b[sort.key] as number)
      return sort.desc ? -v : v
    })
    return list
  }, [job, sort])

  const open = (m: ScanMatch) => {
    setPicked(m.symbol)
    const kind = m.symbol.startsWith('MCX:') ? 'COM' : m.symbol.endsWith('-INDEX') ? 'INDEX' : 'EQ'
    onOpen({ symbol: m.symbol, ticker: m.ticker, name: m.name, kind })
  }

  const header = (key: SortKey, label: string, num = false) => (
    <th
      className={num ? 'num sortable' : 'sortable'}
      aria-sort={sort.key === key ? (sort.desc ? 'descending' : 'ascending') : 'none'}
      onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== 'ticker' }))}
    >
      {label}
      {sort.key === key ? (sort.desc ? ' ▾' : ' ▴') : ''}
    </th>
  )

  if (!catalog) {
    return (
      <aside className="pattern-panel scanner-panel">
        <div className="panel-body">{error ? <p className="status err">{error}</p> : <p className="status">Loading…</p>}</div>
      </aside>
    )
  }

  const preset = catalog.presets.find((p) => p.id === setup.presetId)
  return (
    <aside className="pattern-panel scanner-panel" aria-label="Scanner">
      <div className="panel-head">
        <div className="scan-row">
          <select value={setup.universe} onChange={(e) => set({ universe: e.target.value })} aria-label="Universe">
            {catalog.universes.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <div className="segmented small" role="group" aria-label="Timeframe">
            {catalog.timeframes.map((t) => (
              <button key={t} className={setup.tf === t ? 'active' : ''} onClick={() => set({ tf: t })}>
                {t}
              </button>
            ))}
          </div>
        </div>
        {setup.universe === 'custom' && (
          <textarea
            className="scan-custom"
            rows={2}
            placeholder="Tickers, e.g. SBIN, TCS, NIFTY1!, CRUDEOIL1!"
            value={setup.custom}
            onChange={(e) => set({ custom: e.target.value })}
          />
        )}
        <select
          value={setup.presetId ?? ''}
          onChange={(e) => {
            const p = catalog.presets.find((x) => x.id === e.target.value)
            if (p) set({ presetId: p.id, conditions: p.conditions })
          }}
          aria-label="Preset"
        >
          <option value="" disabled>
            Custom conditions
          </option>
          {catalog.presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {preset && <p className="note">{preset.description}</p>}
      </div>

      <div className="panel-body">
        <div className="conditions">
          {setup.conditions.map((c, i) => (
            <ConditionCard
              key={i}
              condition={c}
              onChange={(next) => setConditions(setup.conditions.map((x, j) => (j === i ? next : x)))}
              onRemove={() => setConditions(setup.conditions.filter((_, j) => j !== i))}
            />
          ))}
          <select
            className="add-condition"
            value=""
            onChange={(e) => {
              const def = CONDITION_DEFS[e.target.value]
              if (def) setConditions([...setup.conditions, { type: e.target.value, params: { ...def.defaults } }])
            }}
            aria-label="Add condition"
          >
            <option value="">+ Add condition (all must match)</option>
            {catalog.conditions
              .filter((c) => CONDITION_DEFS[c])
              .map((c) => (
                <option key={c} value={c}>
                  {CONDITION_DEFS[c].name}
                </option>
              ))}
          </select>
        </div>

        <div className="scan-actions">
          {running ? (
            <button className="secondary-button" onClick={() => job && api.cancelScan(job.id).catch(() => {})}>
              Cancel
            </button>
          ) : (
            <button className="primary-button" disabled={!setup.conditions.length} onClick={run}>
              Run scan
            </button>
          )}
          {job && (
            <span className="status small">
              {job.status === 'running'
                ? `${job.done}/${job.total}${job.eta_seconds !== null ? ` · ~${formatEta(job.eta_seconds)} left` : ''}`
                : job.status === 'done'
                  ? `${job.matches.length} of ${job.total} matched · ${job.elapsed_seconds}s`
                  : job.message || job.status}
            </span>
          )}
        </div>
        {running && (
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={job.total} aria-valuenow={job.done}>
            <div style={{ width: `${(job.done / Math.max(1, job.total)) * 100}%` }} />
          </div>
        )}
        {running && job.done < job.total && job.done < 5 && (
          <p className="note">The first scan of a list downloads its daily history (a few minutes for 500 stocks); later scans are quick.</p>
        )}
        {error && <p className="status err">{error}</p>}

        {job && results.length > 0 && (
          <table className="stats scan-results">
            <thead>
              <tr>
                {header('ticker', 'Symbol')}
                {header('close', 'Close', true)}
                {header('change_pct', 'Chg %', true)}
              </tr>
            </thead>
            <tbody>
              {results.map((m) => (
                <tr key={m.symbol} className={picked === m.symbol ? 'picked' : ''} onClick={() => open(m)}>
                  <td>
                    <b>{m.ticker}</b>
                    {m.industry && <span className="muted"> · {m.industry}</span>}
                    <div className="scan-details">{m.details.join(' · ')}</div>
                  </td>
                  <td className="num">{m.close.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                  <td className={`num ${m.change_pct >= 0 ? 'pos' : 'neg'}`}>
                    {m.change_pct >= 0 ? '+' : ''}
                    {m.change_pct.toFixed(2)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {job && job.status === 'done' && results.length === 0 && (
          <p className="status">No matches. Loosen a condition (e.g. a wider range %) or try another list.</p>
        )}
        {job && job.errors.length > 0 && (
          <details className="note">
            <summary>{job.errors.length} symbols skipped</summary>
            {job.errors.map((e) => (
              <div key={e}>{e}</div>
            ))}
          </details>
        )}
      </div>
    </aside>
  )
}

function ConditionCard({
  condition,
  onChange,
  onRemove,
}: {
  condition: ScanCondition
  onChange: (c: ScanCondition) => void
  onRemove: () => void
}) {
  const def = CONDITION_DEFS[condition.type]
  if (!def) return null
  const params = { ...def.defaults, ...condition.params }
  const set = (key: string, value: number | string | boolean) => onChange({ ...condition, params: { ...params, [key]: value } })
  return (
    <div className="condition-card">
      <div className="condition-head">
        <b>{def.name}</b>
        <button className="icon-button" aria-label={`Remove ${def.name}`} onClick={onRemove}>
          <svg width="14" height="14" viewBox="0 0 18 18" stroke="currentColor" strokeWidth="1.5" aria-hidden>
            <path d="M4.5 4.5l9 9M13.5 4.5l-9 9" />
          </svg>
        </button>
      </div>
      <div className="condition-fields">
        {def.fields.map((f) => (
          <label key={f.key}>
            <span>{f.label}</span>
            {f.kind === 'select' ? (
              <select value={String(params[f.key])} onChange={(e) => set(f.key, e.target.value)}>
                {f.options.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            ) : f.kind === 'bool' ? (
              <input type="checkbox" checked={Boolean(params[f.key])} onChange={(e) => set(f.key, e.target.checked)} />
            ) : (
              <input
                type="number"
                value={Number(params[f.key])}
                min={f.min}
                max={f.max}
                step={f.step ?? (f.kind === 'int' ? 1 : 0.1)}
                onChange={(e) => set(f.key, Number(e.target.value))}
              />
            )}
          </label>
        ))}
      </div>
    </div>
  )
}

function formatEta(seconds: number): string {
  return seconds < 60 ? `${seconds}s` : `${Math.ceil(seconds / 60)} min`
}
