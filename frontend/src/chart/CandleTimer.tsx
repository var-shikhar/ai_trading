import { useEffect, useState } from 'react'
import type { IChartApi, ISeriesApi, SeriesType } from 'lightweight-charts'
import { IST_OFFSET, formatCountdown, secondsToClose, type Session } from './candleClose'

/** Countdown to the close of the forming candle, under the last price on the
 * price axis (as in TradingView). Shown only while live prices stream. */
export function CandleTimer({
  chart,
  series,
  price,
  tf,
  session,
  color,
}: {
  chart: IChartApi
  series: ISeriesApi<SeriesType>
  price: number
  tf: string
  session: Session
  color: string
}) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000) + IST_OFFSET)
  // Each second for the countdown; it also re-places the label as the chart moves.
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000) + IST_OFFSET), 1000)
    return () => clearInterval(id)
  }, [])
  const left = secondsToClose(tf, now, session)
  const y = series.priceToCoordinate(price)
  const pane = chart.panes()[0]?.getHeight() ?? 0
  if (left === null || y === null || y < 0 || y > pane - 12) return null
  return (
    <div
      className="candle-timer"
      style={{ top: y + 11, width: chart.priceScale('right').width(), background: color }}
      title="Time left in this candle"
    >
      {formatCountdown(left)}
    </div>
  )
}
