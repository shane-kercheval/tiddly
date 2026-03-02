import { Outlet } from 'react-router-dom'
import type { ReactNode } from 'react'
import { PublicHeader } from './PublicHeader'
import { Footer } from './Footer'

/**
 * Layout wrapper for standalone public pages (changelog, roadmap).
 * Renders PublicHeader + content area + Footer, without a docs sidebar.
 */
export function PublicPageLayout(): ReactNode {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <PublicHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-12 sm:px-8 lg:px-12">
        <Outlet />
      </main>
      <Footer />
    </div>
  )
}
