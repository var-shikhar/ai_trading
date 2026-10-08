import type { StudyDef, StudyParams } from '../api/client'

/** One indicator on the chart. The same study can be added several times. */
export interface StudyInstance {
  uid: string
  id: string
  params: StudyParams
  visible: boolean
  colors: Record<string, string> // output key -> color token (see resolveColor)
  lineWidth: number
}

// TradingView-like default colors per study output (palette slots or up/down).
const DEFAULT_COLORS: Record<string, Record<string, string>> = {
  rsi: { rsi: 'slot:6' },
  macd: { macd: 'slot:0', signal: 'slot:1', hist: 'signed' },
  bb: { basis: 'slot:1', upper: 'slot:0', lower: 'slot:0' },
  supertrend: { up: 'up', down: 'down' },
  stoch: { k: 'slot:0', d: 'slot:1' },
  stochrsi: { k: 'slot:0', d: 'slot:1' },
  adx: { adx: 'slot:6', plus: 'slot:0', minus: 'slot:1' },
  donchian: { upper: 'slot:0', basis: 'slot:1', lower: 'slot:0' },
  keltner: { upper: 'slot:0', basis: 'slot:1', lower: 'slot:0' },
}

let counter = 0
function newUid(): string {
  counter += 1
  return `${Date.now().toString(36)}${counter.toString(36)}`
}

export function defaultParams(def: StudyDef): StudyParams {
  return Object.fromEntries(def.inputs.map((i) => [i.key, i.default]))
}

/** Single-line studies (moving averages etc.) take the next palette slot not
 * already used by another single-line study, so several EMAs stay distinct. */
function nextFreeSlot(existing: StudyInstance[]): number {
  const used = new Set(
    existing.flatMap((s) => Object.values(s.colors)).filter((c) => c.startsWith('slot:')).map((c) => Number(c.slice(5))),
  )
  for (let i = 0; i < 8; i++) if (!used.has(i)) return i
  return existing.length % 8
}

export function newStudy(def: StudyDef, existing: StudyInstance[], params?: StudyParams): StudyInstance {
  const preset = DEFAULT_COLORS[def.id]
  const colors: Record<string, string> = {}
  if (preset) Object.assign(colors, preset)
  else {
    const slot = nextFreeSlot(existing)
    def.outputs.forEach((o, i) => (colors[o.key] = `slot:${(slot + i) % 8}`))
  }
  return {
    uid: newUid(),
    id: def.id,
    params: { ...defaultParams(def), ...params },
    visible: true,
    colors,
    lineWidth: def.overlay ? 2 : 1,
  }
}

export function defaultStudies(catalog: StudyDef[]): StudyInstance[] {
  const byId = Object.fromEntries(catalog.map((d) => [d.id, d]))
  const out: StudyInstance[] = []
  for (const [id, params] of [
    ['ema', { length: 20 }],
    ['ema', { length: 50 }],
    ['ema', { length: 200 }],
    ['rsi', { length: 14 }],
  ] as const) {
    if (byId[id]) out.push(newStudy(byId[id], out, params))
  }
  return out
}

/** Legend title like TradingView: "EMA 20 close", "BB 20 close 2". */
export function studyTitle(def: StudyDef, inst: StudyInstance): string {
  const args = def.inputs.map((i) => inst.params[i.key] ?? i.default)
  return [def.short, ...args].join(' ')
}
