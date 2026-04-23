import { useState, type ReactNode } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'

interface RoadmapItem {
  title: string
  description: string
  date?: string // yyyy-mm, shown as tag on Shipped items
}

interface RoadmapColumn {
  title: string
  description: string
  accentColor: string
  items: RoadmapItem[]
}

const INITIAL_VISIBLE_COUNT = 7

const ROADMAP: RoadmapColumn[] = [
  {
    title: 'Backlog',
    description: 'Planned work we intend to build.',
    accentColor: 'border-t-gray-300',
    items: [
      {
        title: 'AI auto-complete',
        description: 'Inline completions while writing notes and prompt templates.',
      },
      {
        title: 'AI chat',
        description: 'Conversational interface for searching and managing content.',
      },
      {
        title: 'OAuth for MCP',
        description: 'Connect MCP clients like ChatGPT without personal access tokens.',
      },
      {
        title: 'Data export',
        description: 'Export all your content in standard formats.',
      },
      {
        title: 'Safari extension',
        description: 'Save and search bookmarks directly from Safari.',
      },
      {
        title: 'Image support',
        description: 'Attach images to bookmarks and notes.',
      },
      {
        title: 'Multi-select actions',
        description: 'Bulk tag, archive, or delete multiple items at once.',
      },
      {
        title: 'Content encryption',
        description: 'End-to-end encryption for sensitive content.',
      },
    ],
  },
  {
    title: 'In Progress',
    description: 'Actively being built.',
    accentColor: 'border-t-amber-500',
    items: [
      {
        title: 'Semantic search',
        description: 'Vector-based search using embeddings for meaning-aware content discovery.',
      },
      {
        title: 'Mobile app',
        description: 'Native mobile experience backed by the existing API.',
      },
    ],
  },
  {
    title: 'Shipped',
    description: 'Recently launched.',
    accentColor: 'border-t-green-500',
    items: [
      {
        title: 'AI-powered suggestions',
        description: 'Tag, metadata, relationship, and prompt argument suggestions powered by AI. Includes BYOK support and per-use-case configuration.',
        date: '2026-04',
      },
      {
        title: 'Tiddly CLI',
        description: 'Command-line tool for configuring MCP servers and syncing agent skills.',
        date: '2026-03',
      },
      {
        title: 'Public docs site',
        description: 'AI integration guides, content types, search, versioning, and keyboard shortcuts.',
        date: '2026-03',
      },
      {
        title: 'Keyboard navigation',
        description: 'Arrow keys to navigate content lists, Enter to open.',
        date: '2026-03',
      },
      {
        title: 'PAT rename',
        description: 'Rename Personal Access Tokens from the settings page.',
        date: '2026-03',
      },
      {
        title: 'Chrome extension',
        description: 'Save and search bookmarks from any page.',
        date: '2026-02',
      },
      {
        title: 'Content versioning',
        description: 'Full history with diffs and one-click restore.',
        date: '2026-02',
      },
      {
        title: 'Full-text search',
        description: 'Search across all content with command palette.',
        date: '2026-02',
      },
      {
        title: 'Content relationships',
        description: 'Link related bookmarks, notes, and prompts together.',
        date: '2026-02',
      },
      {
        title: 'Keyboard shortcuts & command palette',
        description: 'Slash commands, editor palette, and global shortcuts.',
        date: '2026-02',
      },
      {
        title: 'Rich markdown editor',
        description: 'WYSIWYG editing with syntax highlighting and keyboard shortcuts.',
        date: '2026-01',
      },
      {
        title: 'Filters & Collections',
        description: 'Saved tag-based views for organizing content.',
        date: '2026-01',
      },
      {
        title: 'Agent Skills export',
        description: 'Export prompts for Claude Code, Claude Desktop, and Codex.',
        date: '2026-01',
      },
      {
        title: 'MCP integration',
        description: 'AI assistant access to bookmarks, notes, and prompts.',
        date: '2025-12',
      },
      {
        title: 'First commit',
        description: 'Bookmarks, notes, prompt templates, tags, and API access.',
        date: '2025-12',
      },
    ],
  },
]

const IDEAS: RoadmapItem[] = [
  {
    title: 'Chrome extension editing',
    description: 'Edit bookmarks and notes directly from the extension popup.',
  },
  {
    title: 'Integrations',
    description: 'Google Docs, Confluence, and other third-party connections.',
  },
]

function RoadmapColumnCard({ column }: { column: RoadmapColumn }): ReactNode {
  const [expanded, setExpanded] = useState(false)
  const hasMore = column.items.length > INITIAL_VISIBLE_COUNT
  const visibleItems = expanded ? column.items : column.items.slice(0, INITIAL_VISIBLE_COUNT)

  return (
    <div className={`rounded-xl border border-gray-200 border-t-4 ${column.accentColor}`}>
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
        {IDEAS.map((item) => (
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
        {ROADMAP.map((column) => (
          <RoadmapColumnCard key={column.title} column={column} />
        ))}
      </div>

      <IdeasSection />
    </div>
  )
}
