import {
  AreaSeries,
  BarSeries,
  CandlestickSeries,
  createChart,
  createSeriesMarkers,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  PriceScaleMode,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type Logical,
  type LogicalRange,
  type MouseEventParams,
  type SeriesMarker,
  type SeriesType,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Candle, LinePoint, StudyChartData, StudyDef } from '../api/client'
import { DrawingsPrimitive } from '../drawings/DrawingsPrimitive'
import type { Drawing, DrawingTool } from '../drawings/types'
import { Mapper } from '../drawings/mapper'
import { drawingId } from '../drawings/types'
import { sessionFor } from './candleClose'
import { CandleTimer } from './CandleTimer'
import { withLiveBar } from '../live/bars'
import { useDrawings } from '../drawings/useDrawings'
import type { ChartPatternResult } from '../patterns/chartPatterns'
import { PatternOverlayPrimitive } from '../patterns/PatternOverlayPrimitive'
import type { StudyInstance } from '../studies/model'
import { studyTitle } from '../studies/model'
import { usePref } from '../prefs'
import { MOBILE_QUERY, useMediaQuery } from '../pwa'
import { cx, IconButton, Spinner } from '../ui/kit'
import { formatCrosshairTime } from './format'
import { resolveColor, type ChartTheme } from './theme'

export type ChartType = 'candles' | 'hollow' | 'bars' | 'line' | 'area' | 'heikin'
export type ScaleMode = 'normal' | 'log' | 'percent'
export type StudyAction = 'toggle' | 'settings' | 'remove'

// Bars shown when a symbol/timeframe is first opened.
const INITIAL_VISIBLE_BARS = 150
const INITIAL_VISIBLE_BARS_PHONE = 70
// Ask for more history when the left edge is within this many bars.
const LOAD_MORE_THRESHOLD = 20
const STRETCH = { price: 6, volume: 1.4, study: 1.8 }

interface Props {
  data: StudyChartData
  /** Changes when symbol/timeframe change; the view resets on a new key. */
  datasetKey: string
  title: string
  intraday: boolean
  theme: ChartTheme
  chartType: ChartType
  scaleMode: ScaleMode
  showVolume: boolean
  studies: StudyInstance[]
  catalog: Record<string, StudyDef>
  markers: SeriesMarker<Time>[]
  /** Scrolls the chart to this bar; `seq` lets the same bar be focused twice. */
  focus: { time: number; seq: number } | null
  /** Shows this time range (e.g. from the bottom range bar). */
  range: { from: number; to: number; seq: number } | null
  onNeedMore: () => void
  onStudyAction: (uid: string, action: StudyAction) => void
  onHideVolume: () => void
  /** "Now" pressed: the parent may re-apply its own view (e.g. the bottom
   * bar's range ending at the latest bar). False = use the default zoom. */
  onRecenter?: () => boolean
  tool: DrawingTool
  onToolDone: () => void
  drawings: Drawing[]
  onDrawingsChange: (drawings: Drawing[]) => void
  /** Crosshair time from another chart in the layout (null = clear). */
  syncCrosshair?: number | null
  onCrosshairTime?: (time: number | null) => void
  /** Visible time range from another chart in the layout. */
  syncRange?: { from: number; to: number } | null
  onVisibleTimeRange?: (range: { from: number; to: number }) => void
  chartPatterns?: ChartPatternResult | null
  showZones?: boolean
  highlightPattern?: string | null
  /** Bar being formed from live ticks (replaces/extends the last bar). */
  liveBar?: Candle | null
  isLive?: boolean
  /** Chart interval and symbol: the candle countdown needs them. */
  tf?: string
  symbol?: string
  /** "Alert on this line" from the selected drawing's toolbar. */
  onDrawingAlert?: (d: Drawing) => void
  /** Right-click / long-press menu: "Alert when price crosses ₹X". */
  onPriceAlert?: (price: number) => void
  /** Active price alerts on this symbol, drawn as dashed lines. */
  alertLevels?: number[]
  /** Phone-sized: smaller axis text and fewer decimals (set internally). */
  compact?: boolean
  /** Newer data is loading (a small spinner in the legend). */
  refreshing?: boolean
}

interface StudySeries {
  pane: number
  outputs: Record<string, ISeriesApi<SeriesType>>
}

interface Built {
  chart: IChartApi
  main: ISeriesApi<SeriesType>
  volume: ISeriesApi<'Histogram'> | null
  volumePane: number | null
  studies: Record<string, StudySeries>
  markers: ISeriesMarkersPluginApi<Time>
  drawings: DrawingsPrimitive
  overlay: PatternOverlayPrimitive
}

const t = (time: number) => time as UTCTimestamp

