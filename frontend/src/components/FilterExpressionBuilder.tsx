/**
 * Filter expression builder component.
 * Allows building filter expressions with AND groups combined by OR.
 */
import { useState, useCallback } from 'react'
import type { ReactNode, KeyboardEvent } from 'react'
import type { FilterExpression, FilterGroup, TagCount } from '../types'

interface FilterExpressionBuilderProps {
  value: FilterExpression
  onChange: (value: FilterExpression) => void
  tagSuggestions: TagCount[]
}

/** Plus icon */
const PlusIcon = (): ReactNode => (
  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
  </svg>
)

/** Close icon */
const CloseIcon = (): ReactNode => (
  <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
    <path
      fillRule="evenodd"
      d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
      clipRule="evenodd"
    />
  </svg>
)

interface GroupEditorProps {
  group: FilterGroup
  groupIndex: number
  tagSuggestions: TagCount[]
  onUpdate: (tags: string[]) => void
  onRemove: () => void
  canRemove: boolean
}

/**
 * Editor for a single AND group.
 */
function GroupEditor({
  group,
  groupIndex,
  tagSuggestions,
  onUpdate,
  onRemove,
  canRemove,
}: GroupEditorProps): ReactNode {
  const [inputValue, setInputValue] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)

  // Filter suggestions based on input and exclude already selected tags
  const filteredSuggestions = tagSuggestions.filter(
    (tag) =>
      tag.name.toLowerCase().includes(inputValue.toLowerCase()) &&
      !group.tags.includes(tag.name)
  )

  const addTag = useCallback(
    (tag: string): void => {
      const normalizedTag = tag.toLowerCase().trim()
      if (normalizedTag && !group.tags.includes(normalizedTag)) {
        onUpdate([...group.tags, normalizedTag])
      }
      setInputValue('')
      setShowSuggestions(false)
    },
    [group.tags, onUpdate]
  )

  const removeTag = useCallback(
    (tagToRemove: string): void => {
      onUpdate(group.tags.filter((t) => t !== tagToRemove))
    },
    [group.tags, onUpdate]
  )

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' && inputValue.trim()) {
      e.preventDefault()
      addTag(inputValue)
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-gray-500 uppercase">
          Group {groupIndex + 1} (AND)
        </span>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="text-xs text-gray-400 hover:text-red-500 transition-colors"
          >
            Remove group
          </button>
        )}
      </div>

      {/* Selected tags */}
      <div className="flex flex-wrap gap-1.5 mb-2">
        {group.tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-sm text-blue-700"
          >
            {tag}
            <button
              type="button"
              onClick={() => removeTag(tag)}
              className="hover:text-blue-900 transition-colors"
            >
              <CloseIcon />
            </button>
          </span>
        ))}
        {group.tags.length === 0 && (
          <span className="text-sm text-gray-400">No tags selected</span>
        )}
      </div>

      {/* Tag input */}
      <div className="relative">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value)
            setShowSuggestions(true)
          }}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => {
            // Delay to allow click on suggestion
            setTimeout(() => setShowSuggestions(false), 150)
          }}
          onKeyDown={handleKeyDown}
          placeholder="Add tag..."
          className="w-full rounded border border-gray-200 px-2 py-1.5 text-sm focus:border-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-900/5"
        />

        {/* Suggestions dropdown */}
        {showSuggestions && filteredSuggestions.length > 0 && (
          <div className="absolute z-10 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg max-h-40 overflow-auto">
            {filteredSuggestions.slice(0, 10).map((tag) => (
              <button
                key={tag.name}
                type="button"
                onClick={() => addTag(tag.name)}
                className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex items-center justify-between"
              >
                <span>{tag.name}</span>
                <span className="text-xs text-gray-400">{tag.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Filter expression builder for creating (a AND b) OR (c AND d) filters.
 */
export function FilterExpressionBuilder({
  value,
  onChange,
  tagSuggestions,
}: FilterExpressionBuilderProps): ReactNode {
  const updateGroup = useCallback(
    (groupIndex: number, tags: string[]): void => {
      const newGroups = [...value.groups]
      newGroups[groupIndex] = { ...newGroups[groupIndex], tags }
      onChange({ ...value, groups: newGroups })
    },
    [value, onChange]
  )

  const removeGroup = useCallback(
    (groupIndex: number): void => {
      const newGroups = value.groups.filter((_, i) => i !== groupIndex)
      onChange({ ...value, groups: newGroups })
    },
    [value, onChange]
  )

  const addGroup = useCallback((): void => {
    const newGroup: FilterGroup = { tags: [], operator: 'AND' }
    onChange({ ...value, groups: [...value.groups, newGroup] })
  }, [value, onChange])

  return (
    <div className="space-y-3">
      {value.groups.map((group, index) => (
        <div key={index}>
          {index > 0 && (
            <div className="flex items-center justify-center my-2">
              <span className="px-2 py-0.5 text-xs font-medium text-gray-500 bg-gray-100 rounded">
                OR
              </span>
            </div>
          )}
          <GroupEditor
            group={group}
            groupIndex={index}
            tagSuggestions={tagSuggestions}
            onUpdate={(tags) => updateGroup(index, tags)}
            onRemove={() => removeGroup(index)}
            canRemove={value.groups.length > 1}
          />
        </div>
      ))}

      <button
        type="button"
        onClick={addGroup}
        className="w-full rounded-lg border border-dashed border-gray-300 py-2 text-sm text-gray-500 hover:border-gray-400 hover:text-gray-600 transition-colors flex items-center justify-center gap-1.5"
      >
        <PlusIcon />
        Add OR group
      </button>

      <p className="text-xs text-gray-400">
        Tags within a group are matched with AND. Groups are combined with OR.
      </p>
    </div>
  )
}
