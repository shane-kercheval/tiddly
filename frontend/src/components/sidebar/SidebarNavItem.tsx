/**
 * Individual navigation link item in the sidebar with optional hover actions.
 * Includes two-click confirmation for delete to prevent accidental deletions.
 */
import { useState, useEffect, useRef } from 'react'
import { NavLink } from 'react-router-dom'
import type { ReactNode } from 'react'
import { EditIcon, TrashIcon } from '../icons'

interface SidebarNavItemProps {
  to: string
  label: string
  isCollapsed: boolean
  onClick?: () => void
  icon?: ReactNode
  onEdit?: () => void
  onDelete?: () => void
}

/** Timeout in ms before delete confirmation resets */
const DELETE_CONFIRM_TIMEOUT = 3000

export function SidebarNavItem({
  to,
  label,
  isCollapsed,
  onClick,
  icon,
  onEdit,
  onDelete,
}: SidebarNavItemProps): ReactNode {
  const hasActions = onEdit || onDelete
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)
  const timeoutRef = useRef<number | null>(null)
  const deleteButtonRef = useRef<HTMLButtonElement>(null)

  // Clear timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  // Reset confirmation when clicking outside
  useEffect(() => {
    if (!isConfirmingDelete) return

    const handleClickOutside = (e: MouseEvent): void => {
      if (deleteButtonRef.current && !deleteButtonRef.current.contains(e.target as Node)) {
        setIsConfirmingDelete(false)
        if (timeoutRef.current) {
          window.clearTimeout(timeoutRef.current)
        }
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isConfirmingDelete])

  const handleDeleteClick = (e: React.MouseEvent): void => {
    e.stopPropagation()
    e.preventDefault()

    if (isConfirmingDelete) {
      // Second click - execute delete
      setIsConfirmingDelete(false)
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current)
      }
      onDelete?.()
    } else {
      // First click - show confirmation
      setIsConfirmingDelete(true)
      timeoutRef.current = window.setTimeout(() => {
        setIsConfirmingDelete(false)
      }, DELETE_CONFIRM_TIMEOUT)
    }
  }

  return (
    <div className="group/item relative w-full min-w-0 overflow-hidden">
      <NavLink
        to={to}
        end
        onClick={onClick}
        className={({ isActive }) =>
          `flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
            isActive
              ? 'bg-gray-200 font-medium text-gray-900'
              : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
          } ${isCollapsed ? 'justify-center' : ''}`
        }
        title={isCollapsed ? label : undefined}
      >
        {icon && <span className="flex-shrink-0">{icon}</span>}
        <span className={`${isCollapsed ? 'sr-only' : 'flex-1 truncate min-w-0'}`}>{label}</span>
      </NavLink>

      {/* Hover actions - absolutely positioned with solid background */}
      {!isCollapsed && hasActions && (
        <div className={`absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 transition-opacity bg-white rounded shadow-sm ${isConfirmingDelete ? 'opacity-100' : 'opacity-0 group-hover/item:opacity-100'}`}>
          {onEdit && !isConfirmingDelete && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                e.preventDefault()
                onEdit()
              }}
              className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
              title="Edit list"
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
              title={isConfirmingDelete ? 'Click again to confirm' : 'Delete list'}
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
  )
}
