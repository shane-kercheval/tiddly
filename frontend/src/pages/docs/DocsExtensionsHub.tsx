import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'
import { ChromeIcon } from '../../components/icons'

const SafariIcon = ({ className = 'h-5 w-5' }: { className?: string }): ReactNode => (
  <svg className={className} viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="12" fill="#006CFF" />
    <path fill="#FF3B30" d="M17 7l-3.5 6.5-3-3z" />
    <path fill="#fff" d="M7 17l3.5-6.5 3 3z" />
  </svg>
)

interface ExtensionCard {
  name: string
  description: string
  path: string
  icon: ReactNode
  comingSoon?: boolean
}

const EXTENSIONS: ExtensionCard[] = [
  {
    name: 'Chrome',
    description: 'Save bookmarks with one click, auto-scrape metadata, and search your collection — all from the browser toolbar.',
    path: '/docs/extensions/chrome',
    icon: <ChromeIcon className="h-5 w-5" />,
  },
  {
    name: 'Safari',
    description: 'Native Safari extension for macOS, iOS, and iPadOS.',
    path: '/docs/extensions/safari',
    icon: <SafariIcon className="h-5 w-5" />,
    comingSoon: true,
  },
]

export function DocsExtensionsHub(): ReactNode {
  usePageTitle('Docs - Extensions')

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-4">Browser Extensions</h1>
      <p className="text-sm text-gray-600 mb-8">
        Save bookmarks directly from your browser without switching to the Tiddly web app.
        Extensions auto-scrape page metadata (title, description, content) and let you add
        tags before saving. You can also search your existing bookmarks saved to tiddly.me
        right from the extension popup.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        {EXTENSIONS.map((ext) =>
          ext.comingSoon ? (
            <div
              key={ext.name}
              className="rounded-lg border border-gray-200 bg-gray-50 p-5 opacity-60"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-gray-400">{ext.icon}</span>
                  <h3 className="text-lg font-semibold text-gray-500">{ext.name}</h3>
                </div>
                <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-500">
                  Coming soon
                </span>
              </div>
              <p className="text-sm text-gray-400">{ext.description}</p>
            </div>
          ) : (
            <Link
              key={ext.name}
              to={ext.path}
              className="group rounded-lg border border-gray-200 bg-white p-5 transition-colors hover:border-[#f09040] hover:bg-[#fff7f0]"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-gray-400 group-hover:text-[#d97b3d]">{ext.icon}</span>
                  <h3 className="text-lg font-semibold text-gray-900 group-hover:text-[#d97b3d]">
                    {ext.name}
                  </h3>
                </div>
                <svg className="h-4 w-4 text-gray-400 group-hover:text-[#d97b3d]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
              <p className="text-sm text-gray-600">{ext.description}</p>
            </Link>
          )
        )}
      </div>
    </div>
  )
}
