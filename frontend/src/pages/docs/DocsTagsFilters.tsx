import type { ReactNode } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'

export function DocsTagsFilters(): ReactNode {
  usePageTitle('Docs - Tags & Filters')
  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900">Tags & Filters</h1>
      <p className="mt-4 text-gray-600">Coming soon.</p>
    </div>
  )
}
