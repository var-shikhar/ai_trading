import type { CanvasRenderingTarget2D } from 'fancy-canvas'
import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  ISeriesPrimitiveAxisView,
  SeriesAttachedParameter,
  Time,
} from 'lightweight-charts'
import { resolveColor, type ChartTheme } from '../chart/theme'
import type { Mapper } from './mapper'
import type { Drawing, Position } from './types'

export interface DrawingsState {
  drawings: Drawing[]
  draft: Drawing | null // being placed
  selectedId: string | null
  hoverId: string | null
  mapper: Mapper | null
  theme: ChartTheme
}

const FONT = "12px -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif"
const HANDLE_R = 5

/** Renders every drawing on the price pane (one primitive for all). */
export class DrawingsPrimitive implements ISeriesPrimitive<Time> {
  private requestUpdate: (() => void) | null = null
  state: DrawingsState

  constructor(state: DrawingsState) {
    this.state = state
  }

  attached(param: SeriesAttachedParameter<Time>) {
    this.requestUpdate = param.requestUpdate
  }

  detached() {
    this.requestUpdate = null
  }

  setState(state: DrawingsState) {
    this.state = state
    this.requestUpdate?.()
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [{ zOrder: () => 'top', renderer: () => new Renderer(this.state) }]
  }

  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    const { mapper, theme } = this.state
    if (!mapper) return []
    const views: ISeriesPrimitiveAxisView[] = []
    for (const d of all(this.state)) {
      if (d.type === 'hline') {
        const y = mapper.y(d.price)
        const color = resolveColor(d.color, theme)
        if (y !== null) views.push(axisLabel(y, fmt(d.price), color))
      } else if ((d.type === 'long' || d.type === 'short') && d.id === this.state.selectedId) {
        for (const [price, color] of [
          [d.entry.price, theme.muted],
          [d.target, theme.up],
          [d.stop, theme.down],
        ] as const) {
          const y = mapper.y(price)
          if (y !== null) views.push(axisLabel(y, fmt(price), color))
        }
      }
    }
    return views
  }
}

function all(s: DrawingsState): Drawing[] {
  return s.draft ? [...s.drawings, s.draft] : s.drawings
}

function axisLabel(y: number, text: string, color: string): ISeriesPrimitiveAxisView {
  return { coordinate: () => y, text: () => text, textColor: () => '#ffffff', backColor: () => color }
}

const fmt = (v: number) => v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

class Renderer implements IPrimitivePaneRenderer {
  private s: DrawingsState

  constructor(s: DrawingsState) {
    this.s = s
  }

