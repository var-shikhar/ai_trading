import { Checkbox, cx, Dropdown, MenuHeading } from '../ui/kit'

export interface LayoutDef {
  id: string
  name: string
  count: number
  /** CSS grid areas, one letter per chart (a = first). */
  areas: string
  columns: string
  rows: string
}

export const LAYOUTS: LayoutDef[] = [
  { id: '1', name: 'Single chart', count: 1, areas: '"a"', columns: '1fr', rows: '1fr' },
  { id: '2v', name: '2 charts, side by side', count: 2, areas: '"a b"', columns: '1fr 1fr', rows: '1fr' },
  { id: '2h', name: '2 charts, stacked', count: 2, areas: '"a" "b"', columns: '1fr', rows: '1fr 1fr' },
  { id: '3', name: '1 large + 2 small', count: 3, areas: '"a b" "a c"', columns: '3fr 2fr', rows: '1fr 1fr' },
  { id: '3v', name: '3 charts, side by side', count: 3, areas: '"a b c"', columns: '1fr 1fr 1fr', rows: '1fr' },
  { id: '4', name: '4 charts, grid', count: 4, areas: '"a b" "c d"', columns: '1fr 1fr', rows: '1fr 1fr' },
]

export const MAX_PANELS = 4

export interface SyncSettings {
  symbol: boolean
  interval: boolean
  crosshair: boolean
  time: boolean
}

const SYNC_LABELS: Record<keyof SyncSettings, string> = {
  symbol: 'Symbol',
  interval: 'Interval',
  crosshair: 'Crosshair',
  time: 'Date range',
}

export function LayoutMenu({
  layout,
  onLayout,
  sync,
  onSync,
}: {
  layout: LayoutDef
  onLayout: (id: string) => void
  sync: SyncSettings
  onSync: (s: SyncSettings) => void
}) {
  return (
    <Dropdown align="right" title="Layout" label={<LayoutIcon def={layout} />}>
      {() => (
        <div className="w-[224px]">
          <MenuHeading>Layout</MenuHeading>
          <div className="grid grid-cols-3 gap-1.5 px-2 pt-1 pb-2">
            {LAYOUTS.map((l) => {
              const on = l.id === layout.id
              return (
                <button
                  key={l.id}
                  className={cx(
                    'inline-flex h-10 cursor-pointer items-center justify-center rounded-lg border transition',
                    on ? 'border-accent bg-selected text-accent' : 'border-line text-muted hover:bg-hover hover:text-fg',
                  )}
                  title={l.name}
                  aria-label={l.name}
                  aria-pressed={on}
                  onClick={() => onLayout(l.id)}
                >
                  <LayoutIcon def={l} />
                </button>
              )
            })}
          </div>
          {layout.count > 1 && (
            <>
              <div className="mx-2 my-1 h-px bg-line" />
              <MenuHeading>Sync in layout</MenuHeading>
              <div className="flex flex-col px-1 pb-1">
                {(Object.keys(SYNC_LABELS) as (keyof SyncSettings)[]).map((k) => (
                  <div key={k} className="rounded-md px-1.5 py-1.5 hover:bg-hover">
                    <Checkbox checked={sync[k]} onChange={(v) => onSync({ ...sync, [k]: v })} label={SYNC_LABELS[k]} />
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </Dropdown>
  )
}

/** Small diagram of the layout: one rectangle per chart. */
function LayoutIcon({ def }: { def: LayoutDef }) {
  const rows = def.areas.split('" "').map((r) => r.replace(/"/g, '').split(' '))
  const nRows = rows.length
  const nCols = rows[0].length
  const cells = new Map<string, { r0: number; r1: number; c0: number; c1: number }>()
  rows.forEach((row, r) =>
    row.forEach((name, c) => {
      const cell = cells.get(name)
      if (!cell) cells.set(name, { r0: r, r1: r, c0: c, c1: c })
      else {
        cell.r1 = Math.max(cell.r1, r)
        cell.c1 = Math.max(cell.c1, c)
      }
    }),
  )
  const W = 20
  const H = 16
  const gap = 1.5
  return (
    <svg width="22" height="18" viewBox="-1 -1 22 18" aria-hidden>
      {[...cells.values()].map((c, i) => {
        const x = (c.c0 / nCols) * W
        const y = (c.r0 / nRows) * H
        const w = ((c.c1 - c.c0 + 1) / nCols) * W - gap
        const h = ((c.r1 - c.r0 + 1) / nRows) * H - gap
        return <rect key={i} x={x} y={y} width={w} height={h} rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
      })}
    </svg>
  )
}
