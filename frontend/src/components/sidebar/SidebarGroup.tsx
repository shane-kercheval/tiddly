/**
 * Collapsible group in the sidebar with inline editing support.
 * Includes two-click confirmation for delete to prevent accidental deletions.
 */
import { useState, useRef, useEffect } from 'react'
import type { ReactNode, KeyboardEvent } from 'react'
import { useConfirmDelete } from '../../hooks/useConfirmDelete'
import { EditIcon, TrashIcon } from '../icons'

interface SidebarGroupProps {
  name: string
  icon?: ReactNode // Optional - only used when sidebar is collapsed
  isCollapsed: boolean
  isGroupCollapsed: boolean
  onToggle: () => void
  onRename?: (newName: string) => void
  onDelete?: () => void
  children: ReactNode
}

function ChevronIcon({ isExpanded }: { isExpanded: boolean }): ReactNode {
  return (
    <svg
      className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  )
}

export function SidebarGroup({
  name,
  icon,
  isCollapsed,
  isGroupCollapsed,
  onToggle,
  onRename,
  onDelete,
  children,
}: SidebarGroupProps): ReactNode {
  const isExpanded = !isGroupCollapsed
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState(name)
  const inputRef = useRef<HTMLInputElement>(null)

  const {
    isConfirming: isConfirmingDelete,
    buttonRef: deleteButtonRef,
    handleClick: handleDeleteClick,
  } = useConfirmDelete({
    onConfirm: () => onDelete?.(),
  })

  // Focus input when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const handleSave = (): void => {
    const trimmedName = editName.trim()
    if (trimmedName && trimmedName !== name && onRename) {
      onRename(trimmedName)
    } else {
      setEditName(name) // Reset to original if empty or unchanged
    }
    setIsEditing(false)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      handleSave()
    } else if (e.key === 'Escape') {
      setEditName(name)
      setIsEditing(false)
    }
  }

  const baseClassName = `flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-gray-700 ${
    isCollapsed ? 'justify-center' : ''
  }`

  // If sidebar is collapsed, render minimal version
  if (isCollapsed) {
    return (
      <div className="mb-2">
        <button
          onClick={onToggle}
          type="button"
          className={`${baseClassName} cursor-pointer transition-colors hover:bg-gray-50`}
          title={name}
        >
          <span className="h-5 w-5 flex-shrink-0">{icon}</span>
        </button>
      </div>
    )
  }

  return (
    <div className="mb-2">
      {/* Group header with relative positioning for absolute icons */}
      <div className="group/section relative w-full">
        <button
          onClick={onToggle}
          type="button"
          className={`${baseClassName} cursor-pointer transition-colors hover:bg-gray-50 w-full min-w-0`}
        >
          {/* Chevron on the left */}
          <ChevronIcon isExpanded={isExpanded} />
          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={handleSave}
              onKeyDown={handleKeyDown}
              onClick={(e) => e.stopPropagation()}
              className="flex-1 min-w-0 bg-white border border-gray-300 rounded px-1 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400"
            />
          ) : (
            <span className="flex-1 text-left truncate min-w-0">{name}</span>
          )}
        </button>

        {/* Hover actions - absolutely positioned with solid background, hidden on mobile */}
        {!isEditing && (onRename || onDelete) && (
          <div className={`absolute right-1 top-1/2 -translate-y-1/2 hidden md:flex items-center gap-0.5 transition-opacity bg-white rounded shadow-sm ${isConfirmingDelete ? 'opacity-100' : 'opacity-0 group-hover/section:opacity-100'}`}>
            {onRename && !isConfirmingDelete && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setIsEditing(true)
                }}
                className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
                title="Rename group"
              >
                <EditIcon className="h-3.5 w-3.5" />
              </button>
            )}
            {onDelete && (
              <button
                ref={deleteButtonRef}
                type="button"
                onClick={handleDeleteClick}
                className={`p-1 rounded transition-colors ${
                  isConfirmingDelete
                    ? 'bg-red-100 text-red-600 hover:bg-red-200 px-2'
                    : 'text-gray-400 hover:text-red-500 hover:bg-gray-100'
                }`}
                title={isConfirmingDelete ? 'Click again to confirm' : 'Delete group'}
              >
                {isConfirmingDelete ? (
                  <span className="text-xs font-medium whitespace-nowrap">Delete?</span>
                ) : (
                  <TrashIcon className="h-3.5 w-3.5" />
                )}
              </button>
            )}
          </div>
        )}
      </div>

      {isExpanded && (
        <div className="ml-4 mt-1 space-y-1 border-l border-gray-200 pl-2">
          {children}
        </div>
      )}
    </div>
  )
}
