/**
 * Modal for creating and editing sidebar collections.
 *
 * Collections group filters together in the sidebar for better organization.
 * Filter selection is optional - users can create empty collections and add
 * filters later via drag-and-drop.
 */
import { useState, useEffect, useMemo } from 'react'
import type { ReactNode, FormEvent } from 'react'
import type { ContentFilter, SidebarCollectionComputed, SidebarFilterItemComputed } from '../types'
import { Modal } from './ui/Modal'
import { Tooltip } from './ui/Tooltip'
import { HelpIcon } from './icons'

interface CollectionModalProps {
  isOpen: boolean
  onClose: () => void
  /** For editing an existing collection */
  collection?: SidebarCollectionComputed
  /** Filters available for selection (should exclude filters already in other collections) */
  availableFilters: ContentFilter[]
  /** Called when creating a new collection */
  onCreate?: (name: string, filterIds: string[]) => Promise<void>
  /** Called when updating an existing collection */
  onUpdate?: (id: string, name: string, filterIds: string[]) => Promise<void>
}

/**
 * Modal for creating/editing collections with optional filter selection.
 */
export function CollectionModal({
  isOpen,
  onClose,
  collection,
  availableFilters,
  onCreate,
  onUpdate,
}: CollectionModalProps): ReactNode {
  const [name, setName] = useState('')
  const [selectedFilterIds, setSelectedFilterIds] = useState<string[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isEditing = !!collection

  // Initialize state when modal opens
  useEffect(() => {
    if (isOpen) {
      if (collection) {
        setName(collection.name)
        // Extract filter IDs from collection items, preserving order
        const filterIds = collection.items
          .filter((item): item is SidebarFilterItemComputed => item.type === 'filter')
          .map((item) => item.id)
        setSelectedFilterIds(filterIds)
      } else {
        setName('')
        setSelectedFilterIds([])
      }
      setError(null)
    }
  }, [isOpen, collection])

  const handleAddFilter = (filterId: string): void => {
    if (!selectedFilterIds.includes(filterId)) {
      setSelectedFilterIds((prev) => [...prev, filterId]) // Maintains selection order
    }
  }

  const handleRemoveFilter = (filterId: string): void => {
    setSelectedFilterIds((prev) => prev.filter((id) => id !== filterId))
  }

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()

    if (!name.trim()) {
      setError('Collection name is required')
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      if (isEditing && onUpdate && collection) {
        await onUpdate(collection.id, name.trim(), selectedFilterIds)
      } else if (onCreate) {
        await onCreate(name.trim(), selectedFilterIds)
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save collection')
    } finally {
      setIsSubmitting(false)
    }
  }

  // Get filter objects for selected IDs (maintaining order)
  // Include filters that are in the current collection being edited
  const selectedFilters = useMemo(() => {
    return selectedFilterIds
      .map((id) => availableFilters.find((f) => f.id === id))
      .filter((f): f is ContentFilter => f !== undefined)
  }, [selectedFilterIds, availableFilters])

  // Get filters not yet selected
  const unselectedFilters = useMemo(() => {
    return availableFilters.filter((f) => !selectedFilterIds.includes(f.id))
  }, [availableFilters, selectedFilterIds])

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        <span className="inline-flex items-center gap-2">
          {isEditing ? 'Edit Collection' : 'Create Collection'}
          <Tooltip content="Collections group your filters together in the sidebar for better organization. You can drag/drop filters into and out of collections later.">
            <HelpIcon className="h-4 w-4 text-gray-400 hover:text-gray-600 cursor-help" />
          </Tooltip>
        </span>
      }
      noPadding
    >
      <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 p-3">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Collection Name */}
        <div>
          <label htmlFor="collection-name" className="block text-sm font-medium text-gray-700 mb-1">
            Collection Name
          </label>
          <input
            id="collection-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Work, Personal, Projects"
            className="input"
            disabled={isSubmitting}
          />
        </div>

        {/* Selected Filters */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Filters in Collection
          </label>
          {selectedFilters.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {selectedFilters.map((filter) => (
                <span
                  key={filter.id}
                  className="chip"
                >
                  {filter.name}
                  <button
                    type="button"
                    onClick={() => handleRemoveFilter(filter.id)}
                    className="text-gray-400 hover:text-red-500 ml-0.5"
                    disabled={isSubmitting}
                    aria-label={`Remove ${filter.name}`}
                  >
                    &times;
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400 italic">Select filters from below to add to this collection.</p>
          )}
        </div>

        {/* Available Filters to Add */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Add Filters
          </label>
          {unselectedFilters.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {unselectedFilters.map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  onClick={() => handleAddFilter(filter.id)}
                  className="chip-selectable"
                  disabled={isSubmitting}
                >
                  + {filter.name}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400 italic">
              {availableFilters.length === 0
                ? 'No filters available. Create filters first, then add them to collections.'
                : 'All available filters have been added to this collection.'}
            </p>
          )}
        </div>

        {/* Submit buttons */}
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary flex-1"
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn-primary flex-1"
            disabled={isSubmitting || !name.trim()}
          >
            {isSubmitting ? 'Saving...' : isEditing ? 'Save' : 'Create Collection'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
