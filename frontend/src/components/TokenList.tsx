/**
 * Token list component for displaying and managing personal access tokens.
 */
import { useState } from 'react'
import type { ReactNode, FormEvent } from 'react'
import type { Token } from '../types'
import { formatRelativeDate } from '../utils'
import { PlusIcon, KeyIcon, EditIcon } from './icons'
import { ConfirmDeleteButton } from './ui'

export interface TokenEditingState {
  tokenId: string
  newName: string
  error: string | null
}

interface TokenListProps {
  tokens: Token[]
  isLoading: boolean
  editingState: TokenEditingState | null
  onStartEdit: (tokenId: string, currentName: string) => void
  onCancelEdit: () => void
  onSaveEdit: () => Promise<void>
  onEditChange: (value: string) => void
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
 * Token list with create button, inline rename, and delete functionality.
 */
export function TokenList({
  tokens,
  isLoading,
  editingState,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onEditChange,
  onDelete,
  onCreateClick,
}: TokenListProps): ReactNode {
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const handleDelete = async (tokenId: string): Promise<void> => {
    setDeletingId(tokenId)
    try {
      await onDelete(tokenId)
    } finally {
      setDeletingId(null)
    }
  }

  const handleSave = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setIsSaving(true)
    try {
      await onSaveEdit()
    } finally {
      setIsSaving(false)
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
        {tokens.map((token) => {
          const isEditing = editingState?.tokenId === token.id

          if (isEditing && editingState) {
            return (
              <div key={token.id} className="px-3 py-2.5">
                <form onSubmit={handleSave} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={editingState.newName}
                    onChange={(e) => onEditChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        e.preventDefault()
                        onCancelEdit()
                      }
                    }}
                    className={`flex-1 rounded border px-2 py-1 text-sm ${
                      editingState.error ? 'border-red-300' : 'border-gray-300'
                    } focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500`}
                    autoFocus
                    disabled={isSaving}
                  />
                  <button
                    disabled={isSaving || !!editingState.error}
                    className="rounded px-2 py-1 text-sm text-blue-600 hover:bg-blue-50 disabled:opacity-50"
                  >
                    {isSaving ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    onClick={onCancelEdit}
                    disabled={isSaving}
                    type="button"
                    className="rounded px-2 py-1 text-sm text-gray-500 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </form>
                {editingState.error && (
                  <p className="mt-1 text-xs text-red-500">{editingState.error}</p>
                )}
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
            )
          }

          return (
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
              <div className="flex items-center gap-1 ml-4">
                <button
                  onClick={() => onStartEdit(token.id, token.name)}
                  className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                  title="Rename token"
                >
                  <EditIcon />
                </button>
                <ConfirmDeleteButton
                  onConfirm={() => handleDelete(token.id)}
                  isDeleting={deletingId === token.id}
                  title="Delete token"
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
