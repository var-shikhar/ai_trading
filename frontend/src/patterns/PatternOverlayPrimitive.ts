import type { CanvasRenderingTarget2D } from 'fancy-canvas'
import type { IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesPrimitive, SeriesAttachedParameter, Time } from 'lightweight-charts'
import type { ChartTheme } from '../chart/theme'
import type { Mapper } from '../drawings/mapper'
import { patternKey, type ChartPattern, type ChartPatternResult } from './chartPatterns'

export interface OverlayState {
  result: ChartPatternResult | null
  mapper: Mapper | null
  theme: ChartTheme
  showZones: boolean
  highlight: string | null // patternKey of the pattern picked in the list
}

const FONT = "11px -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif"

/** Draws detected chart patterns (outline, neckline/trendlines, target)
 * and support/resistance zones under the user's own drawings. */
export class PatternOverlayPrimitive implements ISeriesPrimitive<Time> {
  private requestUpdate: (() => void) | null = null
  private state: OverlayState

  constructor(state: OverlayState) {
    this.state = state
  }

  attached(param: SeriesAttachedParameter<Time>) {
    this.requestUpdate = param.requestUpdate
  }

  detached() {
    this.requestUpdate = null
  }

  setState(state: OverlayState) {
    this.state = state
    this.requestUpdate?.()
  }

  paneViews(): readonly IPrimitivePaneView[] {
    const state = this.state
    return [
      { zOrder: () => 'bottom', renderer: () => new ZonesRenderer(state) },
      { zOrder: () => 'normal', renderer: () => new PatternsRenderer(state) },
    ]
  }
}

const fmt = (v: number) => v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

interface Label {
  text: string
  x: number
  y: number // baseline-middle
  align: 'left' | 'center' | 'right'
  color: string
  alpha: number
}

const LABEL_H = 15
const PAD = 4

/** Draws labels on pills, moving each up or down until it doesn't overlap
 * one already placed (earlier labels win: pass the important ones first). */
function placeLabels(ctx: CanvasRenderingContext2D, labels: Label[], theme: ChartTheme) {
  const placed: { x1: number; x2: number; y1: number; y2: number }[] = []
  const hits = (x1: number, x2: number, y1: number, y2: number) =>
    placed.some((b) => x1 < b.x2 && x2 > b.x1 && y1 < b.y2 && y2 > b.y1)
  ctx.font = FONT
  ctx.textBaseline = 'middle'
  for (const l of labels) {
    const w = ctx.measureText(l.text).width + PAD * 2
    const x1 = l.align === 'left' ? l.x : l.align === 'right' ? l.x - w : l.x - w / 2
    // Try the spot, then alternately above and below it.
    let y = l.y
    for (let step = 1; step <= 12 && hits(x1, x1 + w, y - LABEL_H / 2, y + LABEL_H / 2); step++) {
      y = l.y + (step % 2 ? -1 : 1) * Math.ceil(step / 2) * (LABEL_H + 2)
    }
    placed.push({ x1, x2: x1 + w, y1: y - LABEL_H / 2, y2: y + LABEL_H / 2 })
    ctx.globalAlpha = 0.85 * l.alpha
    ctx.fillStyle = theme.surface
    ctx.beginPath()
    ctx.roundRect(x1, y - LABEL_H / 2, w, LABEL_H, 4)
    ctx.fill()
    ctx.globalAlpha = l.alpha
    ctx.fillStyle = l.color
    ctx.textAlign = 'left'
    ctx.fillText(l.text, x1 + PAD, y + 0.5)
  }
  ctx.globalAlpha = 1
}

function color(p: ChartPattern, theme: ChartTheme): string {
  return p.direction === 'bullish' ? theme.up : p.direction === 'bearish' ? theme.down : theme.series[0]
}

class ZonesRenderer implements IPrimitivePaneRenderer {
  private s: OverlayState
  constructor(s: OverlayState) {
    this.s = s
  }

