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
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type LogicalRange,
  type MouseEventParams,
  type SeriesMarker,
  type SeriesType,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Candle, LinePoint, StudyChartData, StudyDef } from '../api/client'
import { DrawingsPrimitive } from '../drawings/DrawingsPrimitive'
import type { Drawing, DrawingTool } from '../drawings/types'
import { useDrawings } from '../drawings/useDrawings'
import type { StudyInstance } from '../studies/model'
import { studyTitle } from '../studies/model'
import { formatCrosshairTime } from './format'
import { resolveColor, type ChartTheme } from './theme'

export type ChartType = 'candles' | 'hollow' | 'bars' | 'line' | 'area' | 'heikin'
export type ScaleMode = 'normal' | 'log' | 'percent'
export type StudyAction = 'toggle' | 'settings' | 'remove'

// Bars shown when a symbol/timeframe is first opened.
const INITIAL_VISIBLE_BARS = 150
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
  tool: DrawingTool
  onToolDone: () => void
  drawings: Drawing[]
  onDrawingsChange: (drawings: Drawing[]) => void
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
}

const t = (time: number) => time as UTCTimestamp

export function PriceChart(props: Props) {
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
    const chart = createChart(containerRef.current!, { autoSize: true, ...chartOptions(p.theme, p.intraday) })
    const b = buildSeries(chart, p)
    builtRef.current = b
    applyData(b, p, candlesRef.current)
    applyStyles(b, p)

    if (savedRangeRef.current && loadedKeyRef.current === p.datasetKey) {
      chart.timeScale().setVisibleLogicalRange(savedRangeRef.current)
    } else {
      showLatest(chart, candlesRef.current.length)
    }
    loadedKeyRef.current = p.datasetKey

    chart.timeScale().subscribeVisibleLogicalRangeChange((r) => {
      if (r && r.from < LOAD_MORE_THRESHOLD && propsRef.current.data.has_more) propsRef.current.onNeedMore()
    })
    chart.subscribeCrosshairMove((e: MouseEventParams<Time>) =>
      setHover(e.time === undefined ? null : (e.time as number)),
    )
    setBuilt(b)
    setContainer(containerRef.current)

    return () => {
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
    else showLatest(b.chart, candles.length)
    loadedKeyRef.current = datasetKey
  }, [candles, data.studies, datasetKey, theme])

  // Colors, visibility, scale mode, time-axis format. Effects read the live
  // chart from builtRef: in a render where the layout changed, `built` state
  // still points at the chart that was just destroyed.
  useEffect(() => {
    const b = builtRef.current
    if (b) applyStyles(b, propsRef.current)
  }, [built, theme, studies, scaleMode, intraday, chartType])

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

  const index = hoverIndex(data.candles, hover)
  const barTime = data.candles[index]?.time
  const legendProps = { result: data.studies, time: barTime, theme, onAction: onStudyAction }

  return (
    <div className="chart-wrap">
      <div ref={containerRef} className="chart" />
      {built && paneTops.length > 0 && (
        <>
          <div className="pane-legend" style={{ top: paneTops[0] + 6 }}>
            <MainLegend title={title} candles={candles} index={index} />
            {studies
              .filter((s) => catalog[s.id]?.overlay)
              .map((s) => (
                <StudyLegend key={s.uid} inst={s} def={catalog[s.id]} {...legendProps} />
              ))}
          </div>
          {built.volumePane !== null && paneTops[built.volumePane] !== undefined && (
            <div className="pane-legend" style={{ top: paneTops[built.volumePane] + 4 }}>
              <div className="legend-row study">
                <span className="legend-title">Vol</span>
                <b>{data.candles[index] ? fmtVolume(data.candles[index].volume) : '–'}</b>
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

function chartOptions(theme: ChartTheme, intraday: boolean) {
  const label = theme.dark ? '#363a45' : '#131722'
  return {
    layout: {
      background: { color: theme.surface },
      textColor: theme.muted,
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif",
      fontSize: 12,
      panes: { separatorColor: theme.border, separatorHoverColor: theme.grid, enableResize: true },
    },
    grid: { vertLines: { color: theme.grid }, horzLines: { color: theme.grid } },
    rightPriceScale: { borderColor: theme.border },
    timeScale: { borderColor: theme.border, timeVisible: intraday, secondsVisible: false, rightOffset: 8 },
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
  main.attachPrimitive(drawings)
  return { chart, main, volume, volumePane, studies, markers: createSeriesMarkers(main, []), drawings }
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

function applyData(b: Built, p: Props, candles: Candle[]) {
  const { theme } = p
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
  b.chart.applyOptions(chartOptions(theme, p.intraday))
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

function showLatest(chart: IChartApi, n: number) {
  if (n > 0) chart.timeScale().setVisibleLogicalRange({ from: n - INITIAL_VISIBLE_BARS, to: n + 8 })
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

function MainLegend({ title, candles, index }: { title: string; candles: Candle[]; index: number }) {
  const bar = candles[index]
  if (!bar) return null
  const prev = candles[index - 1]
  const change = prev ? bar.close - prev.close : 0
  const pct = prev ? (change / prev.close) * 100 : 0
  const sign = change >= 0 ? '+' : ''
  return (
    <div className="legend-row main">
      <span className="legend-symbol">{title}</span>
      <span className={`ohlc ${change >= 0 ? 'up' : 'down'}`}>
        O<b>{fmt(bar.open)}</b> H<b>{fmt(bar.high)}</b> L<b>{fmt(bar.low)}</b> C<b>{fmt(bar.close)}</b>{' '}
        <b>
          {sign}
          {fmt(change)} ({sign}
          {pct.toFixed(2)}%)
        </b>
      </span>
    </div>
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
    <div className={`legend-row study ${inst.visible ? '' : 'is-hidden'}`}>
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
