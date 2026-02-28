import { useState, useRef, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuthStatus } from '../hooks/useAuthStatus'
import { isDevMode } from '../config'
import { BookmarkIcon } from './icons'

interface DropdownItem {
  label: string
  path: string
  external?: boolean
}

const productItems: DropdownItem[] = [
  { label: 'Features', path: '/' },
  { label: 'Changelog', path: '/changelog' },
  { label: 'Roadmap', path: '/roadmap' },
]

/**
 * Shared header for all public pages (landing, docs, changelog, roadmap, pricing).
 * Nav: Logo(Tiddly) | Product (dropdown) | Docs | Pricing ... Log In | Sign Up
 */
export function PublicHeader({
  onLogin,
  onSignup,
  fullWidth = false,
}: {
  onLogin?: () => void
  onSignup?: () => void
  fullWidth?: boolean
}): ReactNode {
  const { isAuthenticated } = useAuthStatus()
  const location = useLocation()
  const [productOpen, setProductOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent): void {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setProductOpen(false)
      }
    }
    if (productOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [productOpen])

  // Close dropdown on route change
  useEffect(() => {
    setProductOpen(false)
  }, [location.pathname])

  const isActiveLink = (path: string): boolean => {
    if (path === '/docs') return location.pathname.startsWith('/docs')
    return location.pathname === path
  }

  const isProductActive = productItems.some((item) => isActiveLink(item.path))

  const navLinkClass = (active: boolean): string =>
    `text-sm font-medium transition-colors ${
      active ? 'text-gray-900' : 'text-gray-500 hover:text-gray-900'
    }`

  return (
    <header className="w-full">
      <div className={`flex items-center justify-between border-b border-gray-100 px-6 py-4 sm:px-8 lg:px-12 ${fullWidth ? '' : 'mx-auto max-w-5xl'}`}>
        {/* Left: Logo + Nav */}
        <div className="flex items-center gap-8">
          <Link to="/" className="flex items-center gap-2" aria-label="Home">
            <BookmarkIcon className="h-6 w-6 text-gray-900" />
            <span className="text-lg font-semibold text-gray-900">Tiddly</span>
          </Link>

          <nav className="hidden items-center gap-6 sm:flex">
            {/* Product dropdown */}
            <div ref={dropdownRef} className="relative">
              <button
                type="button"
                onClick={() => setProductOpen(!productOpen)}
                className={`flex items-center gap-1 ${navLinkClass(isProductActive)}`}
              >
                Product
                <svg
                  className={`h-3.5 w-3.5 transition-transform ${productOpen ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {productOpen && (
                <div className="absolute left-0 top-full z-50 mt-2 w-40 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                  {productItems.map((item) => (
                    <Link
                      key={item.path}
                      to={item.path}
                      className="block px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>

            <Link to="/docs" className={navLinkClass(isActiveLink('/docs'))}>
              Docs
            </Link>
            <Link to="/pricing" className={navLinkClass(isActiveLink('/pricing'))}>
              Pricing
            </Link>
          </nav>
        </div>

        {/* Right: Auth buttons */}
        <div className="flex items-center gap-3">
          {isAuthenticated || isDevMode ? (
            <Link
              to="/app/content"
              className="rounded-lg bg-gray-900 px-5 py-1.5 text-sm font-medium text-white transition-colors hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2"
            >
              Open App
            </Link>
          ) : (
            <>
              <button
                onClick={onLogin}
                className="rounded-lg px-4 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2"
              >
                Log In
              </button>
              <button
                onClick={onSignup}
                className="rounded-lg bg-gray-900 px-5 py-1.5 text-sm font-medium text-white transition-colors hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2"
              >
                Sign Up
              </button>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
