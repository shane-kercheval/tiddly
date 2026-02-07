/**
 * Token list component for displaying and managing personal access tokens.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { Token } from '../types'
import { formatRelativeDate } from '../utils'
import { PlusIcon, KeyIcon } from './icons'
import { ConfirmDeleteButton } from './ui'

interface TokenListProps {
  tokens: Token[]
  isLoading: boolean
  onDelete: (id: string) => Promise<void>
  onCreateClick: () => void
}

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
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const handleDelete = async (tokenId: string): Promise<void> => {
    setDeletingId(tokenId)
    try {
      await onDelete(tokenId)
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
            className="flex items-center justify-between px-3 py-2.5 list-item-hover"
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
            <ConfirmDeleteButton
              onConfirm={() => handleDelete(token.id)}
              isDeleting={deletingId === token.id}
              title="Delete token"
              className="ml-4"
            />
          </div>
        ))}
      </div>
    </div>
  )
}
