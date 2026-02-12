/**
 * AddRelationshipModal - Modal for searching and linking content.
 *
 * Uses the unified GET /content/ endpoint to search across all content types.
 * Filters out the current item and already-linked items from results.
 */
import { useState, useMemo } from 'react'
import type { ReactNode } from 'react'
import { Modal } from './ui/Modal'
import { SearchIcon } from './icons'
import { CONTENT_TYPE_ICONS, CONTENT_TYPE_LABELS, CONTENT_TYPE_ICON_COLORS } from '../constants/contentTypeStyles'
import { useContentQuery } from '../hooks/useContentQuery'
import { useContentRelationships, useRelationshipMutations } from '../hooks/useRelationships'
import { getLinkedItem } from '../utils/relationships'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import type { ContentType, ContentListItem } from '../types'

interface AddRelationshipModalProps {
  isOpen: boolean
  onClose: () => void
  sourceType: ContentType
  sourceId: string
  onSuccess?: () => void
}

export function AddRelationshipModal({
  isOpen,
  onClose,
  sourceType,
  sourceId,
  onSuccess,
}: AddRelationshipModalProps): ReactNode {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedItem, setSelectedItem] = useState<ContentListItem | null>(null)
  const [description, setDescription] = useState('')
  const [submitError, setSubmitError] = useState<string | null>(null)

  const debouncedQuery = useDebouncedValue(searchQuery, 300)

  // Fetch existing relationships to filter already-linked items from results
  const { data: relationshipsData } = useContentRelationships(sourceType, sourceId)
  const existingLinkedKeys = useMemo(() => {
    if (!relationshipsData?.items) return new Set<string>()
    const keys = new Set<string>()
    for (const rel of relationshipsData.items) {
      const linked = getLinkedItem(rel, sourceType, sourceId)
      keys.add(`${linked.type}:${linked.id}`)
    }
    return keys
  }, [relationshipsData, sourceType, sourceId])

  // Search across all content types
  const { data: searchResults, isFetching } = useContentQuery(
    {
      q: debouncedQuery,
      limit: 20,
      view: 'active',
    },
    { enabled: isOpen && debouncedQuery.length >= 1 },
  )

  // Filter out current item and already-linked items
  const filteredResults = (searchResults?.items ?? []).filter((item) => {
    if (item.type === sourceType && item.id === sourceId) return false
    if (existingLinkedKeys.has(`${item.type}:${item.id}`)) return false
    return true
  })

  const { create } = useRelationshipMutations()

  async function handleSubmit(): Promise<void> {
    if (!selectedItem) return
    setSubmitError(null)
    try {
      await create.mutateAsync({
        source_type: sourceType,
        source_id: sourceId,
        target_type: selectedItem.type,
        target_id: selectedItem.id,
        relationship_type: 'related',
        description: description.trim() || null,
      })
      onSuccess?.()
      onClose()
    } catch {
      setSubmitError('Failed to create link. Please try again.')
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Link Content">
      <div className="space-y-4">
        {/* Search input */}
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
            <SearchIcon className="h-4 w-4" />
          </span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value)
              setSelectedItem(null)
              setSubmitError(null)
            }}
            placeholder="Search bookmarks, notes, prompts..."
            className="input pl-9"
            autoFocus
          />
        </div>

        {/* Search results */}
        {debouncedQuery.length >= 1 && (
          <div className="max-h-60 overflow-y-auto border border-gray-200 rounded-lg">
            {isFetching && filteredResults.length === 0 && (
              <p className="text-sm text-gray-400 py-6 text-center">Searching...</p>
            )}

            {!isFetching && filteredResults.length === 0 && (
              <p className="text-sm text-gray-400 py-6 text-center">No results found.</p>
            )}

            {filteredResults.length > 0 && (
              <ul role="listbox" aria-label="Search results">
                {filteredResults.map((item) => {
                  const Icon = CONTENT_TYPE_ICONS[item.type]
                  const iconColor = CONTENT_TYPE_ICON_COLORS[item.type]
                  const isSelected = selectedItem?.id === item.id && selectedItem?.type === item.type
                  const displayTitle = item.title ?? 'Untitled'
                  const typeLabel = CONTENT_TYPE_LABELS[item.type]

                  return (
                    <li
                      key={`${item.type}-${item.id}`}
                      role="option"
                      aria-selected={isSelected}
                      className={`flex items-start gap-2.5 px-3 py-2 cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-blue-50 border-l-2 border-l-blue-500'
                          : 'hover:bg-gray-50 border-l-2 border-l-transparent'
                      }`}
                      onClick={() => {
                        setSelectedItem(item)
                        setSubmitError(null)
                      }}
                    >
                      <span className={`mt-0.5 shrink-0 ${iconColor}`} title={typeLabel}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm text-gray-700 truncate block">
                          {displayTitle}
                        </span>
                        {item.description && (
                          <p className="text-xs text-gray-400 truncate mt-0.5">
                            {item.description}
                          </p>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )}

        {/* Selected item indicator */}
        {selectedItem && (
          <div className="flex items-center gap-2 text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-2">
            <span className={`shrink-0 ${CONTENT_TYPE_ICON_COLORS[selectedItem.type]}`}>
              {(() => {
                const Icon = CONTENT_TYPE_ICONS[selectedItem.type]
                return <Icon className="h-4 w-4" />
              })()}
            </span>
            <span className="truncate font-medium">
              {selectedItem.title ?? 'Untitled'}
            </span>
          </div>
        )}

        {/* Description field */}
        <div>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Why are these linked? (optional)"
            className="input min-h-[60px] resize-y"
            rows={2}
            maxLength={500}
          />
        </div>

        {/* Error message */}
        {submitError && (
          <p className="text-sm text-red-500">{submitError}</p>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!selectedItem || create.isPending}
            className="btn-primary"
          >
            {create.isPending ? 'Linking...' : 'Link'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
