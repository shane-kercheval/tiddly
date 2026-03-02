import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'

interface SectionCard {
  name: string
  description: string
  path: string
}

const SECTIONS: SectionCard[] = [
  {
    name: 'Getting Started',
    description: 'Create an account, learn the basics, and set up your first bookmarks, notes, and prompts.',
    path: '/docs/getting-started',
  },
  {
    name: 'Features',
    description: 'Content types, search, tags & filters, versioning, keyboard shortcuts, and more.',
    path: '/docs/features',
  },
  {
    name: 'AI Integration',
    description: 'Connect AI assistants like Claude, ChatGPT, and Codex to your content via MCP.',
    path: '/docs/ai',
  },
  {
    name: 'Extensions',
    description: 'Save bookmarks directly from Chrome or Safari with browser extensions.',
    path: '/docs/extensions',
  },
  {
    name: 'API',
    description: 'Programmatic access to bookmarks, notes, prompts, tags, and history.',
    path: '/docs/api',
  },
]

export function DocsOverview(): ReactNode {
  usePageTitle('Docs')

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-4">Documentation</h1>
      <p className="text-gray-600 mb-8">
        Welcome to the Tiddly documentation. Find guides, feature references, and integration
        instructions for getting the most out of your bookmarks, notes, and prompts.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        {SECTIONS.map((section) => (
          <Link
            key={section.name}
            to={section.path}
            className="group rounded-lg border border-gray-200 bg-white p-5 transition-colors hover:border-[#f09040] hover:bg-[#fff7f0]"
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-lg font-semibold text-gray-900 group-hover:text-[#d97b3d]">
                {section.name}
              </h3>
              <svg className="h-4 w-4 text-gray-400 group-hover:text-[#d97b3d]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
            <p className="text-sm text-gray-600">{section.description}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
