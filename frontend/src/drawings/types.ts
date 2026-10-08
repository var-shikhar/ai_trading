export type DrawingTool = 'cursor' | 'trend' | 'hline' | 'vline' | 'rect' | 'long' | 'short'

/** A chart point: bar time (IST wall time as UTC epoch) and price. */
export interface Pt {
  time: number
  price: number
}

interface Base {
  id: string
  color: string // color token (see resolveColor) or '#rrggbb'
}

export type TrendLine = Base & { type: 'trend'; a: Pt; b: Pt }
export type HorizontalLine = Base & { type: 'hline'; price: number }
export type VerticalLine = Base & { type: 'vline'; time: number }
export type Rectangle = Base & { type: 'rect'; a: Pt; b: Pt }
/** Long/short position: entry point, right edge, target and stop prices. */
export type Position = Base & { type: 'long' | 'short'; entry: Pt; endTime: number; target: number; stop: number }

export type Drawing = TrendLine | HorizontalLine | VerticalLine | Rectangle | Position

/** Which part of a drawing is being dragged. */
export type Handle = 'body' | 'a' | 'b' | 'ab' | 'ba' | 'entry' | 'end' | 'target' | 'stop'

export const TOOL_NAMES: Record<DrawingTool, string> = {
  cursor: 'Cursor',
  trend: 'Trend line',
  hline: 'Horizontal line',
  vline: 'Vertical line',
  rect: 'Rectangle',
  long: 'Long position',
  short: 'Short position',
}

let counter = 0
export function drawingId(): string {
  counter += 1
  return `d${Date.now().toString(36)}${counter.toString(36)}`
}
