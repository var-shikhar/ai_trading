import type { IChartApi, ISeriesApi, Logical, SeriesType } from 'lightweight-charts'
import type { Candle } from '../api/client'
import type { Pt } from './types'

/**
 * Converts between chart points (time, price) and pixels. Times map through
 * bar indexes, so points between bars, before the first bar or after the
 * last one (e.g. a long position's right edge) still get a position.
 */
export class Mapper {
  private times: number[]
  private interval: number
  private chart: IChartApi
  private series: ISeriesApi<SeriesType>

  constructor(chart: IChartApi, series: ISeriesApi<SeriesType>, candles: Candle[]) {
    this.chart = chart
    this.series = series
    this.times = candles.map((c) => c.time)
    // Typical bar spacing, from the median of recent gaps.
    const gaps = this.times.slice(-50).map((t, i, a) => (i ? t - a[i - 1] : 0)).slice(1).sort((x, y) => x - y)
    this.interval = gaps.length ? gaps[gaps.length >> 1] : 86400
  }

  get barCount() {
    return this.times.length
  }

  /** Fractional bar index of a time. */
  logical(time: number): number {
    const t = this.times
    const n = t.length
    if (!n) return 0
    if (time <= t[0]) return (time - t[0]) / this.interval
    if (time >= t[n - 1]) return n - 1 + (time - t[n - 1]) / this.interval
    let lo = 0
    let hi = n - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (t[mid] <= time) lo = mid
      else hi = mid
    }
    return lo + (time - t[lo]) / (t[hi] - t[lo])
  }

  /** Time of a (possibly fractional or out-of-range) bar index. */
  timeAt(logical: number): number {
    const t = this.times
    const n = t.length
    if (!n) return 0
    if (logical <= 0) return t[0] + logical * this.interval
    if (logical >= n - 1) return t[n - 1] + (logical - (n - 1)) * this.interval
    const i = Math.floor(logical)
    return t[i] + (logical - i) * (t[i + 1] - t[i])
  }

  x(time: number): number | null {
    return this.chart.timeScale().logicalToCoordinate(this.logical(time) as Logical)
  }

  y(price: number): number | null {
    return this.series.priceToCoordinate(price)
  }

  /** Pixel -> point, with time snapped to the nearest bar like TradingView. */
  point(x: number, y: number): Pt | null {
    const logical = this.chart.timeScale().coordinateToLogical(x)
    const price = this.series.coordinateToPrice(y)
    if (logical === null || price === null) return null
    return { time: this.timeAt(Math.round(logical)), price }
  }

  /** Shift a time by a number of bars. */
  shift(time: number, bars: number): number {
    return this.timeAt(Math.round(this.logical(time)) + bars)
  }

  barsBetween(fromX: number, toX: number): number {
    const a = this.chart.timeScale().coordinateToLogical(fromX)
    const b = this.chart.timeScale().coordinateToLogical(toX)
    return a === null || b === null ? 0 : Math.round(b) - Math.round(a)
  }

  /** Width of the plot area (excludes the price axis). */
  get width(): number {
    return this.chart.timeScale().width()
  }
}