  draw(target: CanvasRenderingTarget2D) {
    const { result, mapper, theme, showZones } = this.s
    if (!result || !mapper || !showZones) return
    target.useMediaCoordinateSpace(({ context: ctx }) => {
      const width = mapper.width
      ctx.font = FONT
      const labels: Label[] = []
      for (const z of result.zones) {
        const y1 = mapper.y(z.high)
        const y2 = mapper.y(z.low)
        if (y1 === null || y2 === null) continue
        const c = z.kind === 'support' ? theme.up : theme.down
        ctx.globalAlpha = Math.min(0.06 + z.touches * 0.025, 0.18)
        ctx.fillStyle = c
        ctx.fillRect(0, y1, width, Math.max(1, y2 - y1))
        ctx.globalAlpha = 1
        labels.push({
          text: `${z.kind === 'support' ? 'S' : 'R'} · ${z.touches} touches`,
          x: width - 6,
          y: y1 - LABEL_H / 2 - 1,
          align: 'right',
          color: c,
          alpha: 1,
        })
      }
      placeLabels(ctx, labels, theme)
    })
  }
}

class PatternsRenderer implements IPrimitivePaneRenderer {
  private s: OverlayState
  constructor(s: OverlayState) {
    this.s = s
  }

  draw(target: CanvasRenderingTarget2D) {
    const { result, mapper, theme, highlight } = this.s
    if (!result || !mapper) return
    target.useMediaCoordinateSpace(({ context: ctx }) => {
      ctx.font = FONT
      const labels: (Label & { first: boolean })[] = []
      for (const p of result.patterns) {
        const on = highlight === patternKey(p)
        const c = color(p, theme)
        const faded = p.status === 'failed'
        ctx.globalAlpha = faded ? 0.45 : on || highlight === null ? 1 : 0.55
        ctx.strokeStyle = c
        ctx.fillStyle = c

        // Outline through the swing points.
        ctx.lineWidth = on ? 2.5 : 1.5
        ctx.setLineDash([])
        ctx.beginPath()
        let started = false
        let lastX = 0
        let topY = Infinity
        for (const pt of p.points) {
          const x = mapper.x(pt.time)
          const y = mapper.y(pt.price)
          if (x === null || y === null) continue
          if (!started) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
          started = true
          lastX = x
          topY = Math.min(topY, y)
        }
        ctx.stroke()

        // Necklines / trendlines.
        ctx.setLineDash([5, 4])
        ctx.lineWidth = on ? 2 : 1.2
        for (const l of p.lines) {
          const x1 = mapper.x(l.from.time)
          const y1 = mapper.y(l.from.price)
          const x2 = mapper.x(l.to.time)
          const y2 = mapper.y(l.to.price)
          if (x1 === null || y1 === null || x2 === null || y2 === null) continue
          ctx.beginPath()
          ctx.moveTo(x1, y1)
          ctx.lineTo(x2, y2)
          ctx.stroke()
          lastX = Math.max(lastX, x2)
        }

        // Measured-move target, drawn ahead of the pattern's end.
        if (p.target !== null && p.status !== 'failed') {
          const y = mapper.y(p.target)
          const x = mapper.x(p.end_time)
          if (y !== null && x !== null) {
            ctx.setLineDash([2, 3])
            ctx.beginPath()
            ctx.moveTo(x, y)
            ctx.lineTo(x + 60, y)
            ctx.stroke()
            ctx.setLineDash([])
            labels.push({ text: `Target ${fmt(p.target)}`, x: x + 64, y, align: 'left', color: c, alpha: ctx.globalAlpha, first: on })
          }
        }

        // Name + status above the outline.
        if (started) {
          ctx.setLineDash([])
          const first = mapper.x(p.points[0].time) ?? lastX
          labels.push({
            text: `${p.name} · ${p.status}`,
            x: (first + lastX) / 2,
            y: topY - 6 - LABEL_H / 2,
            align: 'center',
            color: c,
            alpha: ctx.globalAlpha,
            first: on,
          })
        }
      }
      ctx.globalAlpha = 1
      ctx.setLineDash([])
      // The picked pattern's labels keep their spot; others move aside.
      placeLabels(ctx, [...labels.filter((l) => l.first), ...labels.filter((l) => !l.first)], theme)
    })
  }
}
