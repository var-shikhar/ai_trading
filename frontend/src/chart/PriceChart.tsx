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
import { withLiveBar } from '../live/bars'
import { useDrawings } from '../drawings/useDrawings'
import type { ChartPatternResult } from '../patterns/chartPatterns'
import { PatternOverlayPrimitive } from '../patterns/PatternOverlayPrimitive'
import type { StudyInstance } from '../studies/model'
import { studyTitle } from '../studies/model'
import { usePref } from '../prefs'
import { MOBILE_QUERY, useMediaQuery } from '../pwa'
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
  /** "Alert on this line" from the selected drawing's toolbar. */
  onDrawingAlert?: (d: Drawing) => void
  /** Right-click / long-press menu: "Alert when price crosses ₹X". */
  onPriceAlert?: (price: number) => void
  /** Active price alerts on this symbol, drawn as dashed lines. */
  alertLevels?: number[]
  /** Phone-sized: smaller axis text and fewer decimals (set internally). */
  compact?: boolean
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
      setMenu({ x: Math.min(x, box.width - 230), y, price })
      return true
    }
    const onContext = (e: MouseEvent) => {
      if (open(e.clientX, e.clientY)) e.preventDefault()
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    let start: { x: number; y: number } | null = null
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return
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
  useEffect(() => {
    if (!menu) return
    const close = (e: Event) => !(e.target as HTMLElement).closest?.('.chart-menu') && setMenu(null)
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
    <div className="chart-wrap">
      <div ref={containerRef} className="chart" />
      {built && paneTops.length > 0 && (
        <>
          <div className="pane-legend" style={{ top: paneTops[0] + 6 }}>
            <MainLegend
              title={title}
              candles={display}
              index={index}
              live={props.isLive ?? false}
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
            <div className="pane-legend" style={{ top: paneTops[built.volumePane] + 4 }}>
              <div className="legend-row study">
                <span className="legend-title">Vol</span>
                <b>{merged[index] ? fmtVolume(merged[index].volume) : '–'}</b>
                <span className="legend-actions">
                  <button title="Remove" onClick={onHideVolume}>
                    <CloseIcon />
                  </button>
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
                <div key={s.uid} className="pane-legend" style={{ top: paneTops[pane] + 4 }}>
                  <StudyLegend inst={s} def={catalog[s.id]} {...legendProps} />
                </div>
              )
            })}
        </>
      )}
      {away && (
        <button className="recenter-button" onClick={recenter} title="Back to the latest bar (reset zoom and price scale)">
          <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
            <circle cx="9" cy="9" r="3" />
            <path d="M9 1.5v3M9 13.5v3M1.5 9h3M13.5 9h3" />
          </svg>
          <span>Now</span>
        </button>
      )}
      {menu && (
        <div className="chart-menu" role="menu" style={{ left: menu.x, top: menu.y }}>
          {props.onPriceAlert && (
            <button
              role="menuitem"
              onClick={() => {
                props.onPriceAlert!(roundPrice(menu.price))
                setMenu(null)
              }}
            >
              🔔 Alert when price crosses <b>{fmt(roundPrice(menu.price))}</b>
            </button>
          )}
          <button
            role="menuitem"
            onClick={() => {
              props.onDrawingsChange([
                ...props.drawings,
                { id: drawingId(), type: 'hline', color: 'slot:0', price: roundPrice(menu.price) },
              ])
              setMenu(null)
            }}
          >
            ― Horizontal line at <b>{fmt(roundPrice(menu.price))}</b>
          </button>
        </div>
      )}
      {drawing.selected && (
        <div className="drawing-floater" role="toolbar" aria-label="Selected drawing">
          {drawing.selected.type !== 'long' && drawing.selected.type !== 'short' &&
            theme.series.map((c, n) => (
              <button
                key={c}
                className={`swatch-button ${drawing.selected?.color === `slot:${n}` ? 'active' : ''}`}
                style={{ background: c }}
                aria-label={`Color ${n + 1}`}
                onClick={() => drawing.setColor(`slot:${n}`)}
              />
            ))}
          {(drawing.selected.type === 'hline' || drawing.selected.type === 'trend') && props.onDrawingAlert && (
            <button className="icon-button" title="Alert when price crosses this line" onClick={() => props.onDrawingAlert?.(drawing.selected!)}>
              🔔
            </button>
          )}
          <button className="icon-button" title="Remove (Delete)" onClick={drawing.remove}>
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
              <path d="M4 6h12M8 6V4h4v2M6 6l1 11h6l1-11" />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}

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

function MainLegend({
  title,
  candles,
  index,
  live,
  open,
  onToggle,
}: {
  title: string
  candles: Candle[]
  index: number
  live: boolean
  open: boolean
  onToggle: () => void
}) {
  const bar = candles[index]
  if (!bar) return null
  const prev = candles[index - 1]
  const change = prev ? bar.close - prev.close : 0
  const pct = prev ? (change / prev.close) * 100 : 0
  const sign = change >= 0 ? '+' : ''
  return (
    <div className={`legend-row main ${open ? '' : 'folded'}`}>
      <button
        className="legend-fold"
        onClick={onToggle}
        aria-expanded={open}
        title={open ? 'Hide legend (prices and indicator values)' : 'Show legend'}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
          <path d={open ? 'M3 7.5l3-3 3 3' : 'M3 4.5l3 3 3-3'} />
        </svg>
      </button>
      <span className="legend-symbol">{title}</span>
      {live && (
        <span className="live-dot" title="Live prices streaming">
          ● LIVE
        </span>
      )}
      {open && (
        <span className={`ohlc ${change >= 0 ? 'up' : 'down'}`}>
          O<b>{fmt(bar.open)}</b> H<b>{fmt(bar.high)}</b> L<b>{fmt(bar.low)}</b> C<b>{fmt(bar.close)}</b>{' '}
          <b>
            {sign}
            {fmt(change)} ({sign}
            {pct.toFixed(2)}%)
          </b>
        </span>
      )}
      {!open && (
        <b className={change >= 0 ? 'up-text' : 'down-text'}>
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
  const chevron = (up: boolean) => (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d={up ? 'M3 7.5l3-3 3 3' : 'M3 4.5l3 3 3-3'} />
    </svg>
  )
  if (!open)
    return (
      <button className="legend-chip" onClick={onToggle} aria-expanded={false} title="Show indicator values">
        {chevron(false)}
        {studies.length} indicator{studies.length > 1 ? 's' : ''}
      </button>
    )
  return (
    <>
      {studies.map(render)}
      <button className="legend-chip only-icon" onClick={onToggle} aria-expanded title="Collapse indicators">
        {chevron(true)}
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
    <div className={`legend-row study ${inst.visible ? '' : 'is-hidden'}`} tabIndex={-1}>
      <span className="legend-title">{studyTitle(def, inst)}</span>
      {inst.visible &&
        def.outputs.map((o) => {
          const v = valueAt(outputs?.[o.key], time)
          const token = inst.colors[o.key] ?? 'slot:0'
          const color =
            token === 'signed' ? (v !== undefined && v < 0 ? theme.down : theme.up) : resolveColor(token, theme)
          return (
            <b key={o.key} style={{ color }} title={o.name}>
              {v === undefined ? '∅' : Math.abs(v) >= 1e5 ? fmtVolume(v) : fmt(v)}
            </b>
          )
        })}
      <span className="legend-actions">
        <button title={inst.visible ? 'Hide' : 'Show'} onClick={() => onAction(inst.uid, 'toggle')}>
          {inst.visible ? <EyeIcon /> : <EyeOffIcon />}
        </button>
        <button title="Settings" onClick={() => onAction(inst.uid, 'settings')}>
          <GearIcon />
        </button>
        <button title="Remove" onClick={() => onAction(inst.uid, 'remove')}>
          <CloseIcon />
        </button>
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
