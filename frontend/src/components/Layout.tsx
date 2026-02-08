import { useState, useEffect, useRef } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { Sidebar } from './sidebar'
import { ShortcutsDialog } from './ShortcutsDialog'
import { Footer } from './Footer'
import { useUIPreferencesStore } from '../stores/uiPreferencesStore'
import { useSidebarStore } from '../stores/sidebarStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useFiltersStore } from '../stores/filtersStore'
import { useTagsStore } from '../stores/tagsStore'
import { useHistorySidebarStore } from '../stores/historySidebarStore'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'

/**
 * Layout component that wraps authenticated pages.
 * Includes sidebar with navigation and user controls.
 *
 * Responsibilities:
 * - Fetch shared data (sidebar, filters, tags) once on mount
 * - Render sidebar and main content area
 * - Handle global keyboard shortcuts
 */
export function Layout(): ReactNode {
  const fullWidthLayout = useUIPreferencesStore((state) => state.fullWidthLayout)
  const toggleFullWidthLayout = useUIPreferencesStore((state) => state.toggleFullWidthLayout)
  const toggleSidebar = useSidebarStore((state) => state.toggleCollapse)
  const fetchSidebar = useSettingsStore((state) => state.fetchSidebar)
  const fetchFilters = useFiltersStore((state) => state.fetchFilters)
  const fetchTags = useTagsStore((state) => state.fetchTags)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const location = useLocation()
  const showFooter = location.pathname.startsWith('/app/settings')
  const hasFetchedRef = useRef(false)

  // Fetch shared data once on mount (used by Sidebar and child pages)
  useEffect(() => {
    if (!hasFetchedRef.current) {
      hasFetchedRef.current = true
      fetchSidebar()
      fetchFilters()
      fetchTags()
    }
  }, [fetchSidebar, fetchFilters, fetchTags])

  // Global keyboard shortcuts (work on all pages)
  useKeyboardShortcuts({
    onShowShortcuts: () => setShowShortcuts(true),
    onToggleSidebar: toggleSidebar,
    onToggleWidth: toggleFullWidthLayout,
    onEscape: () => {
      if (showShortcuts) setShowShortcuts(false)
    },
  })

  const historySidebarOpen = useHistorySidebarStore((state) => state.isOpen)
  const historySidebarWidth = useHistorySidebarStore((state) => state.width)

  return (
    <div className="flex h-dvh bg-white overflow-hidden">
      <Sidebar />
      {/* Note: id="main-content" is used by SaveOverlay.tsx for portal rendering */}
      <main
        id="main-content"
        className="flex-1 flex flex-col min-w-0 relative overflow-x-hidden transition-[margin] duration-200"
        style={{ marginRight: historySidebarOpen ? `${historySidebarWidth}px` : 0 }}
      >
        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          <div className={`flex flex-col min-h-0 px-4 pb-4 md:px-6 ${fullWidthLayout ? 'max-w-full' : 'max-w-5xl'}`}>
            <Outlet />
          </div>
        </div>
        {showFooter && <Footer />}
      </main>
      <ShortcutsDialog isOpen={showShortcuts} onClose={() => setShowShortcuts(false)} />
    </div>
  )
}
