/**
 * Shared section wrapper for docs pages (FAQ, Known Issues, etc.).
 * Renders a titled section with a bordered card container.
 */
import type { ReactNode } from 'react'

interface DocsSectionProps {
  title: string
  children: ReactNode
}

export function DocsSection({ title, children }: DocsSectionProps): ReactNode {
  return (
    <section className="mb-8">
      <h2 className="text-base font-semibold text-gray-900 mb-4">{title}</h2>
      <div className="rounded-lg border border-gray-200 bg-white px-5">
        {children}
      </div>
    </section>
  )
}
