import type { Mapper } from './mapper'
import type { Drawing, Handle, Pt } from './types'

const TOLERANCE = 6 // px
const HANDLE_TOLERANCE = 8

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

const near = (x: number, y: number, hx: number | null, hy: number | null) =>
  hx !== null && hy !== null && Math.hypot(x - hx, y - hy) <= HANDLE_TOLERANCE

/** What part of `d` is at pixel (x, y), if any. Handles are only offered for
 * the selected drawing (they're only drawn then). */
export function hitTest(d: Drawing, x: number, y: number, m: Mapper, selected: boolean): Handle | null {
  switch (d.type) {
    case 'trend':
    case 'rect': {
      const ax = m.x(d.a.time)
      const ay = m.y(d.a.price)
      const bx = m.x(d.b.time)
      const by = m.y(d.b.price)
      if (ax === null || ay === null || bx === null || by === null) return null
      if (selected) {
        if (near(x, y, ax, ay)) return 'a'
        if (near(x, y, bx, by)) return 'b'
        if (d.type === 'rect') {
          if (near(x, y, ax, by)) return 'ab'
          if (near(x, y, bx, ay)) return 'ba'
        }
      }
      if (d.type === 'trend') return distToSegment(x, y, ax, ay, bx, by) <= TOLERANCE ? 'body' : null
      const inside =
        x >= Math.min(ax, bx) - TOLERANCE &&
        x <= Math.max(ax, bx) + TOLERANCE &&
        y >= Math.min(ay, by) - TOLERANCE &&
        y <= Math.max(ay, by) + TOLERANCE
      return inside ? 'body' : null
    }
    case 'hline': {
      const hy = m.y(d.price)
      return hy !== null && Math.abs(y - hy) <= TOLERANCE ? 'body' : null
    }
    case 'vline': {
      const hx = m.x(d.time)
      return hx !== null && Math.abs(x - hx) <= TOLERANCE ? 'body' : null
    }
    case 'long':
    case 'short': {
      const x1 = m.x(d.entry.time)
      const x2 = m.x(d.endTime)
      const ye = m.y(d.entry.price)
      const yt = m.y(d.target)
      const ys = m.y(d.stop)
      if (x1 === null || x2 === null || ye === null || yt === null || ys === null) return null
      const left = Math.min(x1, x2)
      const right = Math.max(x1, x2)
      if (selected) {
        if (near(x, y, left, ye)) return 'entry'
        if (near(x, y, right, ye)) return 'end'
        if (near(x, y, left, yt)) return 'target'
        if (near(x, y, left, ys)) return 'stop'
      }
      const top = Math.min(ye, yt, ys)
      const bottom = Math.max(ye, yt, ys)
      return x >= left && x <= right && y >= top && y <= bottom ? 'body' : null
    }
  }
}

/** Topmost drawing under the pointer (selected one gets first pick so its
 * handles win over overlapping drawings). */
export function findHit(
  drawings: Drawing[],
  selectedId: string | null,
  x: number,
  y: number,
  m: Mapper,
): { id: string; handle: Handle } | null {
  const selected = drawings.find((d) => d.id === selectedId)
  if (selected) {
    const h = hitTest(selected, x, y, m, true)
    if (h) return { id: selected.id, handle: h }
  }
  for (let i = drawings.length - 1; i >= 0; i--) {
    const h = hitTest(drawings[i], x, y, m, false)
    if (h) return { id: drawings[i].id, handle: h }
  }
  return null
}

/** Apply a drag of `bars` bars and `dPrice` (or move to `to` for point
 * handles) to the drawing as it was when the drag started. */
export function applyDrag(orig: Drawing, handle: Handle, to: Pt, bars: number, dPrice: number, m: Mapper): Drawing {
  const move = (p: Pt): Pt => ({ time: m.shift(p.time, bars), price: p.price + dPrice })
  switch (orig.type) {
    case 'trend':
    case 'rect':
      if (handle === 'a') return { ...orig, a: to }
      if (handle === 'b') return { ...orig, b: to }
      if (handle === 'ab') return { ...orig, a: { ...orig.a, time: to.time }, b: { ...orig.b, price: to.price } }
      if (handle === 'ba') return { ...orig, b: { ...orig.b, time: to.time }, a: { ...orig.a, price: to.price } }
      return { ...orig, a: move(orig.a), b: move(orig.b) }
    case 'hline':
      return { ...orig, price: orig.price + dPrice }
    case 'vline':
      return { ...orig, time: m.shift(orig.time, bars) }
    case 'long':
    case 'short': {
      if (handle === 'entry') return { ...orig, entry: { time: to.time, price: to.price } }
      if (handle === 'end') return { ...orig, endTime: to.time }
      if (handle === 'target') return { ...orig, target: to.price }
      if (handle === 'stop') return { ...orig, stop: to.price }
      return {
        ...orig,
        entry: move(orig.entry),
        endTime: m.shift(orig.endTime, bars),
        target: orig.target + dPrice,
        stop: orig.stop + dPrice,
      }
    }
  }
}

export function cursorFor(handle: Handle | null, d: Drawing | undefined): string {
  if (!handle || !d) return ''
  if (handle !== 'body') return d.type === 'long' || d.type === 'short' ? (handle === 'end' ? 'ew-resize' : 'ns-resize') : 'pointer'
  if (d.type === 'hline') return 'ns-resize'
  if (d.type === 'vline') return 'ew-resize'
  return 'move'
}
