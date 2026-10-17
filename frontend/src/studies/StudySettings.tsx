import { useState } from 'react'
import type { StudyDef } from '../api/client'
import { resolveColor, type ChartTheme } from '../chart/theme'
import { Button, cx, Field, Input, Modal, Select, Tabs } from '../ui/kit'
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
  const setParam = (key: string, value: number | string) => setDraft((d) => ({ ...d, params: { ...d.params, [key]: value } }))
  const save = () => {
    // A cleared number field means "default", not an empty value the chart can't use.
    const params = { ...draft.params }
    for (const i of def.inputs) if (params[i.key] === '' || params[i.key] === undefined) params[i.key] = i.default
    onSave({ ...draft, params })
    onClose()
  }

  return (
    <Modal
      title={def.name}
      onClose={onClose}
      width={440}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => setDraft((d) => ({ ...d, params: defaultParams(def) }))}>
            Reset to defaults
          </Button>
          <span className="flex-1" />
          <Button size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" onClick={save}>
            Ok
          </Button>
        </>
      }
    >
      <Tabs
        className="-mx-5 -mt-4 mb-4 border-b border-line px-3"
        value={tab}
        onChange={setTab}
        items={[...(def.inputs.length ? [{ id: 'inputs' as const, label: 'Inputs' }] : []), { id: 'style' as const, label: 'Style' }]}
      />

      {tab === 'inputs' && (
        <form
          className="grid grid-cols-1 gap-3.5 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
        >
          {def.inputs.map((i) => (
            <Field key={i.key} label={i.name}>
              {i.type === 'source' ? (
                <Select value={String(draft.params[i.key] ?? i.default)} onChange={(e) => setParam(i.key, e.target.value)}>
                  {(i.options ?? []).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  type="number"
                  inputMode={i.type === 'int' ? 'numeric' : 'decimal'}
                  value={draft.params[i.key] ?? i.default}
                  min={i.min}
                  max={i.max}
                  step={i.step ?? (i.type === 'int' ? 1 : 0.1)}
                  onChange={(e) => setParam(i.key, e.target.value === '' ? '' : Number(e.target.value))}
                />
              )}
            </Field>
          ))}
          {/* Enter in a field saves, like OK. */}
          <button type="submit" hidden />
        </form>
      )}

      {tab === 'style' && (
        <div className="flex flex-col gap-4">
          {def.outputs.map((o) => {
            const token = draft.colors[o.key] ?? 'slot:0'
            return (
              <div key={o.key} className="flex flex-col gap-1.5">
                <span className="text-[12px] font-medium text-muted">{o.name}</span>
                {token === 'signed' ? (
                  <span className="text-[13px] text-muted">
                    <span className="text-up">green</span> above zero, <span className="text-down">red</span> below
                  </span>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    {theme.series.map((c, n) => (
                      <button
                        key={c}
                        type="button"
                        className={cx(
                          'size-7 cursor-pointer rounded-full border-2 transition hover:scale-110',
                          token === `slot:${n}` ? 'border-fg ring-2 ring-accent-soft' : 'border-transparent',
                        )}
                        style={{ background: c }}
                        aria-label={`Color ${n + 1}`}
                        aria-pressed={token === `slot:${n}`}
                        onClick={() => setDraft((d) => ({ ...d, colors: { ...d.colors, [o.key]: `slot:${n}` } }))}
                      />
                    ))}
                    <label
                      title="Custom color"
                      className={cx(
                        'relative size-7 cursor-pointer overflow-hidden rounded-full border-2 transition hover:scale-110',
                        token.startsWith('#') ? 'border-fg ring-2 ring-accent-soft' : 'border-line',
                      )}
                      style={{ background: token.startsWith('#') ? token : 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)' }}
                    >
                      <input
                        type="color"
                        aria-label="Custom color"
                        className="absolute inset-0 size-full cursor-pointer opacity-0"
                        value={toHex(resolveColor(token, theme))}
                        onChange={(e) => setDraft((d) => ({ ...d, colors: { ...d.colors, [o.key]: e.target.value } }))}
                      />
                    </label>
                  </div>
                )}
              </div>
            )
          })}
          {def.outputs.some((o) => o.style === 'line') && (
            <Field label="Line width" className="max-w-40">
              <Select value={draft.lineWidth} onChange={(e) => setDraft((d) => ({ ...d, lineWidth: Number(e.target.value) }))}>
                {[1, 2, 3, 4].map((w) => (
                  <option key={w} value={w}>
                    {w}px
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
      )}
    </Modal>
  )
}

function toHex(color: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? color : '#2962ff'
}
