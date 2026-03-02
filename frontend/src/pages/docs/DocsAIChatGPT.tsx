import type { ReactNode } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'

export function DocsAIChatGPT(): ReactNode {
  usePageTitle('Docs - ChatGPT')

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-6">ChatGPT</h1>
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-6 text-center">
        <div className="mb-4">
          <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h2 className="text-lg font-medium text-gray-900 mb-2">
          Coming Soon
        </h2>
        <p className="text-sm text-gray-600">
          ChatGPT requires OAuth authentication for MCP integration.
          OAuth support is coming soon.
        </p>
      </div>
    </div>
  )
}
