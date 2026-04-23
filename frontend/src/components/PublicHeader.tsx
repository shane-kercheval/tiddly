import { useState, useRef, useEffect, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { useAuthStatus } from '../hooks/useAuthStatus'
import { isDevMode } from '../config'
import { PrefetchLink } from './PrefetchLink'
import { BookmarkIcon } from './icons'

interface DropdownItem {
  label: string
  path: string
  external?: boolean
}

const productItems: DropdownItem[] = [
  { label: 'Features', path: '/features' },
  { label: 'Roadmap', path: '/roadmap' },
  { label: 'Changelog', path: '/changelog' },
]

/**
 * Auth buttons that use Auth0's loginWithRedirect.
 * Isolated into a sub-component so useAuth0() is only called in production
 * (where Auth0Provider is mounted). In dev mode, PublicHeader renders "Open App" instead.
 */
function AuthButtons(): ReactNode {
  const { loginWithRedirect } = useAuth0()

  return (
    <>
      <button
        onClick={() => loginWithRedirect({ authorizationParams: { screen_hint: 'login' } })}
        className="rounded-lg px-4 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2"
      >
        Log In
      </button>
      <button
        onClick={() => loginWithRedirect({ authorizationParams: { screen_hint: 'signup' } })}
        className="rounded-lg bg-gray-900 px-5 py-1.5 text-sm font-medium text-white transition-all hover:bg-gray-700 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2"
      >
        Sign Up
      </button>
    </>
  )
}

/**
 * Shared header for all public pages (landing, docs, changelog, roadmap, pricing).
 * Nav: Logo(Tiddly) | Product (dropdown) | Docs | Pricing ... Log In | Sign Up
 *
 * In dev mode, shows "Open App" link (no auth buttons). In production, unauthenticated
 * users see Log In / Sign Up buttons rendered by AuthButtons (which calls useAuth0).
 */
export function PublicHeader(): ReactNode {
  const { isAuthenticated } = useAuthStatus()
  const location = useLocation()

  const [productOpen, setProductOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [prevPath, setPrevPath] = useState(location.pathname)
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

  // Close menus on route change
  if (prevPath !== location.pathname) {
    setPrevPath(location.pathname)
    if (productOpen) setProductOpen(false)
    if (mobileOpen) setMobileOpen(false)
  }

  // Show border when scrolled
  const [scrolled, setScrolled] = useState(false)
  const handleScroll = useCallback(() => setScrolled(window.scrollY > 10), [])
  useEffect(() => {
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [handleScroll])

  const isActiveLink = (path: string): boolean => {
    if (path === '/docs') return location.pathname.startsWith('/docs')
    if (path === '/features') return location.pathname === '/features'
    return location.pathname === path
  }

  const isProductActive = productItems.some((item) => isActiveLink(item.path))

  const navLinkClass = (active: boolean): string =>
    `text-sm font-medium transition-colors border-b-2 pb-0.5 ${
      active ? 'text-gray-900 border-gray-900' : 'text-gray-500 border-transparent hover:text-gray-900'
    }`

  return (
    <header className={`sticky top-0 z-40 w-full bg-white/80 backdrop-blur-md transition-colors ${scrolled ? 'border-b border-gray-200/60' : 'border-b border-transparent'}`}>
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4 sm:px-8 lg:px-12">
        {/* Left: Logo + Nav */}
        <div className="flex items-center gap-8">
          <PrefetchLink to="/" className="flex items-center gap-2" aria-label="Home">
            <BookmarkIcon className="h-6 w-6 text-gray-900" />
            <span className="text-lg font-semibold text-gray-900">Tiddly</span>
          </PrefetchLink>

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
                <div className="absolute left-0 top-full z-50 mt-2 w-44 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                  {productItems.map((item) => (
                    <PrefetchLink
                      key={item.path}
                      to={item.path}
                      className="block px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                    >
                      {item.label}
                    </PrefetchLink>
                  ))}
                </div>
              )}
            </div>

            <PrefetchLink to="/docs" className={navLinkClass(isActiveLink('/docs'))}>
              Docs
            </PrefetchLink>
            <PrefetchLink to="/pricing" className={navLinkClass(isActiveLink('/pricing'))}>
              Pricing
            </PrefetchLink>
          </nav>
        </div>

        {/* Right: Auth buttons + mobile menu toggle */}
        <div className="flex items-center gap-3">
          {isAuthenticated || isDevMode ? (
            <PrefetchLink
              to="/app/content"
              className="rounded-lg bg-gray-900 px-5 py-1.5 text-sm font-medium text-white transition-colors hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2"
            >
              Open App
            </PrefetchLink>
          ) : (
            <AuthButtons />
          )}
          <button
            type="button"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileOpen}
            aria-controls="public-mobile-menu"
            className="-mr-1 inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 sm:hidden"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              {mobileOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile nav panel */}
      {mobileOpen && (
        <div
          id="public-mobile-menu"
          className="border-t border-gray-200/60 bg-white sm:hidden"
        >
          <nav className="mx-auto flex max-w-5xl flex-col gap-1 px-6 py-3">
            <div className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
              Product
            </div>
            {productItems.map((item) => (
              <PrefetchLink
                key={item.path}
                to={item.path}
                className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  isActiveLink(item.path)
                    ? 'bg-gray-100 text-gray-900'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`}
              >
                {item.label}
              </PrefetchLink>
            ))}
            <div className="my-1 border-t border-gray-100" />
            <PrefetchLink
              to="/docs"
              className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                isActiveLink('/docs')
                  ? 'bg-gray-100 text-gray-900'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              Docs
            </PrefetchLink>
            <PrefetchLink
              to="/pricing"
              className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                isActiveLink('/pricing')
                  ? 'bg-gray-100 text-gray-900'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              Pricing
            </PrefetchLink>
          </nav>
        </div>
      )}
    </header>
  )
}
