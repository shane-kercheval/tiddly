import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'
import { SharedIcon, PromptIcon, TagIcon, SearchIcon, HistoryIcon } from '../../components/icons'

// Keyboard icon — no existing component in icons/index.tsx
const KeyboardIcon = ({ className = 'h-5 w-5' }: { className?: string }): ReactNode => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round"
      d="M2.25 7.125C2.25 6.504 2.754 6 3.375 6h17.25c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125H3.375A1.125 1.125 0 0 1 2.25 16.875v-9.75ZM6 9.75h.008v.008H6V9.75Zm0 3h.008v.008H6v-.008Zm0 3h.008v.008H6v-.008Zm3-6h.008v.008H9V9.75Zm0 3h.008v.008H9v-.008Zm3-3h.008v.008H12V9.75Zm0 3h.008v.008H12v-.008Zm3-3h.008v.008H15V9.75Zm0 3h.008v.008H15v-.008Zm3-3h.008v.008H18V9.75Zm0 3h.008v.008H18v-.008ZM9 15.75h6" />
  </svg>
)

interface FeatureCard {
  name: string
  description: string
  path: string
  icon: ReactNode
}

const FEATURES: FeatureCard[] = [
  {
    name: 'Content Types',
    description: 'Bookmarks, notes, and prompts — the three content types you can create and organize.',
    path: '/docs/features/content-types',
    icon: <SharedIcon className="h-5 w-5" />,
  },
  {
    name: 'Prompts & Templates',
    description: 'Jinja2 template syntax, arguments, rendering, and agent skills.',
    path: '/docs/features/prompts',
    icon: <PromptIcon className="h-5 w-5" />,
  },
  {
    name: 'Tags & Filters',
    description: 'Organize content with tags, create saved filters, and group them into collections.',
    path: '/docs/features/tags-filters',
    icon: <TagIcon className="h-5 w-5" />,
  },
  {
    name: 'Search',
    description: 'Full-text search, in-content search, and search operators.',
    path: '/docs/features/search',
    icon: <SearchIcon className="h-5 w-5" />,
  },
  {
    name: 'Versioning',
    description: 'Content history, version restore, and source tracking.',
    path: '/docs/features/versioning',
    icon: <HistoryIcon className="h-5 w-5" />,
  },
  {
    name: 'Keyboard Shortcuts',
    description: 'Navigate and manage content quickly with keyboard shortcuts.',
    path: '/docs/features/shortcuts',
    icon: <KeyboardIcon className="h-5 w-5" />,
  },
]

export function DocsFeaturesHub(): ReactNode {
  usePageTitle('Docs - Features')

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-4">Features</h1>
      <p className="text-gray-600 mb-8">
        Explore the core features of Tiddly — from content management to search and versioning.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        {FEATURES.map((feature) => (
          <Link
            key={feature.name}
            to={feature.path}
            className="group rounded-lg border border-gray-200 bg-white p-5 transition-colors hover:border-[#f09040] hover:bg-[#fff7f0]"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-gray-400 group-hover:text-[#d97b3d]">{feature.icon}</span>
                <h3 className="text-lg font-semibold text-gray-900 group-hover:text-[#d97b3d]">
                  {feature.name}
                </h3>
              </div>
              <svg className="h-4 w-4 text-gray-400 group-hover:text-[#d97b3d]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
            <p className="text-sm text-gray-600">{feature.description}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
