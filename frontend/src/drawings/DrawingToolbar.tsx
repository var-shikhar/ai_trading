import { cx } from '../ui/kit'
import { TOOL_NAMES, type DrawingTool } from './types'

const TOOLS: DrawingTool[] = ['cursor', 'trend', 'hline', 'vline', 'rect', 'long', 'short']

/** Tool column on the chart's left edge, like TradingView's; on phones a
 * floating card over the chart (shown by the pencil). Alt+T/H/V/R pick tools. */
export function DrawingToolbar({
  tool,
  onTool,
  onClearAll,
  hasDrawings,
  floating = false,
}: {
  tool: DrawingTool
  onTool: (t: DrawingTool) => void
  onClearAll: () => void
  hasDrawings: boolean
  floating?: boolean
}) {
  const btn = (selected: boolean) =>
    cx(
      'inline-flex size-9 items-center justify-center rounded-lg transition disabled:opacity-35',
      selected ? 'bg-selected text-accent' : 'text-fg hover:bg-hover',
    )
  return (
    <nav
      aria-label="Drawing tools"
      className={cx(
        'flex flex-col items-center gap-0.5 bg-surface py-1.5',
        floating ? 'w-11 rounded-xl border border-line shadow-[var(--shadow)]' : 'w-12 shrink-0 border-r border-line',
      )}
    >
      {TOOLS.map((t) => (
        <button
          key={t}
          className={btn(tool === t)}
          title={`${TOOL_NAMES[t]}${SHORTCUTS[t] ? ` (${SHORTCUTS[t]})` : ''}`}
          aria-label={TOOL_NAMES[t]}
          aria-pressed={tool === t}
          onClick={() => onTool(t)}
        >
          <ToolIcon tool={t} />
        </button>
      ))}
      <span className="my-1 h-px w-7 bg-line" />
      <button
        className={btn(false)}
        title="Remove all drawings on this symbol"
        aria-label="Remove all drawings on this symbol"
        disabled={!hasDrawings}
        onClick={() => {
          if (window.confirm('Remove all drawings on this symbol?')) onClearAll()
        }}
      >
        <svg {...icon}>
          <path d="M4 6h12M8 6V4h4v2M6 6l1 11h6l1-11" />
        </svg>
      </button>
    </nav>
  )
}

export const SHORTCUTS: Partial<Record<DrawingTool, string>> = {
  trend: 'Alt+T',
  hline: 'Alt+H',
  vline: 'Alt+V',
  rect: 'Alt+R',
}

const icon = {
  width: 20,
  height: 20,
  viewBox: '0 0 20 20',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round' as const,
  'aria-hidden': true,
}

function ToolIcon({ tool }: { tool: DrawingTool }) {
  switch (tool) {
    case 'cursor':
      return (
        <svg {...icon}>
          <path d="M10 3v14M3 10h14" />
        </svg>
      )
    case 'trend':
      return (
        <svg {...icon}>
          <path d="M4 16L16 4" />
          <circle cx="4" cy="16" r="1.6" fill="currentColor" />
          <circle cx="16" cy="4" r="1.6" fill="currentColor" />
        </svg>
      )
    case 'hline':
      return (
        <svg {...icon}>
          <path d="M2 10h16" />
          <circle cx="10" cy="10" r="1.6" fill="currentColor" />
        </svg>
      )
    case 'vline':
      return (
        <svg {...icon}>
          <path d="M10 2v16" />
          <circle cx="10" cy="10" r="1.6" fill="currentColor" />
        </svg>
      )
    case 'rect':
      return (
        <svg {...icon}>
          <rect x="3.5" y="5.5" width="13" height="9" rx="0.5" />
        </svg>
      )
    case 'long':
      return (
        <svg {...icon}>
          <rect x="3.5" y="3.5" width="13" height="7" fill="currentColor" fillOpacity=".18" />
          <rect x="3.5" y="10.5" width="13" height="5" />
          <path d="M7 8l3-3 3 3" />
        </svg>
      )
    case 'short':
      return (
        <svg {...icon}>
          <rect x="3.5" y="4.5" width="13" height="5" />
          <rect x="3.5" y="9.5" width="13" height="7" fill="currentColor" fillOpacity=".18" />
          <path d="M7 12l3 3 3-3" />
        </svg>
      )
  }
}
