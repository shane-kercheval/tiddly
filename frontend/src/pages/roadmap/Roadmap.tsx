import { useState, type ReactNode } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'
import { ROADMAP, type RoadmapColumn } from '../../content/data/roadmap'

const INITIAL_VISIBLE_COUNT = 7

// Presentation only: per-column top-border accent. Keys MUST match the column
// `title`s in roadmap.json — an unmapped title falls back to gray silently (a
// rename there drops the accent, not the column), so keep these in sync.
const COLUMN_ACCENT_COLORS: Record<string, string> = {
  Backlog: 'border-t-gray-300',
  'In Progress': 'border-t-amber-500',
  Shipped: 'border-t-green-500',
}

function RoadmapColumnCard({ column }: { column: RoadmapColumn }): ReactNode {
  const [expanded, setExpanded] = useState(false)
  const hasMore = column.items.length > INITIAL_VISIBLE_COUNT
  const visibleItems = expanded ? column.items : column.items.slice(0, INITIAL_VISIBLE_COUNT)
  const accentColor = COLUMN_ACCENT_COLORS[column.title] ?? 'border-t-gray-300'

  return (
    <div className={`rounded-xl border border-gray-200 border-t-4 ${accentColor}`}>
      <div className="p-6">
        <h2 className="text-lg font-bold text-gray-900">{column.title}</h2>
        <p className="mt-1 text-sm text-gray-500">{column.description}</p>
      </div>
      <div className="space-y-3 px-6 pb-4">
        {visibleItems.map((item) => (
          <div key={item.title} className="rounded-lg bg-gray-50 p-4">
            <h3 className="text-sm font-semibold text-gray-900">{item.title}</h3>
            <p className="mt-1 text-sm text-gray-600">{item.description}</p>
            {item.date && (
              <span className="mt-2 inline-block rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-500">
                {item.date}
              </span>
            )}
          </div>
        ))}
        {hasMore && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="w-full rounded-lg border border-gray-200 py-1 text-xs text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors"
          >
            {expanded
              ? 'Show less'
              : `View ${column.items.length - INITIAL_VISIBLE_COUNT} more`}
          </button>
        )}
      </div>
    </div>
  )
}

function IdeasSection(): ReactNode {
  return (
    <div className="mt-8 rounded-xl border border-gray-200 border-t-4 border-t-violet-400">
      <div className="p-6">
        <h2 className="text-lg font-bold text-gray-900">Ideas</h2>
        <p className="mt-1 text-sm text-gray-500">
          Things we're considering. These may evolve, merge, or never happen.
        </p>
      </div>
      <div className="grid gap-3 px-6 pb-6 sm:grid-cols-2">
        {ROADMAP.ideas.map((item) => (
          <div key={item.title} className="rounded-lg bg-gray-50 p-4">
            <h3 className="text-sm font-semibold text-gray-900">{item.title}</h3>
            <p className="mt-1 text-sm text-gray-600">{item.description}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

export function Roadmap(): ReactNode {
  usePageTitle('Roadmap')

  return (
    <div>
      <div className="pb-12 text-center">
        <h1 className="text-3xl font-bold text-gray-900">Roadmap</h1>
        <p className="mt-3 text-gray-500">
          What we're working on and what's coming next.
        </p>
        <p className="mt-1 text-sm text-gray-400">
          Priorities may shift.
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-3">
        {ROADMAP.columns.map((column) => (
          <RoadmapColumnCard key={column.title} column={column} />
        ))}
      </div>

      <IdeasSection />
    </div>
  )
}
