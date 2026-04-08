import type { ReactNode } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'

type ChangelogTag = 'web' | 'api' | 'cli' | 'extension' | 'site' | 'performance' | 'ai'

const tagConfig: Record<ChangelogTag, { label: string; className: string }> = {
  web: { label: 'Web', className: 'bg-blue-50 text-blue-600 border-blue-200' },
  api: { label: 'API', className: 'bg-purple-50 text-purple-600 border-purple-200' },
  cli: { label: 'CLI', className: 'bg-emerald-50 text-emerald-600 border-emerald-200' },
  extension: { label: 'Extension', className: 'bg-orange-50 text-orange-600 border-orange-200' },
  site: { label: 'Site', className: 'bg-cyan-50 text-cyan-600 border-cyan-200' },
  performance: { label: 'Performance', className: 'bg-amber-50 text-amber-600 border-amber-200' },
  ai: { label: 'AI', className: 'bg-pink-50 text-pink-600 border-pink-200' },
}

function TagBadge({ tag }: { tag: ChangelogTag }): ReactNode {
  const config = tagConfig[tag]
  return (
    <span className={`inline-block text-[10px] font-medium px-1.5 py-0 rounded-full border ${config.className}`}>
      {config.label}
    </span>
  )
}

interface ChangelogEntry {
  title: string
  description: string
  pr?: number
  tag?: ChangelogTag
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
    month: 'April 2026',
    theme: 'AI-Powered Suggestions',
    categories: [
      {
        label: 'New',
        emoji: '🚀',
        entries: [
          {
            title: 'AI tag suggestions',
            description: 'Open the tag input to get AI-suggested tags based on your content. Click to add.',
            tag: 'ai',
          },
          {
            title: 'AI metadata suggestions',
            description: 'Sparkle icons on title and description fields generate suggestions from your content.',
            tag: 'ai',
          },
          {
            title: 'AI relationship suggestions',
            description: 'Open the link input to get suggestions for related bookmarks, notes, and prompts.',
            tag: 'ai',
          },
          {
            title: 'AI prompt argument suggestions',
            description: 'Generate prompt arguments from template placeholders, or suggest names and descriptions for individual arguments.',
            tag: 'ai',
          },
        ],
      },
      {
        label: 'Improved',
        emoji: '✨',
        entries: [
          {
            title: 'Collapsible sidebar settings',
            description: 'Settings section in the sidebar is now collapsible with persisted state.',
            tag: 'web',
          },
          {
            title: 'Docs link in sidebar',
            description: 'Quick access to documentation from the sidebar settings section.',
            tag: 'web',
          },
        ],
      },
    ],
  },
  {
    month: 'March 2026',
    theme: 'CLI, Extensions, & Polish',
    categories: [
      {
        label: 'New',
        emoji: '🚀',
        entries: [
          {
            title: 'Tiddly CLI',
            description: 'Command-line tool for configuring MCP servers and syncing agent skills for Claude Code, Codex, and other AI tools.',
            pr: 101,
            tag: 'cli',
          },
          {
            title: 'Public docs site',
            description:
              'Sidebar navigation, AI integration guides, content types, search, versioning, and keyboard shortcuts.',
            pr: 96,
            tag: 'site',
          },
          {
            title: 'Features page',
            description: 'Animated demos showcasing core capabilities.',
            pr: 95,
            tag: 'site',
          },
          {
            title: 'Pricing page',
            description: 'Free and Pro tier comparison with full feature breakdown.',
            pr: 95,
            tag: 'site',
          },
          {
            title: 'PAT rename',
            description: 'Rename Personal Access Tokens from the settings page.',
            pr: 108,
            tag: 'web',
          },
          {
            title: 'Keyboard navigation for content list',
            description: 'Arrow keys to navigate, Enter to open.',
            pr: 110,
            tag: 'web',
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
            pr: 97,
            tag: 'performance',
          },
          {
            title: 'Smarter data fetching',
            description:
              'Filter views no longer fire a redundant API call before filters load. User limits are prefetched at the layout level so detail pages render without a sequential waterfall.',
            pr: 98,
            tag: 'performance',
          },
          {
            title: 'Landing page animations',
            description: 'Scroll-triggered animations for a smoother first impression.',
            pr: 95,
            tag: 'site',
          },
          {
            title: 'Chrome extension',
            description: 'Tag filtering, sort options, character limit feedback, draft persistence, and search results open in the current tab.',
            pr: 109,
            tag: 'extension',
          },
          {
            title: 'Editor state preservation',
            description: 'Undo history, cursor position, and unsaved edits survive save cycles.',
            pr: 110,
            tag: 'web',
          },
          {
            title: 'Character limit feedback',
            description: 'Progressive color-coded warnings replace hard validation errors across all form fields.',
            pr: 110,
            tag: 'web',
          },
          {
            title: 'Search bar',
            description: 'Press f to focus; placeholder shows the shortcut hint.',
            pr: 110,
            tag: 'web',
          },
        ],
      },
    ],
  },
  {
    month: 'February 2026',
    theme: 'Extensions, Versioning, & Search',
    categories: [
      {
        label: 'New',
        emoji: '🚀',
        entries: [
          {
            title: 'Chrome extension',
            description: 'Save and search bookmarks from any page.',
            pr: 90,
            tag: 'extension',
          },
          {
            title: 'Content versioning',
            description: 'Full history with diffs and one-click restore.',
            pr: 76,
            tag: 'web',
          },
          {
            title: 'Full-text search with command palette',
            description: 'Press Cmd+Shift+P to search across all content.',
            pr: 78,
            tag: 'web',
          },
          {
            title: 'Content relationships',
            description: 'Link related bookmarks, notes, and prompts together.',
            pr: 77,
            tag: 'web',
          },
          {
            title: 'Table of contents sidebar',
            description: 'Auto-generated heading navigation for long documents.',
            pr: 84,
            tag: 'web',
          },
          {
            title: 'Slash command menu & editor command palette',
            description: 'Type / for block commands or Cmd+/ for editor actions.',
            pr: 83,
            tag: 'web',
          },
          {
            title: 'Jinja2 syntax highlighting',
            description: 'Template variables and blocks are highlighted in the editor.',
            pr: 82,
            tag: 'web',
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
            pr: 86,
            tag: 'api',
          },
          {
            title: 'Multi-value view search',
            description: 'Search across multiple fields with archive relevance.',
            pr: 88,
            tag: 'api',
          },
          {
            title: 'UI density and consistency',
            description: 'Tighter spacing and unified component styles throughout the app.',
            pr: 81,
            tag: 'web',
          },
        ],
      },
    ],
  },
  {
    month: 'January 2026',
    theme: 'AI Tools, Editor, & Foundations',
    categories: [
      {
        label: 'New',
        emoji: '🚀',
        entries: [
          {
            title: 'Tier-based usage limits',
            description: 'Free and Pro tiers with clear content and API limits.',
            tag: 'api',
          },
          {
            title: 'Agent Skills export',
            description: 'Export prompts for Claude Code, Claude Desktop, and Codex.',
            tag: 'web',
          },
          {
            title: 'WYSIWYG markdown editor',
            description: 'Rich editing with syntax highlighting and keyboard shortcuts.',
            tag: 'web',
          },
          {
            title: 'Prompt template preview',
            description: 'Render Jinja2 templates with sample data before saving.',
            tag: 'web',
          },
          {
            title: 'Filters & Collections',
            description: 'Saved tag-based boolean filters for organizing content.',
            tag: 'web',
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
            tag: 'api',
          },
          {
            title: 'HTTP caching',
            description: 'ETag and Last-Modified support for faster responses.',
            tag: 'performance',
          },
          {
            title: 'Multi-tab change detection',
            description: 'Optimistic locking prevents overwriting edits from other tabs.',
            tag: 'web',
          },
          {
            title: 'Content editing API and MCP tools',
            description: 'Programmatic content updates via API and MCP.',
            tag: 'api',
          },
          {
            title: 'UUIDv7 primary keys',
            description: 'Time-sortable IDs for better database performance.',
            tag: 'performance',
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
            tag: 'web',
          },
          {
            title: 'Notes',
            description: 'Freeform markdown documents with tags.',
            tag: 'web',
          },
          {
            title: 'Prompt templates',
            description: 'Jinja2 templates with named arguments for AI workflows.',
            tag: 'web',
          },
          {
            title: 'Tags & organization',
            description: 'Global tagging system across all content types.',
            tag: 'web',
          },
          {
            title: 'MCP integration',
            description: 'Two MCP servers for AI assistant access to all content.',
            tag: 'api',
          },
          {
            title: 'API & Personal Access Tokens',
            description: 'Programmatic access via REST API with PAT authentication.',
            tag: 'api',
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
                {entry.tag && <> <TagBadge tag={entry.tag} /></>}
                {' — '}
                {entry.description}
                {entry.pr && (
                  <>
                    {' '}
                    <a
                      href={`https://github.com/shane-kercheval/tiddly/pull/${entry.pr}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      #{entry.pr}
                    </a>
                  </>
                )}
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
