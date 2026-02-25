import { useState, useEffect, useRef, useCallback } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { Sidebar } from './sidebar'
import { ShortcutsDialog } from './ShortcutsDialog'
import { CommandPalette } from './CommandPalette'
import { Footer } from './Footer'
import { ContentAreaSpinner } from './ui'
import { isDevMode } from '../config'
import { useConsentStore } from '../stores/consentStore'
import { useUIPreferencesStore } from '../stores/uiPreferencesStore'
import { useSidebarStore } from '../stores/sidebarStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useFiltersStore } from '../stores/filtersStore'
import { useTagsStore } from '../stores/tagsStore'
import { useRightSidebarStore, MIN_SIDEBAR_WIDTH, MIN_CONTENT_WIDTH } from '../stores/rightSidebarStore'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'

/**
 * Layout component that wraps authenticated pages.
 * Includes sidebar with navigation and user controls.
 *
 * Responsibilities:
 * - Fetch shared data (sidebar, filters, tags) once on mount, gated on consent readiness
 * - Render sidebar and main content area
 * - Handle global keyboard shortcuts
 * - Render command palette overlay
 *
 * Depends on AppLayout always rendering Outlet during consent checking so the sidebar
 * shell mounts immediately. AppLayout owns the consent dialog and error states; this
 * component gates data fetching and shows ContentAreaSpinner until consent resolves.
 */
/** Tailwind md breakpoint */
const MD_BREAKPOINT = 768

export function Layout(): ReactNode {
  const needsConsent = useConsentStore((state) => state.needsConsent)
  // Consent is ready in dev mode (no consent flow) or once consent is confirmed
  const consentReady = isDevMode || needsConsent === false
  const fullWidthLayout = useUIPreferencesStore((state) => state.fullWidthLayout)
  const toggleFullWidthLayout = useUIPreferencesStore((state) => state.toggleFullWidthLayout)
  const toggleSidebar = useSidebarStore((state) => state.toggleCollapse)
  const fetchSidebar = useSettingsStore((state) => state.fetchSidebar)
  const fetchFilters = useFiltersStore((state) => state.fetchFilters)
  const fetchTags = useTagsStore((state) => state.fetchTags)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= MD_BREAKPOINT : true
  )
  const location = useLocation()
  const showFooter = location.pathname.startsWith('/app/settings')
  // Right sidebar only renders on detail pages (e.g., /app/notes/abc-123), not create pages
  const isDetailPage = /^\/app\/(bookmarks|notes|prompts)\/(?!new$)[^/]+$/.test(location.pathname)
  const hasFetchedRef = useRef(false)
  const rightSidebarOpen = useRightSidebarStore((state) => state.activePanel !== null)
  const rightSidebarWidth = useRightSidebarStore((state) => state.width)

  // Command palette state
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [paletteInitialView, setPaletteInitialView] = useState<'commands' | 'search'>('commands')

  const openPalette = useCallback((view: 'commands' | 'search') => {
    setPaletteInitialView(view)
    setPaletteOpen(true)
  }, [])

  const closePalette = useCallback(() => {
    setPaletteOpen(false)
  }, [])

  // Fetch shared data once on mount (used by Sidebar and child pages).
  // Two-phase guard: consentReady gates until consent resolves, then hasFetchedRef prevents
  // re-fetching on subsequent re-renders.
  useEffect(() => {
    if (!consentReady) return
    if (!hasFetchedRef.current) {
      hasFetchedRef.current = true
      fetchSidebar()
      fetchFilters()
      fetchTags()
    }
  }, [consentReady, fetchSidebar, fetchFilters, fetchTags])

  // Track viewport size for responsive behavior and to recalculate sidebar margin
  const [, setResizeCount] = useState(0)
  useEffect(() => {
    const handleResize = (): void => {
      setIsDesktop(window.innerWidth >= MD_BREAKPOINT)
      // Force re-render to recalculate history sidebar margin
      if (rightSidebarOpen) {
        setResizeCount((c) => c + 1)
      }
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [rightSidebarOpen])

  const togglePanel = useRightSidebarStore((state) => state.togglePanel)

  // Global keyboard shortcuts (work on all pages)
  useKeyboardShortcuts({
    onShowShortcuts: () => setShowShortcuts(true),
    onToggleSidebar: toggleSidebar,
    onToggleWidth: toggleFullWidthLayout,
    onFocusSearch: () => openPalette('search'),
    onCommandPalette: () => openPalette('commands'),
    onToggleHistorySidebar: isDetailPage
      ? () => togglePanel('history')
      : undefined,
    onEscape: () => {
      if (showShortcuts) setShowShortcuts(false)
    },
  })

  // Calculate constrained margin for right sidebar
  // Uses the same logic as sidebar components to ensure they stay in sync
  const getRightSidebarMargin = (): number => {
    if (!rightSidebarOpen || !isDesktop || !isDetailPage) return 0
    const leftSidebar = document.getElementById('desktop-sidebar')
    const leftSidebarWidth = leftSidebar?.getBoundingClientRect().width ?? 0
    // Clamp to MIN_SIDEBAR_WIDTH to prevent negative values on narrow viewports
    const maxWidth = Math.max(MIN_SIDEBAR_WIDTH, window.innerWidth - leftSidebarWidth - MIN_CONTENT_WIDTH)
    return Math.min(rightSidebarWidth, maxWidth)
  }

  return (
    <div className="flex h-dvh bg-white overflow-hidden">
      <Sidebar onOpenPalette={() => openPalette('commands')} />
      {/* Note: id="main-content" is used by SaveOverlay.tsx for portal rendering */}
      <main
        id="main-content"
        className="flex-1 flex flex-col min-w-0 relative overflow-x-hidden transition-[margin] duration-200"
        style={{ marginRight: `${getRightSidebarMargin()}px` }}
      >
        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          <div className={`flex flex-col min-h-0 px-4 pb-4 md:px-5 ${fullWidthLayout ? 'max-w-full' : 'max-w-5xl'}`}>
            {consentReady ? <Outlet /> : <ContentAreaSpinner />}
          </div>
        </div>
        {showFooter && <Footer />}
      </main>
      <ShortcutsDialog isOpen={showShortcuts} onClose={() => setShowShortcuts(false)} />
      <CommandPalette isOpen={paletteOpen} initialView={paletteInitialView} onClose={closePalette} onShowShortcuts={() => setShowShortcuts(true)} />
    </div>
  )
}