export function PriceChart(outer: Props) {
  const compact = useMediaQuery(MOBILE_QUERY)
  const props = { ...outer, compact }
  // The legend (OHLC and indicator values) can be folded away; on a phone it
  // starts folded so it doesn't cover the candles.
  const [legendDesktop, setLegendDesktop] = usePref<boolean>('legendOpen', true)
  const [legendMobile, setLegendMobile] = usePref<boolean>('legendOpenMobile', false)
  const legendOpen = compact ? legendMobile : legendDesktop
  const toggleLegend = () => (compact ? setLegendMobile : setLegendDesktop)(!legendOpen)
  // Indicator rows collapse on their own (as in TradingView), keeping OHLC.
  const [studiesDesktop, setStudiesDesktop] = usePref<boolean>('legendStudiesOpen', true)
  const [studiesMobile, setStudiesMobile] = usePref<boolean>('legendStudiesOpenMobile', false)
  const studiesOpen = compact ? studiesMobile : studiesDesktop
  const toggleStudies = () => (compact ? setStudiesMobile : setStudiesDesktop)(!studiesOpen)
  const { data, datasetKey, title, intraday, theme, chartType, scaleMode, showVolume, studies, catalog } = props
  const { markers, focus, range, onStudyAction, onHideVolume } = props
  const containerRef = useRef<HTMLDivElement>(null)
  const builtRef = useRef<Built | null>(null)
  const loadedKeyRef = useRef<string | null>(null)
  const savedRangeRef = useRef<LogicalRange | null>(null)
  const propsRef = useRef(props)
  const [hover, setHover] = useState<number | null>(null)
  const [paneTops, setPaneTops] = useState<number[]>([])
  const [built, setBuilt] = useState<Built | null>(null)
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  // Shows the "back to now" button, like re-center in a maps app.
  const [away, setAway] = useState(false)
  // Right-click / long-press menu at a price.
  const [menu, setMenu] = useState<{ x: number; y: number; price: number } | null>(null)

  useLayoutEffect(() => {
    propsRef.current = props
  })

  const candles = useMemo(
    () => (chartType === 'heikin' ? heikinAshi(data.candles) : data.candles),
    [data.candles, chartType],
  )
  const candlesRef = useRef(candles)
  useLayoutEffect(() => {
    candlesRef.current = candles
  })

  // Rebuild the chart when its series/pane layout changes. Visibility, colors
  // and data are applied separately without a rebuild.
  const structureKey = `${chartType}|${showVolume}|${studies.map((s) => `${s.uid}:${s.id}`).join(',')}`

  useLayoutEffect(() => {
    const p = propsRef.current
    const chart = createChart(containerRef.current!, { autoSize: true, ...chartOptions(p.theme, p.intraday, p.compact) })
    const b = buildSeries(chart, p)
    builtRef.current = b
    applyData(b, p, candlesRef.current)
    applyStyles(b, p)

    if (savedRangeRef.current && loadedKeyRef.current === p.datasetKey) {
      chart.timeScale().setVisibleLogicalRange(savedRangeRef.current)
    } else {
      showLatest(chart, candlesRef.current.length, p.compact)
    }
    loadedKeyRef.current = p.datasetKey

    chart.timeScale().subscribeVisibleLogicalRangeChange((r) => {
      if (r && r.from < LOAD_MORE_THRESHOLD && propsRef.current.data.has_more) propsRef.current.onNeedMore()
      setAway(isAway(chart, b.main))
    })
    // Dragging/scaling the price axis turns its auto-scale off: check after gestures.
    const el = containerRef.current!
    const recheck = () => requestAnimationFrame(() => builtRef.current === b && setAway(isAway(chart, b.main)))
    el.addEventListener('pointerup', recheck)
    el.addEventListener('wheel', recheck, { passive: true })
    el.addEventListener('dblclick', recheck)
    chart.subscribeCrosshairMove((e: MouseEventParams<Time>) => {
      const time = e.time === undefined ? null : (e.time as number)
      setHover(time)
      // Only user moves are shared, not crosshairs set from another chart.
      if (e.sourceEvent) propsRef.current.onCrosshairTime?.(time)
    })
    chart.timeScale().subscribeVisibleTimeRangeChange((r) => {
      if (r) propsRef.current.onVisibleTimeRange?.({ from: r.from as number, to: r.to as number })
    })

    setBuilt(b)
    setContainer(containerRef.current)

    return () => {
      el.removeEventListener('pointerup', recheck)
      el.removeEventListener('wheel', recheck)
      el.removeEventListener('dblclick', recheck)
      savedRangeRef.current = chart.timeScale().getVisibleLogicalRange()
      builtRef.current = null
      chart.remove()
    }
  }, [structureKey])

  // New data (load more / refresh / theme-dependent bar colors). Keep the
  // visible window when older history is prepended to the same dataset.
  useEffect(() => {
    const b = builtRef.current
    if (!b) return
    const same = loadedKeyRef.current === datasetKey
    const previous = same ? b.chart.timeScale().getVisibleRange() : null
    applyData(b, propsRef.current, candles)
    if (previous) b.chart.timeScale().setVisibleRange(previous)
    else showLatest(b.chart, candles.length, compact)
    loadedKeyRef.current = datasetKey
  }, [candles, data.studies, datasetKey, theme, compact])

  // Colors, visibility, scale mode, time-axis format. Effects read the live
  // chart from builtRef: in a render where the layout changed, `built` state
  // still points at the chart that was just destroyed.
  useEffect(() => {
    const b = builtRef.current
    if (b) applyStyles(b, propsRef.current)
  }, [built, theme, studies, scaleMode, intraday, chartType, compact])

  useEffect(() => {
    builtRef.current?.markers.setMarkers(markers)
  }, [built, markers, candles])

  // Jump to a bar, e.g. a pattern hit picked from the list.
  useEffect(() => {
    const b = builtRef.current
    if (!b || !focus) return
    const index = propsRef.current.data.candles.findIndex((c) => c.time === focus.time)
    if (index >= 0) b.chart.timeScale().setVisibleLogicalRange({ from: index - 60, to: index + 30 })
  }, [focus])

  useEffect(() => {
    const b = builtRef.current
    if (!b || !range) return
    b.chart.timeScale().setVisibleRange({ from: t(range.from), to: t(range.to) })
  }, [range])

  // Clear the shared crosshair when the pointer leaves this chart.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onLeave = () => propsRef.current.onCrosshairTime?.(null)
    el.addEventListener('mouseleave', onLeave)
    return () => el.removeEventListener('mouseleave', onLeave)
  }, [])

  // Crosshair from another chart: show it on the bar containing that time.
  useEffect(() => {
    const b = builtRef.current
    if (!b || props.syncCrosshair === undefined) return
    const t0 = props.syncCrosshair
    const list = propsRef.current.data.candles
    if (t0 === null || !list.length) {
      b.chart.clearCrosshairPosition()
      return
    }
    let lo = 0
    let hi = list.length - 1
    if (t0 < list[0].time) return b.chart.clearCrosshairPosition()
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (list[mid].time <= t0) lo = mid
      else hi = mid - 1
    }
    b.chart.setCrosshairPosition(list[lo].close, t(list[lo].time), b.main)
  }, [props.syncCrosshair])

  useEffect(() => {
    const b = builtRef.current
    const r = props.syncRange
    if (!b || !r) return
    try {
      b.chart.timeScale().setVisibleRange({ from: t(r.from), to: t(r.to) })
    } catch {
      // range outside the loaded data
    }
  }, [props.syncRange])

  // Where each pane starts, so legends sit at the top-left of their pane.
  useEffect(() => {
    const container = containerRef.current
    const b = builtRef.current
    if (!b || !container) return
    const measure = () => {
      if (builtRef.current !== b) return
      const top = container.getBoundingClientRect().top
      setPaneTops(b.chart.panes().map((pane) => (pane.getHTMLElement()?.getBoundingClientRect().top ?? top) - top))
    }
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    for (const pane of b.chart.panes()) {
      const el = pane.getHTMLElement()
      if (el) observer.observe(el)
    }
    const frame = requestAnimationFrame(measure)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [built])

  const live = useMemo(
    () => (built ? { chart: built.chart, main: built.main, primitive: built.drawings } : null),
    [built],
  )
  // Live bar: update just the last bar instead of resetting all data.
  const merged = useMemo(() => withLiveBar(data.candles, props.liveBar ?? null), [data.candles, props.liveBar])
  const display = useMemo(() => (chartType === 'heikin' ? heikinAshi(merged) : merged), [merged, chartType])
  useEffect(() => {
    const b = builtRef.current
    const bar = props.liveBar
    if (!b || !bar || !data.candles.length || bar.time < data.candles[data.candles.length - 1].time) return
    const shown = display[display.length - 1]
    if (chartType === 'line' || chartType === 'area') b.main.update({ time: t(shown.time), value: shown.close })
    else b.main.update({ time: t(shown.time), open: shown.open, high: shown.high, low: shown.low, close: shown.close })
    b.volume?.update({
      time: t(bar.time),
      value: bar.volume,
      color: bar.close >= bar.open ? theme.upVolume : theme.downVolume,
    })
  }, [props.liveBar, display, built, data.candles, chartType, theme])

  // Detected chart patterns + zones.
  useEffect(() => {
    if (!built) return
    built.overlay.setState({
      result: props.chartPatterns ?? null,
      mapper: new Mapper(built.chart, built.main, data.candles),
      theme,
      showZones: props.showZones ?? false,
      highlight: props.highlightPattern ?? null,
    })
  }, [built, data.candles, theme, props.chartPatterns, props.showZones, props.highlightPattern])

  const drawing = useDrawings({
    container,
    live,
    candles: data.candles,
    theme,
    tool: props.tool,
    onToolDone: props.onToolDone,
    drawings: props.drawings,
    onChange: props.onDrawingsChange,
  })

  // Right-click (mouse) or long-press (touch) on the price pane: a small menu
  // to set an alert or draw a line at that price, as in TradingView.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const open = (clientX: number, clientY: number) => {
      const b = builtRef.current
      if (!b || propsRef.current.tool !== 'cursor') return false
      const box = el.getBoundingClientRect()
      const x = clientX - box.left
      const y = clientY - box.top
      const paneBottom = b.chart.panes()[0]?.getHeight() ?? box.height
      const price = y <= paneBottom ? b.main.coordinateToPrice(y) : null
      if (price === null || !(price > 0)) return false
      setMenu(menuAt(el, x, y, price))
      return true
    }
    const onContext = (e: MouseEvent) => {
      if (open(e.clientX, e.clientY)) e.preventDefault()
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    let start: { x: number; y: number } | null = null
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return
      // A second finger (pinch) is no long-press.
      if (start) return cancel()
      start = { x: e.clientX, y: e.clientY }
      timer = setTimeout(() => start && open(start.x, start.y), 550)
    }
    const cancel = () => {
      clearTimeout(timer)
      start = null
    }
    const onMove = (e: PointerEvent) => {
      if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) cancel()
    }
    el.addEventListener('contextmenu', onContext)
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', cancel)
    el.addEventListener('pointercancel', cancel)
    return () => {
      cancel()
      el.removeEventListener('contextmenu', onContext)
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', cancel)
      el.removeEventListener('pointercancel', cancel)
    }
  }, [])
  const menuRef = useRef<HTMLDivElement>(null)
  const menuOpenRef = useRef(false)
  useEffect(() => {
    menuOpenRef.current = !!menu
    if (!menu) return
    const close = (e: Event) => !menuRef.current?.contains(e.target as Node) && setMenu(null)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(null)
    // Next tick, so the long-press that opened it doesn't close it.
    const id = setTimeout(() => document.addEventListener('pointerdown', close, true))
    window.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(id)
      document.removeEventListener('pointerdown', close, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  // A "+" where the crosshair lines cross: click it for the same menu (alert
  // or line at that price). With a mouse it follows the crosshair, a little
  // up-right so it never sits under the pointer; on touch it shows after a tap
  // (or a crosshair drag) ends. Moved by hand (DOM, not state) as it follows
  // every mouse move.
  const plusRef = useRef<HTMLButtonElement>(null)
  const plusAt = useRef<{ x: number; y: number; price: number; touch: boolean; time?: Time } | null>(null)
  const plusHover = useRef(false)
  const hidePlus = useRef(() => {})
  useEffect(() => {
    const b = builtRef.current
    const el = containerRef.current
    if (!b || !el) return
    const { chart, main } = b
    const ts = chart.timeScale()
    let hideTimer: ReturnType<typeof setTimeout> | undefined
    let mouseDown = false
    const pointers = new Set<number>()
    let gesture: { x: number; y: number; moved: boolean; multi: boolean; range: string; cross: { x: number; y: number } | null } | null =
      null

    const hide = () => {
      clearTimeout(hideTimer)
      plusAt.current = null
      plusHover.current = false
      plusRef.current?.removeAttribute('data-show')
    }
    hidePlus.current = hide
    const hideSoon = () => {
      // Moving onto the + leaves the chart first: wait to see if it's hovered.
      clearTimeout(hideTimer)
      hideTimer = setTimeout(() => !plusHover.current && hide(), 80)
    }
    const usable = () => propsRef.current.tool === 'cursor' && !!propsRef.current.onPriceAlert && !menuOpenRef.current
    const rangeKey = () => JSON.stringify(ts.getVisibleLogicalRange())
    /** The + centre for a crosshair at (x, y), flipped inside near the pane's edges. */
    const target = (x: number, y: number, touch: boolean) => {
      const paneH = chart.panes()[0]?.getHeight() ?? 0
      const paneW = ts.width()
      const price = main.coordinateToPrice(y)
      if (price === null || !(price > 0) || x < 0 || x > paneW || y < 0 || y > paneH) return null
      const off = touch ? 26 : 14
      const r = touch ? 16 : 12
      return {
        x: x + off + r > paneW ? x - off : x + off,
        y: y - off - r < 0 ? y + off : y - off,
        price,
        touch,
      }
    }
    const show = (t: NonNullable<typeof plusAt.current>) => {
      const btn = plusRef.current
      if (!btn) return
      clearTimeout(hideTimer)
      plusAt.current = t
      const r = t.touch ? 16 : 12
      btn.style.transform = `translate(${t.x - r}px, ${t.y - r}px)`
      btn.toggleAttribute('data-touch', t.touch)
      btn.setAttribute('data-show', '')
    }
    // The bar's x (the vertical crosshair line snaps to bars).
    const snapX = (x: number) => {
      const l = ts.coordinateToLogical(x)
      return l === null ? x : (ts.logicalToCoordinate(Math.round(l) as Logical) ?? x)
    }

    const onCrosshair = (e: MouseEventParams<Time>) => {
      // A + placed by touch stays until the next touch (crosshair events don't move it).
      if (plusHover.current || plusAt.current?.touch) return
      if (gesture) {
        // Touch: remember where a crosshair drag is; the + shows when it ends.
        if (e.point && e.paneIndex === 0 && e.logical !== undefined) gesture.cross = { x: snapX(e.point.x), y: e.point.y }
        return
      }
      if (!e.point || !e.sourceEvent) return hideSoon()
      if (e.paneIndex !== 0 || e.logical === undefined || mouseDown || !usable() || pointers.size) return hide()
      const x = ts.logicalToCoordinate(e.logical)
      const next = x === null ? null : target(x, e.point.y, false)
      if (!next) return hide()
      // Heading for the + (closer to it than to where it would move): keep it still.
      const cur = plusAt.current
      const m = e.point
      if (cur && Math.hypot(m.x - cur.x, m.y - cur.y) < Math.hypot(m.x - next.x, m.y - next.y) - 3) return
      show({ ...next, time: e.time })
    }

    const onDown = (e: PointerEvent) => {
      hide()
      if (e.pointerType === 'mouse') {
        mouseDown = true
        return
      }
      pointers.add(e.pointerId)
      if (pointers.size > 1) {
        if (gesture) gesture.multi = true
        return
      }
      gesture = { x: e.clientX, y: e.clientY, moved: false, multi: false, range: rangeKey(), cross: null }
    }
    const onMove = (e: PointerEvent) => {
      // A mouse after touch (hybrid devices): back to following the mouse.
      if (e.pointerType === 'mouse' && plusAt.current?.touch && !plusHover.current) hide()
      if (gesture && e.pointerType !== 'mouse' && Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y) > 8) gesture.moved = true
    }
    const onUp = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') {
        mouseDown = false
        return
      }
      if (!pointers.delete(e.pointerId) || pointers.size) return
      const g = gesture
      gesture = null
      if (!g || g.multi || e.type === 'pointercancel' || !usable()) return
      if (!g.moved) {
        // A tap: + (and the crosshair) at the tapped bar and price.
        const box = el.getBoundingClientRect()
        const x = snapX(g.x - box.left)
        const y = g.y - box.top
        const t = target(x, y, true)
        if (!t) return
        show(t)
        const l = ts.coordinateToLogical(x)
        const bar = l === null ? undefined : main.data()[Math.round(l)]
        if (bar) chart.setCrosshairPosition(t.price, bar.time, main)
      } else if (g.cross && rangeKey() === g.range) {
        // A long-press crosshair drag (the chart didn't pan): where it ended.
        const t = target(g.cross.x, g.cross.y, true)
        if (t) show(t)
      }
    }
    // The view moved (zoom, scroll, new bar): the + would point at another price.
    const onRange = () => !gesture && !plusHover.current && hide()

    chart.subscribeCrosshairMove(onCrosshair)
    ts.subscribeVisibleLogicalRangeChange(onRange)
    // Capture: drawing edits stop pointerdown from reaching the chart.
    el.addEventListener('pointerdown', onDown, true)
    el.addEventListener('mouseleave', hideSoon)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      hide()
      hidePlus.current = () => {}
      el.removeEventListener('pointerdown', onDown, true)
      el.removeEventListener('mouseleave', hideSoon)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      if (builtRef.current === b) {
        chart.unsubscribeCrosshairMove(onCrosshair)
        ts.unsubscribeVisibleLogicalRangeChange(onRange)
      }
    }
  }, [built])
  // Not usable now (drawing, menu open, another symbol): hide it.
  const canAlert = !!props.onPriceAlert
  useEffect(() => hidePlus.current(), [props.tool, menu, datasetKey, canAlert])

  // Hovering the + holds it (and the crosshair) still so it can be clicked.
  const onPlusEnter = () => {
    const b = builtRef.current
    const at = plusAt.current
    plusHover.current = true
    if (b && at?.time !== undefined) b.chart.setCrosshairPosition(at.price, at.time, b.main)
  }
  const onPlusLeave = () => {
    if (!plusHover.current) return
    plusHover.current = false
    builtRef.current?.chart.clearCrosshairPosition()
    hidePlus.current()
  }
  const openPlusMenu = () => {
    const at = plusAt.current
    const el = containerRef.current
    if (!at || !el) return
    hidePlus.current()
    setMenu(menuAt(el, at.x + 16, at.y - 8, at.price))
  }

  // Price alerts on this symbol as dashed lines with a bell.
  const alertKey = (props.alertLevels ?? []).join(',')
  useEffect(() => {
    const b = builtRef.current
    if (!b || !alertKey) return
    const lines: IPriceLine[] = alertKey.split(',').map((v) =>
      b.main.createPriceLine({
        price: Number(v),
        color: theme.series[3], // amber, like an alert
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: '🔔',
      }),
    )
    return () => {
      if (builtRef.current === b) lines.forEach((l) => b.main.removePriceLine(l))
    }
  }, [built, alertKey, theme])

  // Back to the latest bar at the normal zoom, every price axis auto-fitted.
  const recenter = () => {
    const b = builtRef.current
    if (!b) return
    b.chart.panes().forEach((_, i) => b.chart.priceScale('right', i).applyOptions({ autoScale: true }))
    if (!props.onRecenter?.()) showLatest(b.chart, b.main.data().length, compact)
    setAway(false)
  }

  const index = hoverIndex(merged, hover)
  const barTime = merged[index]?.time
  const legendProps = { result: data.studies, time: barTime, theme, onAction: onStudyAction }

  return (
    // isolate: its layers (legend, menus, +) stay under the panel's loading/error covers.
    <div className="absolute inset-0 isolate">
      {/* The chart handles its own drag and pinch: no page scroll/zoom on it. */}
      <div ref={containerRef} className="absolute inset-0 touch-none" />
      {built && paneTops.length > 0 && (
        <>
          <div className={legendBox} style={{ top: paneTops[0] + 6 }}>
            <MainLegend
              title={title}
              candles={display}
              index={index}
              live={props.isLive ?? false}
              refreshing={props.refreshing ?? false}
              open={legendOpen}
              onToggle={toggleLegend}
            />
            {legendOpen && (
              <OverlayLegends
                studies={studies.filter((s) => catalog[s.id]?.overlay)}
                open={studiesOpen}
                onToggle={toggleStudies}
                render={(s) => <StudyLegend key={s.uid} inst={s} def={catalog[s.id]} {...legendProps} />}
              />
            )}
          </div>
          {built.volumePane !== null && paneTops[built.volumePane] !== undefined && (
            <div className={legendBox} style={{ top: paneTops[built.volumePane] + 4 }}>
              <div className={cx(legendRow, studyRow)} tabIndex={-1}>
                <span className="text-fg">Vol</span>
                <b className="font-normal">{merged[index] ? fmtVolume(merged[index].volume) : '–'}</b>
                <span className={legendActions}>
                  <LegendButton title="Remove" onClick={onHideVolume}>
                    <CloseIcon />
                  </LegendButton>
                </span>
              </div>
            </div>
          )}
          {studies
            .filter((s) => catalog[s.id] && !catalog[s.id].overlay)
            .map((s) => {
              const pane = built.studies[s.uid]?.pane
              if (pane === undefined || paneTops[pane] === undefined) return null
              return (
                <div key={s.uid} className={legendBox} style={{ top: paneTops[pane] + 4 }}>
                  <StudyLegend inst={s} def={catalog[s.id]} {...legendProps} />
                </div>
              )
            })}
        </>
      )}
      {away && (
        <button
          className="absolute right-[76px] bottom-10 z-[15] inline-flex h-8 animate-pop cursor-pointer items-center gap-1.5 rounded-full border border-line bg-raised pr-3 pl-2.5 text-[12px] font-semibold text-accent shadow-[var(--shadow)] transition hover:bg-hover max-md:right-[62px] max-md:bottom-[34px]"
          onClick={recenter}
          title="Back to the latest bar (reset zoom and price scale)"
        >
          <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
            <circle cx="9" cy="9" r="3" />
            <path d="M9 1.5v3M9 13.5v3M1.5 9h3M13.5 9h3" />
          </svg>
          <span>Now</span>
        </button>
      )}
      {built && props.isLive && props.tf && props.symbol && display.length > 0 && (
        <CandleTimer
          chart={built.chart}
          series={built.main}
          price={display[display.length - 1].close}
          tf={props.tf}
          session={sessionFor(props.symbol)}
          color={display[display.length - 1].close >= display[display.length - 1].open ? theme.up : theme.down}
        />
      )}
      {built && props.onPriceAlert && (
        <button
          ref={plusRef}
          // Shown and moved from the crosshair handler (data-show, transform).
          className="absolute top-0 left-0 z-[16] hidden size-6 cursor-pointer items-center justify-center rounded-full border border-accent bg-surface text-accent shadow-[var(--shadow)] transition-colors hover:bg-accent hover:text-accent-fg data-[show]:flex data-[touch]:size-8"
          aria-label="Alert or line at this price"
          title="Alert or line at this price"
          onMouseEnter={onPlusEnter}
          onMouseLeave={onPlusLeave}
          onClick={openPlusMenu}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
            <path d="M6 1.5v9M1.5 6h9" />
          </svg>
        </button>
      )}
      {menu && (
        <div
          ref={menuRef}
          className="absolute z-[45] flex min-w-[220px] animate-pop flex-col rounded-xl border border-line bg-raised p-1 text-fg shadow-[var(--shadow)]"
          role="menu"
          style={{ left: menu.x, top: menu.y }}
        >
          {props.onPriceAlert && (
            <button
              role="menuitem"
              className={menuItem}
              onClick={() => {
                props.onPriceAlert!(roundPrice(menu.price))
                setMenu(null)
              }}
            >
              <span aria-hidden>🔔</span> Alert when price crosses <b className="font-semibold">{fmt(roundPrice(menu.price))}</b>
            </button>
          )}
          <button
            role="menuitem"
            className={menuItem}
            onClick={() => {
              props.onDrawingsChange([
                ...props.drawings,
                { id: drawingId(), type: 'hline', color: 'slot:0', price: roundPrice(menu.price) },
              ])
              setMenu(null)
            }}
          >
            <span aria-hidden className="text-muted">
              ―
            </span>{' '}
            Horizontal line at <b className="font-semibold">{fmt(roundPrice(menu.price))}</b>
          </button>
        </div>
      )}
      {drawing.selected && (
        <div
          className="absolute top-2 left-1/2 z-20 flex -translate-x-1/2 animate-pop items-center gap-1 rounded-xl border border-line bg-raised px-1.5 py-1 shadow-[var(--shadow)]"
          role="toolbar"
          aria-label="Selected drawing"
        >
          {drawing.selected.type !== 'long' &&
            drawing.selected.type !== 'short' &&
            theme.series.map((c, n) => (
              <button
                key={c}
                className={cx(
                  'mx-0.5 size-5 cursor-pointer rounded-full border-2 transition hover:scale-110',
                  drawing.selected?.color === `slot:${n}` ? 'border-fg' : 'border-transparent',
                )}
                style={{ background: c }}
                aria-label={`Color ${n + 1}`}
                aria-pressed={drawing.selected?.color === `slot:${n}`}
                onClick={() => drawing.setColor(`slot:${n}`)}
              />
            ))}
          {(drawing.selected.type === 'hline' || drawing.selected.type === 'trend') && props.onDrawingAlert && (
            <IconButton label="Alert when price crosses this line" onClick={() => props.onDrawingAlert?.(drawing.selected!)}>
              <span aria-hidden>🔔</span>
            </IconButton>
          )}
          <IconButton label="Remove (Delete)" onClick={drawing.remove}>
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
              <path d="M4 6h12M8 6V4h4v2M6 6l1 11h6l1-11" />
            </svg>
          </IconButton>
        </div>
      )}
    </div>
  )
}

