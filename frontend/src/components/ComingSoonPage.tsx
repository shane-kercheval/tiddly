import type { ReactNode } from 'react'
import { usePageTitle } from '../hooks/usePageTitle'

/**
 * Placeholder page for sections not yet built.
 * Renders a title and "Coming soon." message.
 */
export function ComingSoonPage({ title, pageTitle }: { title: string; pageTitle: string }): ReactNode {
  usePageTitle(pageTitle)
  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900">{title}</h1>
      <p className="mt-4 text-gray-600">Coming soon.</p>
    </div>
  )
}
