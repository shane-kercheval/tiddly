import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import type { ReactNode } from 'react'
import { Sidebar } from './sidebar'
import { ShortcutsDialog } from './ShortcutsDialog'
import { useUIPreferencesStore } from '../stores/uiPreferencesStore'
import { useSidebarStore } from '../stores/sidebarStore'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'

/**
 * Layout component that wraps authenticated pages.
 * Includes sidebar with navigation and user controls.
 */
export function Layout(): ReactNode {
  const fullWidthLayout = useUIPreferencesStore((state) => state.fullWidthLayout)
  const toggleFullWidthLayout = useUIPreferencesStore((state) => state.toggleFullWidthLayout)
  const toggleSidebar = useSidebarStore((state) => state.toggleCollapse)
  const [showShortcuts, setShowShortcuts] = useState(false)

  // Global keyboard shortcuts (work on all pages)
  useKeyboardShortcuts({
    onShowShortcuts: () => setShowShortcuts(true),
    onToggleSidebar: toggleSidebar,
    onToggleWidth: toggleFullWidthLayout,
    onEscape: () => {
      if (showShortcuts) setShowShortcuts(false)
    },
  })

  return (
    <div className="flex min-h-screen bg-white">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className={`px-6 py-8 md:px-10 ${fullWidthLayout ? '' : 'max-w-5xl'}`}>
          <Outlet />
        </div>
      </main>
      <ShortcutsDialog isOpen={showShortcuts} onClose={() => setShowShortcuts(false)} />
    </div>
  )
}