// Where the chart's menu opens: at (x, y), kept inside the chart.
function menuAt(el: HTMLElement, x: number, y: number, price: number) {
  const { width, height } = el.getBoundingClientRect()
  return { x: Math.max(4, Math.min(x, width - 234)), y: Math.max(4, Math.min(y, height - 96)), price }
}

const menuItem = 'flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-2 text-left text-[13px] whitespace-nowrap transition hover:bg-hover'

// --- chart construction -----------------------------------------------------------

function chartOptions(theme: ChartTheme, intraday: boolean, compact = false) {
  const label = theme.dark ? '#363a45' : '#131722'
  return {
    layout: {
      background: { color: theme.surface },
      textColor: theme.muted,
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif",
      fontSize: compact ? 10 : 12,
      panes: { separatorColor: theme.border, separatorHoverColor: theme.grid, enableResize: true },
    },
    grid: { vertLines: { color: theme.grid }, horzLines: { color: theme.grid } },
    rightPriceScale: { borderColor: theme.border },
    timeScale: { borderColor: theme.border, timeVisible: intraday, secondsVisible: false, rightOffset: compact ? 3 : 8 },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: theme.crosshair, labelBackgroundColor: label },
      horzLine: { color: theme.crosshair, labelBackgroundColor: label },
    },
    localization: {
      timeFormatter: (time: Time) => formatCrosshairTime(time as number, intraday),
    },
  }
}

