/**
 * Sortable wrapper for sidebar groups with nested drag-and-drop support.
 * Includes GroupDropZone for dropping items into groups and SortableGroupChild
 * for items within groups.
 */
import type { ReactNode } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { SidebarGroup } from './SidebarGroup'
import { SidebarNavItem } from './SidebarNavItem'
import { getBuiltinRoute, getListRoute } from './routes'
import {
  getItemId,
  getGroupChildId,
  getBuiltinIcon,
  getListIcon,
} from './sidebarDndUtils'
import { GripIcon, GroupIcon } from '../icons'
import type {
  SidebarBuiltinItemComputed,
  SidebarListItemComputed,
  SidebarGroupComputed,
} from '../../types'

/**
 * Droppable zone for a group - allows items to be dropped into groups.
 */
interface GroupDropZoneProps {
  groupId: string
  children: ReactNode
  isExpanded: boolean
}

function GroupDropZone({ groupId, children, isExpanded }: GroupDropZoneProps): ReactNode {
  const { setNodeRef, isOver } = useDroppable({
    id: `dropzone:${groupId}`,
  })

  return (
    <div
      ref={setNodeRef}
      className={`transition-colors ${isOver ? 'bg-blue-50 ring-2 ring-blue-300 ring-inset rounded-lg' : ''}`}
    >
      {children}
      {/* Show drop indicator when hovering and group is collapsed */}
      {isOver && !isExpanded && (
        <div className="px-3 py-1 text-xs text-blue-600 text-center">
          Drop here to add to group
        </div>
      )}
    </div>
  )
}

/**
 * Sortable item inside a group - similar to SortableNavItem but uses group child IDs.
 */
interface SortableGroupChildProps {
  groupId: string
  item: SidebarBuiltinItemComputed | SidebarListItemComputed
  isCollapsed: boolean
  onNavClick?: () => void
  onEdit?: () => void
  onDelete?: () => void
  activeId: string | null
}

function SortableGroupChild({
  groupId,
  item,
  isCollapsed,
  onNavClick,
  onEdit,
  onDelete,
  activeId,
}: SortableGroupChildProps): ReactNode {
  const itemId = getGroupChildId(groupId, item)
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: itemId,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: activeId === itemId ? 0.5 : 1,
  }

  const icon =
    item.type === 'builtin'
      ? getBuiltinIcon(item.key)
      : getListIcon(item.content_types)

  const route =
    item.type === 'builtin'
      ? getBuiltinRoute(item.key)
      : getListRoute(item.id, item.content_types)

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

export interface SortableGroupItemProps {
  item: SidebarGroupComputed
  isCollapsed: boolean
  isGroupCollapsed: boolean
  onToggleGroup: () => void
  onNavClick?: () => void
  onEditList: (listId: number) => void
  onDeleteList: (listId: number) => void
  onRenameGroup: (newName: string) => void
  onDeleteGroup: () => void
  isDragging?: boolean
  activeId: string | null
}

/**
 * A sortable group in the sidebar that can contain nested items.
 * Groups can be reordered at the root level and items can be dragged in/out.
 */
export function SortableGroupItem({
  item,
  isCollapsed,
  isGroupCollapsed,
  onToggleGroup,
  onNavClick,
  onEditList,
  onDeleteList,
  onRenameGroup,
  onDeleteGroup,
  isDragging,
  activeId,
}: SortableGroupItemProps): ReactNode {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: getItemId(item),
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  // Get IDs for children within this group for SortableContext
  const childIds = item.items.map((child) => getGroupChildId(item.id, child))

  return (
    <div ref={setNodeRef} style={style} className="w-full min-w-0 overflow-hidden">
      <GroupDropZone groupId={item.id} isExpanded={!isGroupCollapsed}>
        <div className="flex items-center group/groupheader w-full min-w-0">
          <div className="flex-1 min-w-0 overflow-hidden">
            <SidebarGroup
              name={item.name}
              icon={<GroupIcon className="h-5 w-5 text-gray-500" />}
              isCollapsed={isCollapsed}
              isGroupCollapsed={isGroupCollapsed}
              onToggle={onToggleGroup}
              onRename={onRenameGroup}
              onDelete={onDeleteGroup}
            >
              {/* Nested SortableContext for items within this group */}
              <SortableContext items={childIds} strategy={verticalListSortingStrategy}>
                {item.items.map((child) => (
                  <SortableGroupChild
                    key={getGroupChildId(item.id, child)}
                    groupId={item.id}
                    item={child}
                    isCollapsed={isCollapsed}
                    onNavClick={onNavClick}
                    onEdit={child.type === 'list' ? () => onEditList(child.id) : undefined}
                    onDelete={child.type === 'list' ? () => onDeleteList(child.id) : undefined}
                    activeId={activeId}
                  />
                ))}
              </SortableContext>
            </SidebarGroup>
          </div>
          {/* Drag handle for groups on right */}
          {!isCollapsed && (
            <button
              type="button"
              className="p-1 text-gray-300 opacity-0 group-hover/groupheader:opacity-100 cursor-grab active:cursor-grabbing flex-shrink-0"
              {...attributes}
              {...listeners}
            >
              <GripIcon className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </GroupDropZone>
    </div>
  )
}
