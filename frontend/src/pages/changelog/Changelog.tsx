import type { ReactNode } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'

interface ChangelogEntry {
  title: string
  description: string
}

interface ChangelogCategory {
  label: string
  emoji: string
  entries: ChangelogEntry[]
}

interface ChangelogMonth {
  month: string
  theme: string
  categories: ChangelogCategory[]
}

const CHANGELOG: ChangelogMonth[] = [
  {
    month: 'March 2026',
    theme: 'Documentation & Polish',
    categories: [
      {
        label: 'New',
        emoji: '🚀',
        entries: [
          {
            title: 'Public docs site',
            description:
              'Sidebar navigation, AI integration guides, content types, search, versioning, and keyboard shortcuts.',
          },
          {
            title: 'Features page',
            description: 'Animated demos showcasing core capabilities.',
          },
          {
            title: 'Pricing page',
            description: 'Free and Pro tier comparison with full feature breakdown.',
          },
        ],
      },
      {
        label: 'Improved',
        emoji: '✨',
        entries: [
          {
            title: 'Page load performance',
            description:
              'Route-level code splitting, CORS preflight caching, and proper static asset cache headers. Faster cold loads and repeat navigations skip network round-trips entirely.',
          },
          {
            title: 'Smarter data fetching',
            description:
              'Filter views no longer fire a redundant API call before filters load. User limits are prefetched at the layout level so detail pages render without a sequential waterfall.',
          },
          {
            title: 'Landing page animations',
            description: 'Scroll-triggered animations for a smoother first impression.',
          },
          {
            title: 'Chrome extension UI',
            description: 'Visual polish and consistency improvements.',
          },
        ],
      },
    ],
  },
  {
    month: 'February 2026',
    theme: 'Extensions, Versioning & Search',
    categories: [
      {
        label: 'New',
        emoji: '🚀',
        entries: [
          {
            title: 'Chrome extension',
            description: 'Save and search bookmarks from any page.',
          },
          {
            title: 'Content versioning',
            description: 'Full history with diffs and one-click restore.',
          },
          {
            title: 'Full-text search with command palette',
            description: 'Press Cmd+Shift+P to search across all content.',
          },
          {
            title: 'Content relationships',
            description: 'Link related bookmarks, notes, and prompts together.',
          },
          {
            title: 'Table of contents sidebar',
            description: 'Auto-generated heading navigation for long documents.',
          },
          {
            title: 'Slash command menu & editor command palette',
            description: 'Type / for block commands or Cmd+/ for editor actions.',
          },
          {
            title: 'Jinja2 syntax highlighting',
            description: 'Template variables and blocks are highlighted in the editor.',
          },
        ],
      },
      {
        label: 'Improved',
        emoji: '✨',
        entries: [
          {
            title: 'MCP eval framework',
            description: 'Better testing and validation for MCP tool integrations.',
          },
          {
            title: 'Multi-value view search',
            description: 'Search across multiple fields with archive relevance.',
          },
          {
            title: 'UI density and consistency',
            description: 'Tighter spacing and unified component styles throughout the app.',
          },
        ],
      },
    ],
  },
  {
    month: 'January 2026',
    theme: 'AI Tools, Editor & Foundations',
    categories: [
      {
        label: 'New',
        emoji: '🚀',
        entries: [
          {
            title: 'Tier-based usage limits',
            description: 'Free and Pro tiers with clear content and API limits.',
          },
          {
            title: 'Agent Skills export',
            description: 'Export prompts for Claude Code, Claude Desktop, and Codex.',
          },
          {
            title: 'WYSIWYG markdown editor',
            description: 'Rich editing with syntax highlighting and keyboard shortcuts.',
          },
          {
            title: 'Prompt template preview',
            description: 'Render Jinja2 templates with sample data before saving.',
          },
          {
            title: 'Filters & Collections',
            description: 'Saved tag-based boolean filters for organizing content.',
          },
        ],
      },
      {
        label: 'Improved',
        emoji: '✨',
        entries: [
          {
            title: 'MCP context endpoints and update tools',
            description: 'Richer context and more capable editing via MCP.',
          },
          {
            title: 'HTTP caching',
            description: 'ETag and Last-Modified support for faster responses.',
          },
          {
            title: 'Multi-tab change detection',
            description: 'Optimistic locking prevents overwriting edits from other tabs.',
          },
          {
            title: 'Content editing API and MCP tools',
            description: 'Programmatic content updates via API and MCP.',
          },
          {
            title: 'UUIDv7 primary keys',
            description: 'Time-sortable IDs for better database performance.',
          },
        ],
      },
    ],
  },
  {
    month: 'December 2025',
    theme: 'Initial Commits',
    categories: [
      {
        label: 'New',
        emoji: '🚀',
        entries: [
          {
            title: 'Bookmarks',
            description: 'Save URLs with auto-scraped metadata, personal notes, and tags.',
          },
          {
            title: 'Notes',
            description: 'Freeform markdown documents with tags.',
          },
          {
            title: 'Prompt templates',
            description: 'Jinja2 templates with named arguments for AI workflows.',
          },
          {
            title: 'Tags & organization',
            description: 'Global tagging system across all content types.',
          },
          {
            title: 'MCP integration',
            description: 'Two MCP servers for AI assistant access to all content.',
          },
          {
            title: 'API & Personal Access Tokens',
            description: 'Programmatic access via REST API with PAT authentication.',
          },
        ],
      },
    ],
  },
]

function MonthSection({
  month,
  isFirst,
}: {
  month: ChangelogMonth
  isFirst: boolean
}): ReactNode {
  return (
    <section className={isFirst ? '' : 'mt-10 border-t border-gray-200 pt-10'}>
      <h2 className="text-2xl font-bold text-gray-900">{month.month}</h2>
      <p className="mt-1 text-sm italic text-gray-500">{month.theme}</p>

      {month.categories.map((category) => (
        <div key={category.label} className="mt-6">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-400">
            {category.emoji} {category.label}
          </h3>
          <ul className="mt-3 space-y-2">
            {category.entries.map((entry) => (
              <li key={entry.title} className="text-sm text-gray-600">
                <span className="font-semibold text-gray-900">{entry.title}</span>
                {' — '}
                {entry.description}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}

export function Changelog(): ReactNode {
  usePageTitle('Changelog')

  return (
    <div>
      <div className="pb-12 text-center">
        <h1 className="text-3xl font-bold text-gray-900">Changelog</h1>
        <p className="mt-3 text-gray-500">New features, improvements, and fixes.</p>
      </div>

      {CHANGELOG.map((month, i) => (
        <MonthSection key={month.month} month={month} isFirst={i === 0} />
      ))}
    </div>
  )
}