function buildSeries(chart: IChartApi, p: Props): Built {
  const main = addMainSeries(chart, p.chartType)
  let pane = 1
  let volume: ISeriesApi<'Histogram'> | null = null
  let volumePane: number | null = null
  if (p.showVolume) {
    volume = chart.addSeries(
      HistogramSeries,
      { priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false },
      pane,
    )
    volumePane = pane++
  }

  const studies: Record<string, StudySeries> = {}
  for (const inst of p.studies) {
    const def = p.catalog[inst.id]
    if (!def) continue
    const target = def.overlay ? 0 : pane++
    const outputs: Record<string, ISeriesApi<SeriesType>> = {}
    for (const out of def.outputs) {
      const common = { priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false }
      if (out.style === 'histogram') {
        outputs[out.key] = chart.addSeries(HistogramSeries, { ...common, lastValueVisible: false }, target)
      } else if (out.style === 'dots') {
        outputs[out.key] = chart.addSeries(
          LineSeries,
          { ...common, lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: 1.5 },
          target,
        )
      } else {
        outputs[out.key] = chart.addSeries(LineSeries, common, target)
      }
    }
    const first = outputs[def.outputs[0]?.key]
    for (const level of def.levels) {
      first?.createPriceLine({
        price: level,
        color: '#9598a1',
        lineStyle: LineStyle.Dashed,
        lineWidth: 1,
        axisLabelVisible: false,
      })
    }
    studies[inst.uid] = { pane: target, outputs }
  }

  const panes = chart.panes()
  panes[0]?.setStretchFactor(STRETCH.price)
  if (volumePane !== null) panes[volumePane]?.setStretchFactor(STRETCH.volume)
  for (const s of Object.values(studies)) if (s.pane > 0) panes[s.pane]?.setStretchFactor(STRETCH.study)

  const drawings = new DrawingsPrimitive({
    drawings: [],
    draft: null,
    selectedId: null,
    hoverId: null,
    mapper: null,
    theme: p.theme,
  })
  const overlay = new PatternOverlayPrimitive({
    result: null,
    mapper: null,
    theme: p.theme,
    showZones: false,
    highlight: null,
  })
  main.attachPrimitive(overlay)
  main.attachPrimitive(drawings)
  return { chart, main, volume, volumePane, studies, markers: createSeriesMarkers(main, []), drawings, overlay }
}

