import { useState } from 'react'
import type { StudyDef } from '../api/client'
import { resolveColor, type ChartTheme } from '../chart/theme'
import { Modal } from '../ui/Modal'
import { defaultParams, type StudyInstance } from './model'

/** Settings dialog with Inputs and Style tabs, like TradingView's. Changes
 * apply on OK; Cancel discards them. */
export function StudySettings({
  def,
  inst,
  theme,
  onSave,
  onClose,
}: {
  def: StudyDef
  inst: StudyInstance
  theme: ChartTheme
  onSave: (inst: StudyInstance) => void
  onClose: () => void
}) {
  const [tab, setTab] = useState<'inputs' | 'style'>(def.inputs.length ? 'inputs' : 'style')
  const [draft, setDraft] = useState<StudyInstance>(inst)
  const setParam = (key: string, value: number | string) =>
    setDraft((d) => ({ ...d, params: { ...d.params, [key]: value } }))

  return (
    <Modal
      title={def.name}
      onClose={onClose}
      width={420}
      footer={
        <>
          <button className="link-button" onClick={() => setDraft((d) => ({ ...d, params: defaultParams(def) }))}>
            Defaults
          </button>
          <span className="spacer" />
          <button className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary-button"
            onClick={() => {
              onSave(draft)
              onClose()
            }}
          >
            Ok
          </button>
        </>
      }
    >
      <div className="tabs underline">
        {def.inputs.length > 0 && (
          <button className={tab === 'inputs' ? 'active' : ''} onClick={() => setTab('inputs')}>
            Inputs
          </button>
        )}
        <button className={tab === 'style' ? 'active' : ''} onClick={() => setTab('style')}>
          Style
        </button>
      </div>

      {tab === 'inputs' && (
        <div className="form-grid">
          {def.inputs.map((i) => (
            <label key={i.key}>
              <span>{i.name}</span>
              {i.type === 'source' ? (
                <select value={String(draft.params[i.key] ?? i.default)} onChange={(e) => setParam(i.key, e.target.value)}>
                  {(i.options ?? []).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="number"
                  value={draft.params[i.key] ?? i.default}
                  min={i.min}
                  max={i.max}
                  step={i.step ?? (i.type === 'int' ? 1 : 0.1)}
                  onChange={(e) => setParam(i.key, e.target.value === '' ? '' : Number(e.target.value))}
                />
              )}
            </label>
          ))}
        </div>
      )}

      {tab === 'style' && (
        <div className="form-grid">
          {def.outputs.map((o) => {
            const token = draft.colors[o.key] ?? 'slot:0'
            if (token === 'signed') {
              return (
                <label key={o.key}>
                  <span>{o.name}</span>
                  <span className="muted">green above zero, red below</span>
                </label>
              )
            }
            return (
              <label key={o.key}>
                <span>{o.name}</span>
                <span className="color-row">
                  {theme.series.map((c, n) => (
                    <button
                      key={c}
                      className={`swatch-button ${token === `slot:${n}` ? 'active' : ''}`}
                      style={{ background: c }}
                      aria-label={`Color ${n + 1}`}
                      onClick={(e) => {
                        e.preventDefault()
                        setDraft((d) => ({ ...d, colors: { ...d.colors, [o.key]: `slot:${n}` } }))
                      }}
                    />
                  ))}
                  <input
                    type="color"
                    aria-label="Custom color"
                    value={toHex(resolveColor(token, theme))}
                    onChange={(e) => setDraft((d) => ({ ...d, colors: { ...d.colors, [o.key]: e.target.value } }))}
                  />
                </span>
              </label>
            )
          })}
          {def.outputs.some((o) => o.style === 'line') && (
            <label>
              <span>Line width</span>
              <select
                value={draft.lineWidth}
                onChange={(e) => setDraft((d) => ({ ...d, lineWidth: Number(e.target.value) }))}
              >
                {[1, 2, 3, 4].map((w) => (
                  <option key={w} value={w}>
                    {w}px
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
    </Modal>
  )
}

function toHex(color: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? color : '#2962ff'
}