  draw(target: CanvasRenderingTarget2D) {
    const { mapper } = this.s
    if (!mapper) return
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      ctx.save()
      ctx.font = FONT
      for (const d of all(this.s)) {
        const active = d.id === this.s.selectedId || d === this.s.draft
        const hover = d.id === this.s.hoverId
        this.drawOne(ctx, d, mapper, mediaSize.width, mediaSize.height, active, hover)
      }
      ctx.restore()
    })
  }

  private drawOne(
    ctx: CanvasRenderingContext2D,
    d: Drawing,
    m: Mapper,
    width: number,
    height: number,
    active: boolean,
    hover: boolean,
  ) {
    const theme = this.s.theme
    const color = resolveColor(d.color, theme)
    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.lineWidth = hover || active ? 2.5 : 2
    const handles: [number, number][] = []

    switch (d.type) {
      case 'trend': {
        const ax = m.x(d.a.time)
        const ay = m.y(d.a.price)
        const bx = m.x(d.b.time)
        const by = m.y(d.b.price)
        if (ax === null || ay === null || bx === null || by === null) return
        line(ctx, ax, ay, bx, by)
        handles.push([ax, ay], [bx, by])
        break
      }
      case 'hline': {
        const y = m.y(d.price)
        if (y === null) return
        line(ctx, 0, y, width, y)
        handles.push([width / 2, y])
        break
      }
      case 'vline': {
        const x = m.x(d.time)
        if (x === null) return
        line(ctx, x, 0, x, height)
        handles.push([x, height / 2])
        break
      }
      case 'rect': {
        const ax = m.x(d.a.time)
        const ay = m.y(d.a.price)
        const bx = m.x(d.b.time)
        const by = m.y(d.b.price)
        if (ax === null || ay === null || bx === null || by === null) return
        ctx.globalAlpha = 0.15
        ctx.fillRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay))
        ctx.globalAlpha = 1
        ctx.lineWidth = hover || active ? 2 : 1.5
        ctx.strokeRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay))
        handles.push([ax, ay], [bx, by], [ax, by], [bx, ay])
        break
      }
      case 'long':
      case 'short':
        this.drawPosition(ctx, d, m, active || hover, handles)
        break
    }

    if (active) {
      for (const [x, y] of handles) {
        ctx.beginPath()
        ctx.arc(x, y, HANDLE_R, 0, Math.PI * 2)
        ctx.fillStyle = theme.surface
        ctx.fill()
        ctx.lineWidth = 1.5
        ctx.strokeStyle = d.type === 'long' || d.type === 'short' ? theme.muted : color
        ctx.stroke()
      }
    }
  }

  private drawPosition(
    ctx: CanvasRenderingContext2D,
    d: Position,
    m: Mapper,
    showLabels: boolean,
    handles: [number, number][],
  ) {
    const theme = this.s.theme
    const x1 = m.x(d.entry.time)
    const x2 = m.x(d.endTime)
    const ye = m.y(d.entry.price)
    const yt = m.y(d.target)
    const ys = m.y(d.stop)
    if (x1 === null || x2 === null || ye === null || yt === null || ys === null) return
    const left = Math.min(x1, x2)
    const w = Math.abs(x2 - x1)

    ctx.globalAlpha = 0.22
    ctx.fillStyle = theme.up
    ctx.fillRect(left, Math.min(ye, yt), w, Math.abs(yt - ye))
    ctx.fillStyle = theme.down
    ctx.fillRect(left, Math.min(ye, ys), w, Math.abs(ys - ye))
    ctx.globalAlpha = 1
    ctx.lineWidth = 1
    ctx.strokeStyle = theme.muted
    line(ctx, left, ye, left + w, ye)

    const entry = d.entry.price
    const reward = Math.abs(d.target - entry)
    const risk = Math.abs(entry - d.stop)
    const rr = risk > 0 ? reward / risk : 0
    const pct = (p: number) => ((Math.abs(p - entry) / entry) * 100).toFixed(2)
    const cx = left + w / 2
    const above = (a: number, b: number) => Math.min(a, b) - 4
    const below = (a: number, b: number) => Math.max(a, b) + 4
    // Target label sits beyond the target edge, stop label beyond the stop edge.
    const targetY = d.type === 'long' ? above(ye, yt) : below(ye, yt)
    const stopY = d.type === 'long' ? below(ye, ys) : above(ye, ys)
    label(ctx, cx, targetY, `Target: ${fmt(d.target)} (${pct(d.target)}%)`, theme.up, d.type === 'long' ? 'bottom' : 'top')
    label(ctx, cx, stopY, `Stop: ${fmt(d.stop)} (${pct(d.stop)}%)`, theme.down, d.type === 'long' ? 'top' : 'bottom')
    if (showLabels) {
      label(ctx, cx, ye, `${d.type === 'long' ? 'Long' : 'Short'} · R:R ${rr.toFixed(2)}`, theme.muted, 'middle')
    }
    handles.push([left, ye], [left + w, ye], [left, yt], [left, ys])
  }
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()
}

function label(
  ctx: CanvasRenderingContext2D,
  cx: number,
  y: number,
  text: string,
  bg: string,
  anchor: 'top' | 'bottom' | 'middle',
) {
  const padX = 6
  const h = 20
  const w = ctx.measureText(text).width + padX * 2
  const top = anchor === 'bottom' ? y - h : anchor === 'top' ? y : y - h / 2
  ctx.fillStyle = bg
  roundRect(ctx, cx - w / 2, top, w, h, 3)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, cx, top + h / 2 + 0.5)
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