function addMainSeries(chart: IChartApi, type: ChartType): ISeriesApi<SeriesType> {
  switch (type) {
    case 'bars':
      return chart.addSeries(BarSeries, { thinBars: false })
    case 'line':
      return chart.addSeries(LineSeries, { lineWidth: 2 })
    case 'area':
      return chart.addSeries(AreaSeries, { lineWidth: 2 })
    default:
      return chart.addSeries(CandlestickSeries, {})
  }
}

/** Decimals on the price axis: 2 normally; on a phone fewer for big prices
 * (147417 instead of 147417.00) so the axis takes less of the screen. */
function pricePrecision(candles: Candle[], compact: boolean): number {
  if (!compact) return 2
  const last = Math.abs(candles[candles.length - 1]?.close ?? 0)
  return last >= 10000 ? 0 : last >= 1000 ? 1 : 2
}

function applyData(b: Built, p: Props, candles: Candle[]) {
  const { theme } = p
  const precision = pricePrecision(candles, p.compact ?? false)
  const priceFormat = { type: 'price' as const, precision, minMove: 1 / 10 ** precision }
  b.main.applyOptions({ priceFormat })
  for (const st of Object.values(b.studies)) {
    if (st.pane === 0) for (const series of Object.values(st.outputs)) series.applyOptions({ priceFormat })
  }
  if (p.chartType === 'line' || p.chartType === 'area') {
    b.main.setData(candles.map((c) => ({ time: t(c.time), value: c.close })))
  } else {
    b.main.setData(candles.map((c) => ({ time: t(c.time), open: c.open, high: c.high, low: c.low, close: c.close })))
  }
  b.volume?.setData(
    p.data.candles.map((c) => ({
      time: t(c.time),
      value: c.volume,
      color: c.close >= c.open ? theme.upVolume : theme.downVolume,
    })),
  )
  for (const inst of p.studies) {
    const series = b.studies[inst.uid]
    const def = p.catalog[inst.id]
    if (!series || !def) continue
    const outputs = p.data.studies[inst.uid]?.outputs
    for (const out of def.outputs) {
      const points = outputs?.[out.key] ?? []
      series.outputs[out.key]?.setData(
        out.signed
          ? points.map((pt) => ({
              time: t(pt.time),
              value: pt.value,
              color: pt.value >= 0 ? theme.upHist : theme.downHist,
            }))
          : points.map((pt) => ({ time: t(pt.time), value: pt.value })),
      )
    }
  }
}

