import { Outlet } from 'react-router-dom'
import type { ReactNode } from 'react'
import { Sidebar } from './sidebar'
import { useUIPreferencesStore } from '../stores/uiPreferencesStore'

/**
 * Layout component that wraps authenticated pages.
 * Includes sidebar with navigation and user controls.
 */
export function Layout(): ReactNode {
  const fullWidthLayout = useUIPreferencesStore((state) => state.fullWidthLayout)

  return (
    <div className="flex min-h-screen bg-white">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className={`px-6 py-8 md:px-10 ${fullWidthLayout ? '' : 'max-w-5xl'}`}>
          <Outlet />
        </div>
      </main>
    </div>
  )
}
