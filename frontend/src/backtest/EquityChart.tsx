import { AreaSeries, createChart, LineSeries, type IChartApi, type UTCTimestamp } from 'lightweight-charts'
import { useEffect, useRef } from 'react'
import type { ChartTheme } from '../chart/theme'

const t = (x: number) => x as UTCTimestamp

/** Strategy equity vs NIFTY 50 buy & hold (same scale: both start at the
 * starting capital), with the strategy's drawdown in its own pane below. */
export function EquityChart({
  equity,
  benchmark,
  theme,
}: {
  equity: [number, number][]
  benchmark: [number, number][] | null
  theme: ChartTheme
}) {
  const ref = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)

  useEffect(() => {
    const chart = createChart(ref.current!, {
      autoSize: true,
      layout: { background: { color: theme.surface }, textColor: theme.muted, fontSize: 11 },
      grid: { vertLines: { visible: false }, horzLines: { color: theme.grid } },
      rightPriceScale: { borderColor: theme.border },
      timeScale: { borderColor: theme.border },
      handleScroll: false,
      handleScale: false,
    })
    chartRef.current = chart
    if (benchmark?.length) {
      const b = chart.addSeries(LineSeries, {
        color: theme.muted,
        lineWidth: 1,
        lineStyle: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        title: 'NIFTY 50',
      })
      b.setData(benchmark.map(([x, v]) => ({ time: t(x), value: v })))
    }
    const s = chart.addSeries(LineSeries, {
      color: theme.series[0],
      lineWidth: 2,
      priceLineVisible: false,
      title: 'Strategy',
    })
    s.setData(equity.map(([x, v]) => ({ time: t(x), value: v })))

    // Drawdown (%) from the running peak.
    let peak = -Infinity
    const dd = equity.map(([x, v]) => {
      peak = Math.max(peak, v)
      return { time: t(x), value: ((v - peak) / peak) * 100 }
    })
    const ddSeries = chart.addSeries(
      AreaSeries,
      {
        lineColor: theme.down,
        topColor: theme.downVolume,
        bottomColor: theme.downVolume,
        lineWidth: 1,
        priceLineVisible: false,
        title: 'Drawdown %',
        priceFormat: { type: 'percent' },
      },
      1,
    )
    ddSeries.setData(dd)
    chart.panes()[0]?.setStretchFactor(3)
    chart.panes()[1]?.setStretchFactor(1)
    chart.timeScale().fitContent()
    return () => chart.remove()
  }, [equity, benchmark, theme])

  return <div ref={ref} className="equity-chart" role="img" aria-label="Equity curve and drawdown" />
}
