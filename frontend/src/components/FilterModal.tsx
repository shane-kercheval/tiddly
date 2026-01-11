/**
 * Modal for creating and editing content filters.
 */
import { useState, useEffect } from 'react'
import type { ReactNode, FormEvent } from 'react'
import type { ContentFilter, ContentFilterCreate, ContentFilterUpdate, ContentType, FilterExpression, TagCount } from '../types'
import { BASE_SORT_OPTIONS, SORT_LABELS, type BaseSortOption } from '../constants/sortOptions'
import { FilterExpressionBuilder } from './FilterExpressionBuilder'
import { Modal } from './ui/Modal'
import { Tooltip } from './ui/Tooltip'
import { HelpIcon } from './icons'

interface FilterModalProps {
  isOpen: boolean
  onClose: () => void
  filter?: ContentFilter
  tagSuggestions: TagCount[]
  onCreate?: (data: ContentFilterCreate) => Promise<ContentFilter>
  onUpdate?: (id: string, data: ContentFilterUpdate) => Promise<ContentFilter>
}

/**
 * Create default empty filter expression.
 */
function createEmptyFilterExpression(): FilterExpression {
  return {
    groups: [{ tags: [], operator: 'AND' }],
    group_operator: 'OR',
  }
}

/**
 * Modal for creating/editing filters with filter expression builder.
 */
export function FilterModal({
  isOpen,
  onClose,
  filter,
  tagSuggestions,
  onCreate,
  onUpdate,
}: FilterModalProps): ReactNode {
  const [name, setName] = useState('')
  const [contentTypes, setContentTypes] = useState<ContentType[]>(['bookmark', 'note'])
  const [filterExpression, setFilterExpression] = useState<FilterExpression>(createEmptyFilterExpression())
  const [defaultSortBy, setDefaultSortBy] = useState<BaseSortOption | null>(null)
  const [defaultSortAscending, setDefaultSortAscending] = useState<boolean>(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isEditing = !!filter

  // Reset/populate form when modal opens
  // Note: Focus management is handled by the shared Modal component
  useEffect(() => {
    if (isOpen) {
      if (filter) {
        setName(filter.name)
        setContentTypes(filter.content_types)
        setFilterExpression(filter.filter_expression)
        setDefaultSortBy((filter.default_sort_by as BaseSortOption) || null)
        setDefaultSortAscending(filter.default_sort_ascending ?? false)
      } else {
        setName('')
        setContentTypes(['bookmark', 'note'])  // Default to all types for new filters
        setFilterExpression(createEmptyFilterExpression())
        setDefaultSortBy(null)
        setDefaultSortAscending(false)
      }
      setError(null)
    }
  }, [isOpen, filter])

  const toggleContentType = (type: ContentType): void => {
    setContentTypes((prev) => {
      if (prev.includes(type)) {
        // Don't allow removing the last content type
        if (prev.length === 1) return prev
        return prev.filter((t) => t !== type)
      }
      return [...prev, type]
    })
  }

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()

    if (!name.trim()) {
      setError('Filter name is required')
      return
    }

    if (contentTypes.length === 0) {
      setError('At least one content type must be selected')
      return
    }

    // Clean up filter expression - remove empty groups
    const cleanedExpression: FilterExpression = {
      ...filterExpression,
      groups: filterExpression.groups.filter((g) => g.tags && g.tags.length > 0),
    }

    setIsSubmitting(true)
    setError(null)

    try {
      if (isEditing && onUpdate && filter) {
        await onUpdate(filter.id, {
          name: name.trim(),
          content_types: contentTypes,
          filter_expression: cleanedExpression,
          default_sort_by: defaultSortBy,
          default_sort_ascending: defaultSortBy ? defaultSortAscending : null,
        })
      } else if (onCreate) {
        await onCreate({
          name: name.trim(),
          content_types: contentTypes,
          filter_expression: cleanedExpression,
          default_sort_by: defaultSortBy,
          default_sort_ascending: defaultSortBy ? defaultSortAscending : null,
        })
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save filter')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        <span className="inline-flex items-center gap-2">
          {isEditing ? 'Edit Filter' : 'Create Filter'}
          <Tooltip content="Filters define which content to show based on tags and content types. Use Collections to organize filters in the sidebar.">
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

        <div>
          <label htmlFor="filter-name" className="block text-sm font-medium text-gray-700 mb-1">
            Filter Name
          </label>
          <input
            id="filter-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Work Resources, Reading List"
            className="input"
            disabled={isSubmitting}
          />
        </div>

        <div>
          <span className="block text-sm font-medium text-gray-700 mb-2">
            Content Types
          </span>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={contentTypes.includes('bookmark')}
                onChange={() => toggleContentType('bookmark')}
                className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900/10"
                disabled={isSubmitting || (contentTypes.length === 1 && contentTypes.includes('bookmark'))}
              />
              Bookmarks
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={contentTypes.includes('note')}
                onChange={() => toggleContentType('note')}
                className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900/10"
                disabled={isSubmitting || (contentTypes.length === 1 && contentTypes.includes('note'))}
              />
              Notes
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={contentTypes.includes('prompt')}
                onChange={() => toggleContentType('prompt')}
                className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900/10"
                disabled={isSubmitting || (contentTypes.length === 1 && contentTypes.includes('prompt'))}
              />
              Prompts
            </label>
          </div>
          <p className="mt-1 text-xs text-gray-400">
            Select which content types this filter includes.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Filter Tags
          </label>
          <FilterExpressionBuilder
            value={filterExpression}
            onChange={setFilterExpression}
            tagSuggestions={tagSuggestions}
          />
        </div>

        <div>
          <label htmlFor="filter-sort" className="block text-sm font-medium text-gray-700 mb-1">
            Default Sort
          </label>
          <div className="flex items-center gap-3">
            <select
              id="filter-sort"
              value={defaultSortBy ?? ''}
              onChange={(e) => {
                const value = e.target.value as BaseSortOption | ''
                setDefaultSortBy(value || null)
                if (!value) {
                  setDefaultSortAscending(false)
                }
              }}
              className="appearance-none cursor-pointer flex-1 rounded-lg border border-gray-200 bg-gray-50/50 px-3 py-2 pr-8 text-sm focus:border-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-900/5 bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2020%2020%22%3E%3Cpath%20stroke%3D%22%236b7280%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20stroke-width%3D%221.5%22%20d%3D%22m6%208%204%204%204-4%22%2F%3E%3C%2Fsvg%3E')] bg-[length:1.25rem_1.25rem] bg-[right_0.5rem_center] bg-no-repeat"
              disabled={isSubmitting}
            >
              <option value="">System default (Last Used)</option>
              {BASE_SORT_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {SORT_LABELS[option]}
                </option>
              ))}
            </select>
            {defaultSortBy && (
              <label className="flex items-center gap-2 text-sm text-gray-600">
                <input
                  type="checkbox"
                  checked={defaultSortAscending}
                  onChange={(e) => setDefaultSortAscending(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900/10"
                  disabled={isSubmitting}
                />
                Ascending
              </label>
            )}
          </div>
        </div>

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
            {isSubmitting ? 'Saving...' : isEditing ? 'Save' : 'Create Filter'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
