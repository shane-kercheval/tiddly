/**
 * Token list component for displaying and managing personal access tokens.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { Token } from '../types'
import { formatRelativeDate } from '../utils'

interface TokenListProps {
  tokens: Token[]
  isLoading: boolean
  onDelete: (id: number) => Promise<void>
  onCreateClick: () => void
}

/** Plus icon */
const PlusIcon = (): ReactNode => (
  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
  </svg>
)

/** Trash icon */
const TrashIcon = (): ReactNode => (
  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
    />
  </svg>
)

/** Key icon for empty state */
const KeyIcon = (): ReactNode => (
  <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.5}
      d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
    />
  </svg>
)

/**
 * Format expiry date for display.
 */
function formatExpiry(expiresAt: string | null): string {
  if (!expiresAt) return 'Never'
  const date = new Date(expiresAt)
  const now = new Date()
  if (date < now) return 'Expired'
  return formatRelativeDate(expiresAt)
}

/**
 * Check if token is expired.
 */
function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false
  return new Date(expiresAt) < new Date()
}

/**
 * Token list with create button and delete functionality.
 */
export function TokenList({ tokens, isLoading, onDelete, onCreateClick }: TokenListProps): ReactNode {
  const [deletingId, setDeletingId] = useState<number | null>(null)

  const handleDelete = async (token: Token): Promise<void> => {
    if (!confirm(`Delete token "${token.name}"? This action cannot be undone.`)) {
      return
    }

    setDeletingId(token.id)
    try {
      await onDelete(token.id)
    } finally {
      setDeletingId(null)
    }
  }

  if (isLoading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-4">
        <p className="text-sm text-gray-500">Loading tokens...</p>
      </div>
    )
  }

  if (tokens.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-8 text-center">
        <div className="mx-auto mb-3 text-gray-300">
          <KeyIcon />
        </div>
        <p className="text-sm text-gray-500 mb-4">
          No tokens created yet. Create a token for API access.
        </p>
        <button onClick={onCreateClick} className="btn-primary inline-flex items-center gap-2">
          <PlusIcon />
          Create Token
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button onClick={onCreateClick} className="btn-primary inline-flex items-center gap-2">
          <PlusIcon />
          Create Token
        </button>
      </div>

      <div className="rounded-lg border border-gray-200 divide-y divide-gray-200">
        {tokens.map((token) => (
          <div
            key={token.id}
            className="flex items-center justify-between p-4 hover:bg-gray-50/50 transition-colors"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-900">{token.name}</span>
                {isExpired(token.expires_at) && (
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">
                    Expired
                  </span>
                )}
              </div>
              <div className="mt-1 flex items-center gap-4 text-xs text-gray-500">
                <span className="font-mono">{token.token_prefix}...</span>
                <span>Created {formatRelativeDate(token.created_at)}</span>
                {token.last_used_at ? (
                  <span>Last used {formatRelativeDate(token.last_used_at)}</span>
                ) : (
                  <span>Never used</span>
                )}
                <span>Expires: {formatExpiry(token.expires_at)}</span>
              </div>
            </div>
            <button
              onClick={() => handleDelete(token)}
              disabled={deletingId === token.id}
              className="ml-4 p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
              title="Delete token"
            >
              <TrashIcon />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
