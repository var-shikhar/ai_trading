import type { IChartApi, ISeriesApi, SeriesType } from 'lightweight-charts'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Candle } from '../api/client'
import type { ChartTheme } from '../chart/theme'
import type { DrawingsPrimitive } from './DrawingsPrimitive'
import { applyDrag, cursorFor, findHit } from './edit'
import { Mapper } from './mapper'
import { drawingId, type Drawing, type DrawingTool, type Handle, type Pt } from './types'

interface Live {
  chart: IChartApi
  main: ISeriesApi<SeriesType>
  primitive: DrawingsPrimitive
}

interface Options {
  container: HTMLDivElement | null
  live: Live | null
  candles: Candle[]
  theme: ChartTheme
  tool: DrawingTool
  onToolDone: () => void
  drawings: Drawing[]
  onChange: (drawings: Drawing[]) => void
}

const DEFAULT_COLOR = 'slot:0'
const DRAG_THRESHOLD = 4

/**
 * Mouse handling for drawing tools, TradingView-style:
 * - trend/rectangle: click + click, or press-drag-release
 * - horizontal/vertical line, long/short: single click
 * - cursor: click selects; drag body to move, handles to reshape
 * - Delete/Backspace removes the selection, Esc cancels / deselects
 * Pointer events over a drawing (or while a tool is active) are captured
 * before the chart sees them, so the chart doesn't pan at the same time.
 */
