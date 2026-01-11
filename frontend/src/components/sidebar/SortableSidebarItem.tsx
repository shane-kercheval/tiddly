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
      : getFilterIcon(item.content_types)

  const route =
    item.type === 'builtin'
      ? getBuiltinRoute(item.key)
      : getFilterRoute(item.id)

  return (
    <div ref={setNodeRef} style={style} className="group/item flex w-full items-center min-w-0 overflow-hidden">
      <SidebarNavItem
        to={route}
        label={item.name}
        icon={icon}
        isCollapsed={isCollapsed}
        onClick={onNavClick}
        onEdit={item.type === 'filter' ? onEdit : undefined}
        onDelete={item.type === 'filter' ? onDelete : undefined}
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
