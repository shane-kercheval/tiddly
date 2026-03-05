/**
 * Sortable wrapper for sidebar navigation items.
 * Provides drag-and-drop functionality for reordering items in the sidebar.
 */
import type { ReactNode } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { SidebarNavItem } from './SidebarNavItem'
import { getBuiltinRoute, getFilterRoute } from './routes'
import { getItemId, getBuiltinIcon, getFilterIcon } from './sidebarDndUtils'
import { GripIcon } from '../icons'
import { Tooltip } from '../ui'
import {
  isNavigableBuiltin,
} from '../../types'
import type {
  SidebarBuiltinItemComputed,
  SidebarFilterItemComputed,
} from '../../types'

export interface SortableNavItemProps {
  item: SidebarBuiltinItemComputed | SidebarFilterItemComputed
  isCollapsed: boolean
  onNavClick?: () => void
  onEdit?: () => void
  onDelete?: () => void
  isDragging?: boolean
  onAction?: () => void
  shortcut?: string
}

/**
 * A sortable navigation item for the root level of the sidebar.
 */
export function SortableNavItem({
  item,
  isCollapsed,
  onNavClick,
  onEdit,
  onDelete,
  isDragging,
  onAction,
  shortcut,
}: SortableNavItemProps): ReactNode {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: getItemId(item),
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const icon =
    item.type === 'builtin'
      ? getBuiltinIcon(item.key)
      : getFilterIcon(item.content_types)

  const route =
    item.type === 'filter'
      ? getFilterRoute(item.id)
      : isNavigableBuiltin(item.key)
        ? getBuiltinRoute(item.key)
        : null

  const navItem = onAction ? (
    <button
      onClick={() => { onAction(); onNavClick?.() }}
      className={`flex w-full items-center gap-2 rounded-lg px-3 h-[32px] text-sm text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 focus:outline-none min-w-0 ${isCollapsed ? 'justify-center' : ''}`}
    >
      <span className="flex-shrink-0">{icon}</span>
      {!isCollapsed && (
        <>
          <span className="flex-1 truncate min-w-0 text-left">{item.name}</span>
          {shortcut && <kbd className="text-[11px] text-gray-400 font-sans flex-shrink-0">{shortcut}</kbd>}
        </>
      )}
    </button>
  ) : route ? (
    <SidebarNavItem
      to={route}
      label={item.name}
      icon={icon}
      isCollapsed={isCollapsed}
      onClick={onNavClick}
      onEdit={item.type === 'filter' ? onEdit : undefined}
      onDelete={item.type === 'filter' ? onDelete : undefined}
    />
  ) : null

  if (!navItem) return null

  return (
    <div ref={setNodeRef} style={style} className="group/item flex w-full items-center min-w-0 overflow-hidden">
      {isCollapsed ? (
        <Tooltip content={item.name} compact position="right" className="w-full">
          {navItem}
        </Tooltip>
      ) : (
        navItem
      )}
      {/* Drag handle on right */}
      {!isCollapsed && (
        <button
          type="button"
          className="p-1 text-gray-300 opacity-0 group-hover/item:opacity-100 cursor-grab active:cursor-grabbing flex-shrink-0"
          {...attributes}
          {...listeners}
        >
          <GripIcon className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}
