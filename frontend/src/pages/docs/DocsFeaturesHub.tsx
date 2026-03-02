import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'

interface FeatureCard {
  name: string
  description: string
  path: string
}

const FEATURES: FeatureCard[] = [
  {
    name: 'Content Types',
    description: 'Bookmarks, notes, and prompts — the three content types you can create and organize.',
    path: '/docs/features/content-types',
  },
  {
    name: 'Prompts & Templates',
    description: 'Jinja2 template syntax, arguments, rendering, and agent skills.',
    path: '/docs/features/prompts',
  },
  {
    name: 'Tags & Filters',
    description: 'Organize content with tags, create saved filters, and group them into collections.',
    path: '/docs/features/tags-filters',
  },
  {
    name: 'Search',
    description: 'Full-text search, in-content search, and search operators.',
    path: '/docs/features/search',
  },
  {
    name: 'Versioning',
    description: 'Content history, version restore, and source tracking.',
    path: '/docs/features/versioning',
  },
  {
    name: 'Keyboard Shortcuts',
    description: 'Navigate and manage content quickly with keyboard shortcuts.',
    path: '/docs/features/shortcuts',
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
              <h3 className="text-lg font-semibold text-gray-900 group-hover:text-[#d97b3d]">
                {feature.name}
              </h3>
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
