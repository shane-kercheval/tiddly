import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'

// Brand-colored browser logos
const ChromeIcon = ({ className = 'h-5 w-5' }: { className?: string }): ReactNode => (
  <svg className={className} viewBox="0 0 24 24">
    <path fill="#EA4335" d="M12 0C8.21 0 4.831 1.757 2.632 4.501l3.953 6.848A5.454 5.454 0 0 1 12 6.545h10.691A12 12 0 0 0 12 0z" />
    <path fill="#34A853" d="M1.931 5.47A11.943 11.943 0 0 0 0 12c0 6.012 4.42 10.991 10.189 11.864l3.953-6.847a5.45 5.45 0 0 1-6.865-2.29z" />
    <path fill="#FBBC05" d="M15.273 7.636a5.446 5.446 0 0 1 1.45 7.09l.002.001h-.002l-5.344 9.257c.206.01.413.016.621.016 6.627 0 12-5.373 12-12 0-1.54-.29-3.011-.818-4.364z" />
    <circle fill="#4285F4" cx="12" cy="12" r="4.364" />
  </svg>
)

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
      <h1 className="text-3xl font-bold text-gray-900 mb-4">Browser Extensions</h1>
      <p className="text-gray-600 mb-8">
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
