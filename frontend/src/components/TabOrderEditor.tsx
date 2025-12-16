/**
 * Tab order editor component for reordering tabs.
 * Uses up/down buttons for simple reordering without drag-and-drop library.
 */
import { useState, useEffect } from 'react'
import type { ReactNode } from 'react'
import type { TabOrderItem } from '../types'

interface TabOrderEditorProps {
  items: TabOrderItem[]
  isLoading: boolean
  onSave: (tabOrder: string[]) => Promise<void>
}

/** Up arrow icon */
const ChevronUpIcon = (): ReactNode => (
  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
  </svg>
)

/** Down arrow icon */
const ChevronDownIcon = (): ReactNode => (
  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
  </svg>
)

/** Grip icon for drag handle appearance */
const GripIcon = (): ReactNode => (
  <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
    <path d="M8 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm8-12a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0z" />
  </svg>
)

/**
 * Get icon for tab type.
 */
function getTabIcon(type: 'builtin' | 'list'): ReactNode {
  if (type === 'list') {
    return (
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
        />
      </svg>
    )
  }
  // Builtin icon
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"
      />
    </svg>
  )
}

/**
 * Tab order editor with up/down reordering.
 */
export function TabOrderEditor({ items, isLoading, onSave }: TabOrderEditorProps): ReactNode {
  const [localItems, setLocalItems] = useState<TabOrderItem[]>([])
  const [hasChanges, setHasChanges] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  // Sync local state with props
  useEffect(() => {
    setLocalItems(items)
    setHasChanges(false)
  }, [items])

  const moveItem = (index: number, direction: 'up' | 'down'): void => {
    const newIndex = direction === 'up' ? index - 1 : index + 1
    if (newIndex < 0 || newIndex >= localItems.length) return

    const newItems = [...localItems]
    const [removed] = newItems.splice(index, 1)
    newItems.splice(newIndex, 0, removed)
    setLocalItems(newItems)
    setHasChanges(true)
  }

  const handleSave = async (): Promise<void> => {
    setIsSaving(true)
    try {
      const tabOrder = localItems.map((item) => item.key)
      await onSave(tabOrder)
      setHasChanges(false)
    } finally {
      setIsSaving(false)
    }
  }

  const handleReset = (): void => {
    setLocalItems(items)
    setHasChanges(false)
  }

  if (isLoading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-4">
        <p className="text-sm text-gray-500">Loading tab order...</p>
      </div>
    )
  }

  if (localItems.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-4">
        <p className="text-sm text-gray-500">Using default tab order.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-gray-200 divide-y divide-gray-200">
        {localItems.map((item, index) => (
          <div
            key={item.key}
            className="flex items-center gap-3 p-3 hover:bg-gray-50/50 transition-colors"
          >
            {/* Grip icon (decorative) */}
            <span className="text-gray-300">
              <GripIcon />
            </span>

            {/* Tab info */}
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className="text-gray-400">
                {getTabIcon(item.type)}
              </span>
              <span className="font-medium text-gray-900 truncate">{item.label}</span>
              <span className="text-xs text-gray-400 shrink-0">
                ({item.type === 'builtin' ? 'built-in' : 'list'})
              </span>
            </div>

            {/* Reorder buttons */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => moveItem(index, 'up')}
                disabled={index === 0}
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                title="Move up"
              >
                <ChevronUpIcon />
              </button>
              <button
                type="button"
                onClick={() => moveItem(index, 'down')}
                disabled={index === localItems.length - 1}
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                title="Move down"
              >
                <ChevronDownIcon />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Save/Reset buttons */}
      {hasChanges && (
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={handleReset}
            className="btn-secondary"
            disabled={isSaving}
          >
            Reset
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="btn-primary"
            disabled={isSaving}
          >
            {isSaving ? 'Saving...' : 'Save Order'}
          </button>
        </div>
      )}

      <p className="text-xs text-gray-400">
        Use the arrows to reorder tabs. Changes are saved when you click "Save Order".
      </p>
    </div>
  )
}
