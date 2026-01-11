/**
 * Individual navigation link item in the sidebar with optional hover actions.
 * Includes two-click confirmation for delete to prevent accidental deletions.
 */
import { NavLink } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useConfirmDelete } from '../../hooks/useConfirmDelete'
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

  const {
    isConfirming: isConfirmingDelete,
    buttonRef: deleteButtonRef,
    handleClick: handleDeleteClick,
  } = useConfirmDelete({
    onConfirm: () => onDelete?.(),
  })

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

      {/* Hover actions - absolutely positioned with solid background, hidden on mobile */}
      {!isCollapsed && hasActions && (
        <div className={`absolute right-1 top-1/2 -translate-y-1/2 hidden md:flex items-center gap-0.5 transition-opacity bg-white rounded shadow-sm ${isConfirmingDelete ? 'opacity-100' : 'opacity-0 group-hover/item:opacity-100'}`}>
          {onEdit && !isConfirmingDelete && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                e.preventDefault()
                onEdit()
              }}
              className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
              title="Edit filter"
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
              title={isConfirmingDelete ? 'Click again to confirm' : 'Delete filter'}
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