function applyStyles(b: Built, p: Props) {
  const { theme } = p
  const { up, down } = theme
  b.chart.applyOptions(chartOptions(theme, p.intraday, p.compact))
  switch (p.chartType) {
    case 'hollow':
      b.main.applyOptions({
        upColor: 'rgba(0, 0, 0, 0)',
        downColor: down,
        borderVisible: true,
        borderUpColor: up,
        borderDownColor: down,
        wickUpColor: up,
        wickDownColor: down,
      })
      break
    case 'candles':
    case 'heikin':
      b.main.applyOptions({ upColor: up, downColor: down, borderVisible: false, wickUpColor: up, wickDownColor: down })
      break
    case 'bars':
      b.main.applyOptions({ upColor: up, downColor: down })
      break
    case 'line':
      b.main.applyOptions({ color: theme.series[0] })
      break
    case 'area':
      b.main.applyOptions({
        lineColor: theme.series[0],
        topColor: theme.dark ? 'rgba(57, 135, 229, 0.35)' : 'rgba(42, 120, 214, 0.28)',
        bottomColor: 'rgba(42, 120, 214, 0)',
      })
      break
  }
  const mode =
    p.scaleMode === 'log'
      ? PriceScaleMode.Logarithmic
      : p.scaleMode === 'percent'
        ? PriceScaleMode.Percentage
        : PriceScaleMode.Normal
  b.main.priceScale().applyOptions({ mode })

  for (const inst of p.studies) {
    const series = b.studies[inst.uid]
    const def = p.catalog[inst.id]
    if (!series || !def) continue
    for (const out of def.outputs) {
      const s = series.outputs[out.key]
      if (!s) continue
      const color = resolveColor(inst.colors[out.key] ?? 'slot:0', theme)
      if (out.style === 'histogram') {
        s.applyOptions(out.signed ? { visible: inst.visible } : { visible: inst.visible, color })
      } else {
        s.applyOptions({ visible: inst.visible, color, lineWidth: inst.lineWidth as 1 | 2 | 3 | 4 })
      }
    }
  }
}

