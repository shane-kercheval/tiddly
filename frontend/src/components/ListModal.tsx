/**
 * Modal for creating and editing bookmark lists.
 */
import { useState, useEffect, useRef } from 'react'
import type { ReactNode, FormEvent } from 'react'
import type { BookmarkList, BookmarkListCreate, BookmarkListUpdate, FilterExpression, TagCount } from '../types'
import { FilterExpressionBuilder } from './FilterExpressionBuilder'

interface ListModalProps {
  isOpen: boolean
  onClose: () => void
  list?: BookmarkList
  tagSuggestions: TagCount[]
  onCreate?: (data: BookmarkListCreate) => Promise<BookmarkList>
  onUpdate?: (id: number, data: BookmarkListUpdate) => Promise<BookmarkList>
}

/** Close icon */
const CloseIcon = (): ReactNode => (
  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
)

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
 * Modal for creating/editing lists with filter expression builder.
 */
export function ListModal({
  isOpen,
  onClose,
  list,
  tagSuggestions,
  onCreate,
  onUpdate,
}: ListModalProps): ReactNode {
  const [name, setName] = useState('')
  const [filterExpression, setFilterExpression] = useState<FilterExpression>(createEmptyFilterExpression())
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  const isEditing = !!list

  // Reset/populate form when modal opens
  useEffect(() => {
    if (isOpen) {
      if (list) {
        setName(list.name)
        setFilterExpression(list.filter_expression)
      } else {
        setName('')
        setFilterExpression(createEmptyFilterExpression())
      }
      setError(null)
      setTimeout(() => nameInputRef.current?.focus(), 100)
    }
  }, [isOpen, list])

  const validateFilterExpression = (expr: FilterExpression): boolean => {
    // At least one group must have at least one tag
    return expr.groups.some((group) => group.tags && group.tags.length > 0)
  }

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()

    if (!name.trim()) {
      setError('List name is required')
      return
    }

    if (!validateFilterExpression(filterExpression)) {
      setError('At least one tag filter is required')
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
      if (isEditing && onUpdate && list) {
        await onUpdate(list.id, {
          name: name.trim(),
          filter_expression: cleanedExpression,
        })
      } else if (onCreate) {
        await onCreate({
          name: name.trim(),
          filter_expression: cleanedExpression,
        })
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save list')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/20 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative flex min-h-full items-center justify-center p-4">
        <div className="relative w-full max-w-lg rounded-xl bg-white shadow-xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
            <h2 className="text-lg font-semibold text-gray-900">
              {isEditing ? 'Edit List' : 'Create List'}
            </h2>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
            >
              <CloseIcon />
            </button>
          </div>

          {/* Content */}
          <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 p-3">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            <div>
              <label htmlFor="list-name" className="block text-sm font-medium text-gray-700 mb-1">
                List Name
              </label>
              <input
                ref={nameInputRef}
                id="list-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Work Resources, Reading List"
                className="input"
                disabled={isSubmitting}
              />
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
                {isSubmitting ? 'Saving...' : isEditing ? 'Save Changes' : 'Create List'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
