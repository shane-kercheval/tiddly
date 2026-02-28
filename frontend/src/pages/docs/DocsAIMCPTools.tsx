import type { ReactNode } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'

export function DocsAIMCPTools(): ReactNode {
  usePageTitle('Docs - MCP Tools')
  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900">MCP Tools</h1>
      <p className="mt-4 text-gray-600">Coming soon.</p>
    </div>
  )
}