function showLatest(chart: IChartApi, n: number, compact = false) {
  const bars = compact ? INITIAL_VISIBLE_BARS_PHONE : INITIAL_VISIBLE_BARS
  if (n > 0) chart.timeScale().setVisibleLogicalRange({ from: n - bars, to: n + (compact ? 3 : 8) })
}

/** Scrolled back from the latest bar, or the price axis was dragged off auto. */
function isAway(chart: IChartApi, main: ISeriesApi<SeriesType>): boolean {
  const r = chart.timeScale().getVisibleLogicalRange()
  const n = main.data().length
  if (r && n && r.to < n - 1) return true
  return chart.panes().some((_, i) => !chart.priceScale('right', i).options().autoScale)
}

function heikinAshi(candles: Candle[]): Candle[] {
  const out: Candle[] = []
  for (const c of candles) {
    const prev = out[out.length - 1]
    const close = (c.open + c.high + c.low + c.close) / 4
    const open = prev ? (prev.open + prev.close) / 2 : (c.open + c.close) / 2
    out.push({
      time: c.time,
      open,
      close,
      high: Math.max(c.high, open, close),
      low: Math.min(c.low, open, close),
      volume: c.volume,
    })
  }
  return out
}

/** A price from a screen position, rounded like a typed one. */
const roundPrice = (v: number) => (v >= 1000 ? Math.round(v) : Math.round(v * 20) / 20)

// --- legends ------------------------------------------------------------------------

const fmt = (v: number) => v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtVolume = (v: number) =>
  Math.abs(v) >= 1e7
    ? `${(v / 1e7).toFixed(2)} Cr`
    : Math.abs(v) >= 1e5
      ? `${(v / 1e5).toFixed(2)} L`
      : v.toLocaleString('en-IN', { maximumFractionDigits: 0 })

function hoverIndex(candles: Candle[], time: number | null): number {
  if (time === null) return candles.length - 1
  const i = candles.findIndex((c) => c.time === time)
  return i >= 0 ? i : candles.length - 1
}

function valueAt(points: LinePoint[] | undefined, time: number | undefined): number | undefined {
  if (!points || time === undefined) return undefined
  let lo = 0
  let hi = points.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (points[mid].time === time) return points[mid].value
    if (points[mid].time < time) lo = mid + 1
    else hi = mid - 1
  }
  return undefined
}

// Legend parts. Rows take pointer events; the box around them lets the chart
// under it pan. Touch screens have no hover: a tapped (focused) row shows its
// buttons instead.
const legendBox = 'pointer-events-none absolute right-20 left-2 z-[5] text-[13px] tabular-nums max-md:right-14 max-md:text-[12px]'
const legendRow = 'flex min-h-[22px] w-fit max-w-full flex-wrap items-center gap-x-2 gap-y-0.5 rounded-[4px] px-1 text-fg'
const studyRow = 'group pointer-events-auto outline-none hover:bg-hover [@media(hover:none)]:focus-within:bg-hover'
const legendActions = 'hidden gap-0.5 group-hover:inline-flex [@media(hover:none)]:group-focus-within:inline-flex'

function LegendButton({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      className="inline-flex cursor-pointer rounded-[4px] border border-line bg-raised p-0.5 text-muted transition hover:text-fg [@media(hover:none)]:p-1.5"
    >
      {children}
    </button>
  )
}

const Chevron = ({ up }: { up: boolean }) => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
    <path d={up ? 'M3 7.5l3-3 3 3' : 'M3 4.5l3 3 3-3'} />
  </svg>
)

