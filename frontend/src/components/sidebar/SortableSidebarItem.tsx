/**
 * Sortable wrapper for sidebar navigation items.
 * Provides drag-and-drop functionality for reordering items in the sidebar.
 */
import type { ReactNode } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { SidebarNavItem } from './SidebarNavItem'
import { getBuiltinRoute, getListRoute } from './routes'
import { getItemId, getBuiltinIcon, getListIcon } from './sidebarDndUtils'
import { GripIcon } from '../icons'
import type {
  SidebarBuiltinItemComputed,
  SidebarListItemComputed,
} from '../../types'

export interface SortableNavItemProps {
  item: SidebarBuiltinItemComputed | SidebarListItemComputed
  isCollapsed: boolean
  onNavClick?: () => void
  onEdit?: () => void
  onDelete?: () => void
  isDragging?: boolean
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
      : getListIcon(item.content_types)

  const route =
    item.type === 'builtin'
      ? getBuiltinRoute(item.key)
      : getListRoute(item.id)

  return (
    <div ref={setNodeRef} style={style} className="group/item flex w-full items-center min-w-0 overflow-hidden">
      <SidebarNavItem
        to={route}
        label={item.name}
        icon={icon}
        isCollapsed={isCollapsed}
        onClick={onNavClick}
        onEdit={item.type === 'list' ? onEdit : undefined}
        onDelete={item.type === 'list' ? onDelete : undefined}
      />
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
