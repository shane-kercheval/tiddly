import type { ReactNode } from 'react'
import { StepSection } from './StepSection'

/**
 * Shared "Step 1: Create a Personal Access Token" component used by all client pages.
 */
export function CreateTokenStep(): ReactNode {
  return (
    <StepSection step={1} title="Create a Personal Access Token">
      <p className="text-gray-600 mb-3">
        Create a PAT to authenticate with the MCP server.
      </p>
      <a
        href="/app/settings/tokens"
        className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
        Create Token
      </a>
    </StepSection>
  )
}