function MainLegend({
  title,
  candles,
  index,
  live,
  refreshing,
  open,
  onToggle,
}: {
  title: string
  candles: Candle[]
  index: number
  live: boolean
  refreshing: boolean
  open: boolean
  onToggle: () => void
}) {
  const bar = candles[index]
  if (!bar) return null
  const prev = candles[index - 1]
  const change = prev ? bar.close - prev.close : 0
  const pct = prev ? (change / prev.close) * 100 : 0
  const sign = change >= 0 ? '+' : ''
  const tone = change >= 0 ? 'text-up' : 'text-down'
  return (
    <div className={cx(legendRow, 'mb-0.5', !open && 'bg-surface/75 backdrop-blur-[2px]')}>
      <button
        className="pointer-events-auto -ml-1 inline-flex size-5 cursor-pointer items-center justify-center rounded text-muted transition hover:bg-hover hover:text-fg [@media(hover:none)]:size-7"
        onClick={onToggle}
        aria-expanded={open}
        title={open ? 'Hide legend (prices and indicator values)' : 'Show legend'}
      >
        <Chevron up={open} />
      </button>
      <span className="text-[14px] font-medium max-md:text-[13px]">{title}</span>
      {live && (
        <span className="text-[11px] font-semibold tracking-[0.04em] text-up" title="Live prices streaming">
          ● LIVE
        </span>
      )}
      {refreshing && <Spinner size={11} className="text-muted" />}
      {open && (
        <span className="text-muted">
          O<b className={cx('mr-1.5 ml-0.5 font-normal', tone)}>{fmt(bar.open)}</b>H
          <b className={cx('mr-1.5 ml-0.5 font-normal', tone)}>{fmt(bar.high)}</b>L
          <b className={cx('mr-1.5 ml-0.5 font-normal', tone)}>{fmt(bar.low)}</b>C
          <b className={cx('mr-1.5 ml-0.5 font-normal', tone)}>{fmt(bar.close)}</b>
          <b className={cx('font-normal', tone)}>
            {sign}
            {fmt(change)} ({sign}
            {pct.toFixed(2)}%)
          </b>
        </span>
      )}
      {!open && (
        <b className={cx('font-medium', tone)}>
          {fmt(bar.close)} {sign}
          {pct.toFixed(2)}%
        </b>
      )}
    </div>
  )
}

/** Indicator rows on the price pane, with a fold button under them; folded
 * they become one chip ("3 indicators") so the candles stay clear. */
function OverlayLegends({
  studies,
  open,
  onToggle,
  render,
}: {
  studies: StudyInstance[]
  open: boolean
  onToggle: () => void
  render: (s: StudyInstance) => ReactNode
}) {
  if (!studies.length) return null
  const chip =
    'pointer-events-auto my-0.5 inline-flex h-[22px] cursor-pointer items-center gap-1 rounded-full border border-line bg-surface/85 text-[12px] text-muted backdrop-blur-[2px] transition hover:border-muted hover:text-fg'
  if (!open)
    return (
      <button className={cx(chip, 'pr-2 pl-1')} onClick={onToggle} aria-expanded={false} title="Show indicator values">
        <Chevron up={false} />
        {studies.length} indicator{studies.length > 1 ? 's' : ''}
      </button>
    )
  return (
    <>
      {studies.map(render)}
      <button className={cx(chip, 'w-[22px] justify-center')} onClick={onToggle} aria-expanded aria-label="Collapse indicators" title="Collapse indicators">
        <Chevron up />
      </button>
    </>
  )
}

function StudyLegend({
  inst,
  def,
  result,
  time,
  theme,
  onAction,
}: {
  inst: StudyInstance
  def: StudyDef
  result: StudyChartData['studies']
  time: number | undefined
  theme: ChartTheme
  onAction: (uid: string, action: StudyAction) => void
}) {
  const outputs = result[inst.uid]?.outputs
  return (
    // Focusable so a tap on a touch screen selects the row and shows its buttons.
    <div className={cx(legendRow, studyRow)} tabIndex={-1}>
      <span className={inst.visible ? 'text-fg' : 'text-muted'}>{studyTitle(def, inst)}</span>
      {inst.visible &&
        def.outputs.map((o) => {
          const v = valueAt(outputs?.[o.key], time)
          const token = inst.colors[o.key] ?? 'slot:0'
          const color = token === 'signed' ? (v !== undefined && v < 0 ? theme.down : theme.up) : resolveColor(token, theme)
          return (
            <b key={o.key} className="font-normal" style={{ color }} title={o.name}>
              {v === undefined ? '∅' : Math.abs(v) >= 1e5 ? fmtVolume(v) : fmt(v)}
            </b>
          )
        })}
      <span className={legendActions}>
        <LegendButton title={inst.visible ? 'Hide' : 'Show'} onClick={() => onAction(inst.uid, 'toggle')}>
          {inst.visible ? <EyeIcon /> : <EyeOffIcon />}
        </LegendButton>
        <LegendButton title="Settings" onClick={() => onAction(inst.uid, 'settings')}>
          <GearIcon />
        </LegendButton>
        <LegendButton title="Remove" onClick={() => onAction(inst.uid, 'remove')}>
          <CloseIcon />
        </LegendButton>
      </span>
    </div>
  )
}

const icon = {
  width: 14,
  height: 14,
  viewBox: '0 0 18 18',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  'aria-hidden': true,
}
const EyeIcon = () => (
  <svg {...icon}>
    <path d="M1.5 9s2.8-5 7.5-5 7.5 5 7.5 5-2.8 5-7.5 5-7.5-5-7.5-5z" />
    <circle cx="9" cy="9" r="2.2" />
  </svg>
)
const EyeOffIcon = () => (
  <svg {...icon}>
    <path d="M1.5 9s2.8-5 7.5-5 7.5 5 7.5 5-2.8 5-7.5 5-7.5-5-7.5-5z" />
    <path d="M3 15L15 3" />
  </svg>
)
const GearIcon = () => (
  <svg {...icon}>
    <circle cx="9" cy="9" r="2.4" />
    <path d="M9 1.8v2M9 14.2v2M1.8 9h2M14.2 9h2M3.9 3.9l1.4 1.4M12.7 12.7l1.4 1.4M3.9 14.1l1.4-1.4M12.7 5.3l1.4-1.4" />
  </svg>
)
const CloseIcon = () => (
  <svg {...icon}>
    <path d="M4.5 4.5l9 9M13.5 4.5l-9 9" />
  </svg>
)
