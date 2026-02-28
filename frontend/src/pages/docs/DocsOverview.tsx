import type { ReactNode } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'

export function DocsOverview(): ReactNode {
  usePageTitle('Docs')
  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900">Documentation</h1>
      <p className="mt-4 text-gray-600">Welcome to the Tiddly documentation.</p>
    </div>
  )
}
