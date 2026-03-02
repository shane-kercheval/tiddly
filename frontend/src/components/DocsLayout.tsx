import { useState } from 'react'
import { Outlet, Link, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { PublicHeader } from './PublicHeader'
import { Footer } from './Footer'

interface DocNavItem {
  label: string
  path: string
  children?: DocNavItem[]
}

const docsNav: DocNavItem[] = [
  { label: 'Overview', path: '/docs' },
  {
    label: 'Features',
    path: '/docs/features',
    children: [
      { label: 'Content Types', path: '/docs/features/content-types' },
      { label: 'Prompts & Templates', path: '/docs/features/prompts' },
      { label: 'Tags & Filters', path: '/docs/features/tags-filters' },
      { label: 'Search', path: '/docs/features/search' },
      { label: 'Versioning', path: '/docs/features/versioning' },
      { label: 'Keyboard Shortcuts', path: '/docs/features/shortcuts' },
    ],
  },
  {
    label: 'AI Integration',
    path: '/docs/ai',
    children: [
      { label: 'Claude Desktop', path: '/docs/ai/claude-desktop' },
      { label: 'Claude Code', path: '/docs/ai/claude-code' },
      { label: 'Codex', path: '/docs/ai/codex' },
      { label: 'ChatGPT', path: '/docs/ai/chatgpt' },
      { label: 'Gemini CLI', path: '/docs/ai/gemini-cli' },
      { label: 'MCP Tools', path: '/docs/ai/mcp-tools' },
    ],
  },
  {
    label: 'Extensions',
    path: '/docs/extensions',
    children: [
      { label: 'Chrome', path: '/docs/extensions/chrome' },
      { label: 'Safari', path: '/docs/extensions/safari' },
    ],
  },
  {
    label: 'API',
    path: '/docs/api',
    children: [
      { label: 'Bookmarks', path: '/docs/api/bookmarks' },
      { label: 'Notes', path: '/docs/api/notes' },
      { label: 'Prompts', path: '/docs/api/prompts' },
      { label: 'Content', path: '/docs/api/content' },
      { label: 'Tags', path: '/docs/api/tags' },
      { label: 'History', path: '/docs/api/history' },
    ],
  },
  { label: 'FAQ', path: '/docs/faq' },
]

function isNavItemActive(item: DocNavItem, pathname: string): boolean {
  if (item.path === pathname) return true
  return item.children?.some((child) => isNavItemActive(child, pathname)) ?? false
}

function NavItem({ item, pathname, depth = 0 }: { item: DocNavItem; pathname: string; depth?: number }): ReactNode {
  const isActive = item.path === pathname
  const isParentActive = isNavItemActive(item, pathname)
  const hasChildren = item.children && item.children.length > 0

  return (
    <div>
      <Link
        to={item.path}
        aria-current={isActive ? 'page' : undefined}
        className={`block rounded-md px-3 py-1.5 text-sm transition-colors ${
          depth > 0 ? 'ml-4' : ''
        } ${
          isActive
            ? 'bg-[#fff0e5] font-medium text-[#d97b3d]'
            : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
        }`}
      >
        {item.label}
      </Link>
      {hasChildren && isParentActive && (
        <div className="mt-1 space-y-1">
          {item.children!.map((child) => (
            <NavItem key={child.path} item={child} pathname={pathname} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Docs layout with sidebar navigation.
 * Public page (no auth required) with responsive sidebar that collapses on mobile.
 */
export function DocsLayout(): ReactNode {
  const { pathname } = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [prevPath, setPrevPath] = useState(pathname)

  // Close mobile sidebar on route change
  if (prevPath !== pathname) {
    setPrevPath(pathname)
    if (sidebarOpen) setSidebarOpen(false)
  }

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <PublicHeader fullWidth />

      <div className="flex w-full flex-1">
        {/* Mobile menu button */}
        <button
          type="button"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="fixed bottom-4 right-4 z-40 rounded-full bg-gray-900 p-3 text-white shadow-lg md:hidden"
          aria-label="Toggle docs navigation"
          aria-expanded={sidebarOpen}
        >
          {sidebarOpen ? (
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>

        {/* Mobile sidebar overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/20 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar — extends to left edge */}
        <aside
          className={`fixed inset-y-0 left-0 z-30 w-64 transform overflow-y-auto bg-white p-6 pt-20 shadow-lg transition-transform md:static md:block md:w-56 md:shrink-0 md:transform-none md:border-r md:border-gray-200 md:shadow-none md:pt-8 md:pl-6 md:pr-6 lg:pl-8 ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
          }`}
        >
          <nav className="ml-auto w-full max-w-[12rem] space-y-1">
            {docsNav.map((item) => (
              <NavItem key={item.path} item={item} pathname={pathname} />
            ))}
          </nav>
        </aside>

        {/* Main content */}
        <main className="min-w-0 flex-1 px-6 py-8 sm:px-8 lg:px-12">
          <div className="max-w-3xl">
            <Outlet />
          </div>
        </main>
      </div>

      <Footer />
    </div>
  )
}