export function useDrawings(o: Options) {
  const [working, setWorking] = useState<Drawing[]>(o.drawings)
  const [draft, setDraft] = useState<Drawing | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const ref = useRef(o)
  const stateRef = useRef({ working, draft, selectedId })
  useEffect(() => {
    ref.current = o
    stateRef.current = { working, draft, selectedId }
  })

  // Parent data (load for a new symbol, or our own saved edits) wins. Taken
  // during render, so no frame draws the old symbol's drawings.
  const [source, setSource] = useState(o.drawings)
  if (source !== o.drawings) {
    setSource(o.drawings)
    setWorking(o.drawings)
    setDraft(null)
    setSelectedId((id) => (o.drawings.some((d) => d.id === id) ? id : null))
  }

  const mapperRef = useRef<Mapper | null>(null)
  useEffect(() => {
    mapperRef.current = o.live ? new Mapper(o.live.chart, o.live.main, o.candles) : null
  }, [o.live, o.candles])

  // Push state into the chart primitive.
  useEffect(() => {
    o.live?.primitive.setState({
      drawings: working,
      draft,
      selectedId,
      hoverId,
      mapper: mapperRef.current,
      theme: o.theme,
    })
  }, [o.live, o.candles, o.theme, working, draft, selectedId, hoverId])

  const commit = useCallback((next: Drawing[]) => {
    setWorking(next)
    ref.current.onChange(next)
  }, [])

  useEffect(() => {
    const container = o.container
    const live = o.live
    if (!container || !live) return

    // `result`: the list after the latest move (stateRef lags a render behind).
    let drag: { id: string; handle: Handle; x: number; y: number; orig: Drawing; moved: boolean; result?: Drawing[] } | null = null
    let placing: { downX: number; downY: number; awaitingSecondClick: boolean } | null = null

    const paneBox = () => live.chart.panes()[0]?.getHTMLElement()?.getBoundingClientRect() ?? null
    const local = (e: MouseEvent) => {
      const box = paneBox()
      const m = mapperRef.current
      if (!box || !m) return null
      const x = e.clientX - box.left
      const y = e.clientY - box.top
      const inside = x >= 0 && x <= m.width && y >= 0 && y <= box.height
      return { x, y, inside, m }
    }

    const finishPlacing = (d: Drawing) => {
      placing = null
      setDraft(null)
      commit([...stateRef.current.working, d])
      setSelectedId(d.id)
      ref.current.onToolDone()
    }

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      const p = local(e)
      if (!p || !p.inside) return
      const { x, y, m } = p
      const pt = m.point(x, y)
      if (!pt) return
      const tool = ref.current.tool
      const { working, draft, selectedId } = stateRef.current

      if (tool !== 'cursor') {
        e.preventDefault()
        e.stopPropagation()
        if (draft && placing?.awaitingSecondClick) {
          finishPlacing(withEnd(draft, pt))
          return
        }
        const id = drawingId()
        if (tool === 'trend' || tool === 'rect') {
          setDraft({ id, type: tool, color: DEFAULT_COLOR, a: pt, b: pt })
          placing = { downX: x, downY: y, awaitingSecondClick: false }
        } else if (tool === 'hline') {
          finishPlacing({ id, type: 'hline', color: DEFAULT_COLOR, price: pt.price })
        } else if (tool === 'vline') {
          finishPlacing({ id, type: 'vline', color: DEFAULT_COLOR, time: pt.time })
        } else {
          finishPlacing(newPosition(id, tool, pt, y, m, live))
        }
        return
      }

      const hit = findHit(working, selectedId, x, y, m)
      if (hit) {
        e.preventDefault()
        e.stopPropagation()
        setSelectedId(hit.id)
        const orig = working.find((d) => d.id === hit.id)!
        drag = { id: hit.id, handle: hit.handle, x, y, orig, moved: false }
      } else {
        setSelectedId(null)
      }
    }

    const onMove = (e: PointerEvent) => {
      const p = local(e)
      if (!p) return
      const { x, y, m } = p
      if (placing) {
        const pt = m.point(x, y)
        if (pt) setDraft((d) => (d ? withEnd(d, pt) : d))
        return
      }
      if (drag) {
        const pt = m.point(x, y)
        const start = live.main.coordinateToPrice(drag.y)
        const now = live.main.coordinateToPrice(y)
        if (!pt || start === null || now === null) return
        if (Math.hypot(x - drag.x, y - drag.y) > DRAG_THRESHOLD) drag.moved = true
        if (!drag.moved) return
        const next = applyDrag(drag.orig, drag.handle, pt, m.barsBetween(drag.x, x), now - start, m)
        const id = drag.id
        drag.result = stateRef.current.working.map((d) => (d.id === id ? next : d))
        setWorking(drag.result)
        return
      }
      // Hover feedback when idle.
      if (e.buttons) return
      const tool = ref.current.tool
      if (!p.inside) {
        container.style.cursor = ''
        setHoverId(null)
        return
      }
      if (tool !== 'cursor') {
        container.style.cursor = 'crosshair'
        return
      }
      const { working, selectedId } = stateRef.current
      const hit = findHit(working, selectedId, x, y, m)
      setHoverId(hit?.id ?? null)
      container.style.cursor = cursorFor(hit?.handle ?? null, working.find((d) => d.id === hit?.id))
    }

    const onUp = (e: PointerEvent) => {
      if (placing && !placing.awaitingSecondClick) {
        const p = local(e)
        const dragged = p && Math.hypot(p.x - placing.downX, p.y - placing.downY) > DRAG_THRESHOLD
        const { draft } = stateRef.current
        if (dragged && draft) finishPlacing(draft)
        else placing.awaitingSecondClick = true
        return
      }
      if (drag) {
        if (drag.moved && drag.result) ref.current.onChange(drag.result)
        drag = null
      }
    }

    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select, [role=dialog]')) return
      const { working, selectedId, draft } = stateRef.current
      if (e.key === 'Escape') {
        if (draft) {
          placing = null
          setDraft(null)
        }
        if (ref.current.tool !== 'cursor') ref.current.onToolDone()
        else setSelectedId(null)
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault()
        commit(working.filter((d) => d.id !== selectedId))
        setSelectedId(null)
      }
    }

    // Touch: pointer events come first; while a drawing is being placed or
    // dragged, keep the touch from also panning/zooming the chart.
    const busy = () => ref.current.tool !== 'cursor' || drag !== null || placing !== null
    const onTouch = (e: TouchEvent) => {
      if (!busy()) return
      e.stopPropagation()
      if (e.cancelable) e.preventDefault()
    }

    container.addEventListener('pointerdown', onDown, true)
    container.addEventListener('touchstart', onTouch, { capture: true, passive: false })
    container.addEventListener('touchmove', onTouch, { capture: true, passive: false })
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('keydown', onKey)
    return () => {
      container.removeEventListener('pointerdown', onDown, true)
      container.removeEventListener('touchstart', onTouch, true)
      container.removeEventListener('touchmove', onTouch, true)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('keydown', onKey)
      container.style.cursor = ''
    }
  }, [o.container, o.live, commit])

  const selected = working.find((d) => d.id === selectedId) ?? null
  return {
    selected,
    setColor: (color: string) =>
      selected && commit(working.map((d) => (d.id === selected.id ? { ...d, color } : d))),
    remove: () => {
      if (!selected) return
      commit(working.filter((d) => d.id !== selected.id))
      setSelectedId(null)
    },
  }
}

function withEnd(d: Drawing, pt: Pt): Drawing {
  return d.type === 'trend' || d.type === 'rect' ? { ...d, b: pt } : d
}

/** A long/short box sized to the current view: about 1/6 of the visible
 * bars wide, stop ~8% of the pane height away, target at 2R. */
function newPosition(id: string, type: 'long' | 'short', pt: Pt, y: number, m: Mapper, live: Live): Drawing {
  const range = live.chart.timeScale().getVisibleLogicalRange()
  const bars = range ? Math.max(8, Math.round((range.to - range.from) / 6)) : 20
  const height = live.chart.panes()[0]?.getHeight() ?? 400
  const offset = live.main.coordinateToPrice(y + height * 0.08)
  const risk = offset === null ? pt.price * 0.02 : Math.abs(pt.price - offset) || pt.price * 0.02
  const dir = type === 'long' ? 1 : -1
  return {
    id,
    type,
    color: type === 'long' ? 'up' : 'down',
    entry: pt,
    endTime: m.shift(pt.time, bars),
    stop: pt.price - dir * risk,
    target: pt.price + dir * risk * 2,
  }
}
