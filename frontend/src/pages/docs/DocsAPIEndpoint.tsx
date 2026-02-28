import { Navigate, useParams } from 'react-router-dom'
import type { ReactNode } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'

const ENDPOINT_TITLES: Record<string, string> = {
  bookmarks: 'Bookmark Endpoints',
  notes: 'Note Endpoints',
  prompts: 'Prompt Endpoints',
  content: 'Unified Search Endpoint',
  tags: 'Tags Endpoint',
  history: 'History Endpoints',
}

export function DocsAPIEndpoint(): ReactNode {
  const { endpoint } = useParams<{ endpoint: string }>()
  const title = endpoint ? ENDPOINT_TITLES[endpoint] : undefined

  usePageTitle(title ? `Docs - ${title}` : 'Docs - API')

  if (!title) {
    return <Navigate to="/docs/api" replace />
  }

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900">{title}</h1>
      <p className="mt-4 text-gray-600">Coming soon.</p>
    </div>
  )
}
