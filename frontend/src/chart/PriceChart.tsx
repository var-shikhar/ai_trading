import {
  CandlestickSeries,
  createChart,
  createSeriesMarkers,
  HistogramSeries,
  LineSeries,
  LineStyle,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type LineData,
  type MouseEventParams,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts'
import { useEffect, useRef, useState } from 'react'
import type { Candle, ChartData, IndicatorKey } from '../api/client'
import type { ChartTheme } from './theme'

export const EMA_KEYS = ['ema20', 'ema50', 'ema200'] as const
export type EmaKey = (typeof EMA_KEYS)[number]

const EMA_LABELS: Record<EmaKey, string> = { ema20: 'EMA 20', ema50: 'EMA 50', ema200: 'EMA 200' }

// Bars shown when a symbol/timeframe is first opened.
const INITIAL_VISIBLE_BARS = 150
// Ask for more history when the left edge is within this many bars.
const LOAD_MORE_THRESHOLD = 20

interface Props {
  data: ChartData
  /** Changes when symbol/timeframe change; the view resets on a new key. */
  datasetKey: string
  intraday: boolean
  theme: ChartTheme
  visibleEmas: Record<EmaKey, boolean>
  showVolume: boolean
  showRsi: boolean
  markers: SeriesMarker<Time>[]
  /** Scrolls the chart to this bar; `seq` lets the same bar be focused twice. */
  focus: { time: number; seq: number } | null
  onNeedMore: () => void
}

interface Series {
  candles: ISeriesApi<'Candlestick'>
  emas: Record<EmaKey, ISeriesApi<'Line'>>
  // Volume and RSI each get their own pane below price (never a second axis
  // on the price pane). They're removed when hidden so the pane goes away.
  volume: ISeriesApi<'Histogram'> | null
  rsi: ISeriesApi<'Line'> | null
}

const PANE_STRETCH = { price: 6, volume: 1.4, rsi: 1.8 }

/** Add/remove the volume and RSI panes so they sit in order below price. */
function syncPanes(
  chart: IChartApi,
  s: Series,
  showVolume: boolean,
  showRsi: boolean,
  theme: ChartTheme,
  data: ChartData,
) {
  if (!showRsi && s.rsi) {
    chart.removeSeries(s.rsi)
    s.rsi = null
  }
  if (!showVolume && s.volume) {
    chart.removeSeries(s.volume)
    s.volume = null
  }
  if (showVolume && !s.volume) {
    s.volume = chart.addSeries(
      HistogramSeries,
      { priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false },
      1,
    )
    s.volume.setData(volumeData(data.candles, theme))
  }
  const rsiPane = showVolume ? 2 : 1
  if (showRsi && !s.rsi) {
    s.rsi = chart.addSeries(
      LineSeries,
      { color: theme.rsi, lineWidth: 2, priceLineVisible: false, crosshairMarkerVisible: false },
      rsiPane,
    )
    for (const level of [70, 30]) {
      s.rsi.createPriceLine({
        price: level,
        color: theme.guide,
        lineStyle: LineStyle.Dashed,
        lineWidth: 1,
        axisLabelVisible: false,
      })
    }
    s.rsi.setData(data.indicators.rsi14.map(toLine))
  } else if (s.rsi && s.rsi.getPane().paneIndex() !== rsiPane) {
    s.rsi.moveToPane(rsiPane)
  }
  const panes = chart.panes()
  panes[0].setStretchFactor(PANE_STRETCH.price)
  if (s.volume) s.volume.getPane().setStretchFactor(PANE_STRETCH.volume)
  if (s.rsi) s.rsi.getPane().setStretchFactor(PANE_STRETCH.rsi)
}

const t = (time: number) => time as UTCTimestamp

function chartOptions(theme: ChartTheme, intraday: boolean) {
  return {
    layout: {
      background: { color: theme.surface },
      textColor: theme.muted,
      fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
      panes: { separatorColor: theme.border, separatorHoverColor: theme.grid },
    },
    grid: { vertLines: { color: theme.grid }, horzLines: { color: theme.grid } },
    rightPriceScale: { borderColor: theme.border },
    timeScale: { borderColor: theme.border, timeVisible: intraday, secondsVisible: false },
    crosshair: { mode: 0 }, // free-moving crosshair, not snapped to closes
  }
}

export function PriceChart({
  data,
  datasetKey,
  intraday,
  theme,
  visibleEmas,
  showVolume,
  showRsi,
  markers,
  focus,
  onNeedMore,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<Series | null>(null)
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)
  const loadedKeyRef = useRef<string | null>(null)
  const dataRef = useRef(data)
  const hasMoreRef = useRef(data.has_more)
  const onNeedMoreRef = useRef(onNeedMore)
  const [hover, setHover] = useState<number | null>(null)

  dataRef.current = data
  hasMoreRef.current = data.has_more
  onNeedMoreRef.current = onNeedMore

  // Create the chart once.
  useEffect(() => {
    const chart = createChart(containerRef.current!, { autoSize: true, ...chartOptions(theme, intraday) })
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: theme.up,
      downColor: theme.down,
      wickUpColor: theme.up,
      wickDownColor: theme.down,
      borderVisible: false,
    })
    const emas = Object.fromEntries(
      EMA_KEYS.map((k) => [
        k,
        chart.addSeries(LineSeries, {
          color: theme[k],
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
          crosshairMarkerVisible: false,
        }),
      ]),
    ) as Record<EmaKey, ISeriesApi<'Line'>>
    const series: Series = { candles, emas, volume: null, rsi: null }
    syncPanes(chart, series, showVolume, showRsi, theme, data)

    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (range && range.from < LOAD_MORE_THRESHOLD && hasMoreRef.current) onNeedMoreRef.current()
    })
    const onCrosshair = (p: MouseEventParams<Time>) =>
      setHover(p.time === undefined ? null : (p.time as number))
    chart.subscribeCrosshairMove(onCrosshair)

    chartRef.current = chart
    seriesRef.current = series
    markersRef.current = createSeriesMarkers(candles, [])
    return () => {
      markersRef.current = null
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
    }
    // Theme/intraday changes are applied below without recreating the chart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Theme and time-axis format.
  useEffect(() => {
    const chart = chartRef.current
    const s = seriesRef.current
    if (!chart || !s) return
    chart.applyOptions(chartOptions(theme, intraday))
    s.candles.applyOptions({
      upColor: theme.up,
      downColor: theme.down,
      wickUpColor: theme.up,
      wickDownColor: theme.down,
    })
    for (const k of EMA_KEYS) s.emas[k].applyOptions({ color: theme[k] })
    s.rsi?.applyOptions({ color: theme.rsi })
    s.volume?.setData(volumeData(data.candles, theme))
  }, [theme, intraday, data.candles])

  // Data. Keep the visible window when older history is prepended.
  useEffect(() => {
    const chart = chartRef.current
    const s = seriesRef.current
    if (!chart || !s) return
    const sameDataset = loadedKeyRef.current === datasetKey
    const previous = sameDataset ? chart.timeScale().getVisibleRange() : null

    s.candles.setData(data.candles.map(toCandle))
    s.volume?.setData(volumeData(data.candles, theme))
    for (const k of EMA_KEYS) s.emas[k].setData(data.indicators[k].map(toLine))
    s.rsi?.setData(data.indicators.rsi14.map(toLine))

    if (previous) {
      chart.timeScale().setVisibleRange(previous)
    } else {
      const n = data.candles.length
      chart.timeScale().setVisibleLogicalRange({ from: n - INITIAL_VISIBLE_BARS, to: n + 3 })
    }
    loadedKeyRef.current = datasetKey
    // theme is handled by the effect above
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, datasetKey])

  // Pattern markers (re-applied after data so they attach to the new bars).
  useEffect(() => {
    markersRef.current?.setMarkers(markers)
  }, [markers, data])

  // Jump to a bar, e.g. a pattern hit picked from the list.
  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !focus) return
    const index = dataRef.current.candles.findIndex((c) => c.time === focus.time)
    if (index < 0) return
    chart.timeScale().setVisibleLogicalRange({ from: index - 60, to: index + 30 })
  }, [focus])

  // Indicator visibility.
  useEffect(() => {
    const s = seriesRef.current
    const chart = chartRef.current
    if (!s || !chart) return
    for (const k of EMA_KEYS) s.emas[k].applyOptions({ visible: visibleEmas[k] })
    syncPanes(chart, s, showVolume, showRsi, theme, dataRef.current)
    // theme is applied by its own effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleEmas, showVolume, showRsi])

  return (
    <div className="chart-wrap">
      <div ref={containerRef} className="chart" />
      <Legend
        data={data}
        time={hover}
        theme={theme}
        visibleEmas={visibleEmas}
        showVolume={showVolume}
        showRsi={showRsi}
      />
    </div>
  )
}

function toCandle(c: Candle): CandlestickData<Time> {
  return { time: t(c.time), open: c.open, high: c.high, low: c.low, close: c.close }
}

function toLine(p: { time: number; value: number }): LineData<Time> {
  return { time: t(p.time), value: p.value }
}

function volumeData(candles: Candle[], theme: ChartTheme) {
  return candles.map((c) => ({
    time: t(c.time),
    value: c.volume,
    color: c.close >= c.open ? theme.upVolume : theme.downVolume,
  }))
}

// --- Legend: OHLC + indicator values at the crosshair (or the latest bar) ---

const fmt = (v: number) => v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtVolume = (v: number) =>
  v >= 1e7 ? `${(v / 1e7).toFixed(2)} Cr` : v >= 1e5 ? `${(v / 1e5).toFixed(2)} L` : v.toLocaleString('en-IN')

function valueAt(points: { time: number; value: number }[], time: number): number | undefined {
  // Points are sorted; binary search for the exact time.
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

function Legend({
  data,
  time,
  theme,
  visibleEmas,
  showVolume,
  showRsi,
}: {
  data: ChartData
  time: number | null
  theme: ChartTheme
  visibleEmas: Record<EmaKey, boolean>
  showVolume: boolean
  showRsi: boolean
}) {
  const candles = data.candles
  if (!candles.length) return null
  let index = candles.length - 1
  if (time !== null) {
    const found = candles.findIndex((c) => c.time === time)
    if (found >= 0) index = found
  }
  const bar = candles[index]
  const prev = candles[index - 1]
  const change = prev ? bar.close - prev.close : 0
  const changePct = prev ? (change / prev.close) * 100 : 0
  const dir = change >= 0 ? 'up' : 'down'
  const indicator = (k: IndicatorKey) => valueAt(data.indicators[k], bar.time)
  const rsiValue = indicator('rsi14')

  return (
    <div className="legend">
      <div className="legend-row">
        <span>O <b>{fmt(bar.open)}</b></span>
        <span>H <b>{fmt(bar.high)}</b></span>
        <span>L <b>{fmt(bar.low)}</b></span>
        <span>C <b>{fmt(bar.close)}</b></span>
        {prev && (
          <span className={`chg ${dir}`}>
            {change >= 0 ? '+' : ''}
            {fmt(change)} ({change >= 0 ? '+' : ''}
            {changePct.toFixed(2)}%)
          </span>
        )}
        {showVolume && (
          <span>
            Vol <b>{fmtVolume(bar.volume)}</b>
          </span>
        )}
      </div>
      <div className="legend-row">
        {EMA_KEYS.filter((k) => visibleEmas[k]).map((k) => {
          const v = indicator(k)
          return (
            <span key={k}>
              <i className="swatch" style={{ background: theme[k] }} />
              {EMA_LABELS[k]} <b>{v === undefined ? '–' : fmt(v)}</b>
            </span>
          )
        })}
        {showRsi && (
          <span>
            <i className="swatch" style={{ background: theme.rsi }} />
            RSI 14 <b>{rsiValue === undefined ? '–' : rsiValue.toFixed(2)}</b>
          </span>
        )}
      </div>
    </div>
  )
}
