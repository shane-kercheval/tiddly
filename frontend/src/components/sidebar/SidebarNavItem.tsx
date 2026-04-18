/**
 * Individual navigation link item in the sidebar with optional hover actions.
 * Includes two-click confirmation for delete to prevent accidental deletions.
 */
import type { ReactNode } from 'react'
import { useConfirmDelete } from '../../hooks/useConfirmDelete'
import { PrefetchNavLink } from '../PrefetchLink'
import { EditIcon, TrashIcon } from '../icons'
import { Tooltip } from '../ui'

interface SidebarNavItemProps {
  to: string
  label: string
  isCollapsed: boolean
  onClick?: () => void
  icon?: ReactNode
  /** Rendered inline after the label when expanded; hidden when collapsed. */
  trailingIcon?: ReactNode
  /** When true, renders as a plain <a target="_blank"> instead of an in-app NavLink. */
  external?: boolean
  onEdit?: () => void
  onDelete?: () => void
}

export function SidebarNavItem({
  to,
  label,
  isCollapsed,
  onClick,
  icon,
  trailingIcon,
  external = false,
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

  const linkClassName = (isActive: boolean): string =>
    `flex w-full items-center gap-2 rounded-lg px-3 h-[32px] text-sm transition-colors ${
      isActive
        ? 'bg-gray-200 font-medium text-gray-900'
        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
    } ${isCollapsed ? 'justify-center' : ''}`

  const linkContent = (
    <>
      {icon && <span className="flex-shrink-0">{icon}</span>}
      <span className={`${isCollapsed ? 'sr-only' : 'flex-1 truncate min-w-0'}`}>{label}</span>
      {!isCollapsed && trailingIcon && <span className="flex-shrink-0">{trailingIcon}</span>}
    </>
  )

  const navLinkElement = external ? (
    <a
      href={to}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClick}
      className={linkClassName(false)}
    >
      {linkContent}
    </a>
  ) : (
    <PrefetchNavLink
      to={to}
      end
      onClick={onClick}
      className={({ isActive }) => linkClassName(isActive)}
    >
      {linkContent}
    </PrefetchNavLink>
  )

  return (
    <div className="group/item relative w-full min-w-0 overflow-hidden">
      {isCollapsed ? (
        <Tooltip content={label} compact position="right" className="w-full">
          {navLinkElement}
        </Tooltip>
      ) : navLinkElement}

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
              aria-label="Edit filter"
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
                  : 'text-gray-400 hover:text-red-600 hover:bg-red-50'
              }`}
              aria-label={isConfirmingDelete ? 'Click again to confirm' : 'Delete filter'}
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
