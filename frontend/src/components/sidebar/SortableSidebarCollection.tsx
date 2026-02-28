/**
 * Sortable wrapper for sidebar collections with nested drag-and-drop support.
 * Includes CollectionDropZone for dropping items into collections and SortableCollectionChild
 * for items within collections.
 */
import type { ReactNode } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { SidebarGroup } from './SidebarGroup'
import { SidebarNavItem } from './SidebarNavItem'
import { getBuiltinRoute, getFilterRoute } from './routes'
import {
  getItemId,
  getCollectionChildId,
  getBuiltinIcon,
  getFilterIcon,
} from './sidebarDndUtils'
import { GripIcon, GroupIcon } from '../icons'
import type {
  SidebarBuiltinItemComputed,
  SidebarFilterItemComputed,
  SidebarCollectionComputed,
} from '../../types'

/**
 * Droppable zone for a collection - allows items to be dropped into collections.
 */
interface CollectionDropZoneProps {
  collectionId: string
  children: ReactNode
  isExpanded: boolean
}

function CollectionDropZone({ collectionId, children, isExpanded }: CollectionDropZoneProps): ReactNode {
  const { setNodeRef, isOver } = useDroppable({
    id: `dropzone:${collectionId}`,
  })

  return (
    <div
      ref={setNodeRef}
      className={`transition-colors ${isOver ? 'bg-blue-50 ring-2 ring-blue-300 ring-inset rounded-lg' : ''}`}
    >
      {children}
      {/* Show drop indicator when hovering and collection is collapsed */}
      {isOver && !isExpanded && (
        <div className="px-3 py-1 text-xs text-blue-600 text-center">
          Drop here to add to collection
        </div>
      )}
    </div>
  )
}

/**
 * Sortable item inside a collection - similar to SortableNavItem but uses collection child IDs.
 */
interface SortableCollectionChildProps {
  collectionId: string
  item: SidebarBuiltinItemComputed | SidebarFilterItemComputed
  isCollapsed: boolean
  onNavClick?: () => void
  onEdit?: () => void
  onDelete?: () => void
  activeId: string | null
}

function SortableCollectionChild({
  collectionId,
  item,
  isCollapsed,
  onNavClick,
  onEdit,
  onDelete,
  activeId,
}: SortableCollectionChildProps): ReactNode {
  const itemId = getCollectionChildId(collectionId, item)
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

export interface SortableCollectionItemProps {
  item: SidebarCollectionComputed
  isCollapsed: boolean
  isGroupCollapsed: boolean
  onToggleGroup: () => void
  onNavClick?: () => void
  onEditFilter: (filterId: string) => void
  onDeleteFilter: (filterId: string) => void
  onEditCollection: () => void
  onRenameCollection: (newName: string) => void
  onDeleteCollection: () => void
  isDragging?: boolean
  activeId: string | null
}

/**
 * A sortable collection in the sidebar that can contain nested items.
 * Collections can be reordered at the root level and items can be dragged in/out.
 */
export function SortableCollectionItem({
  item,
  isCollapsed,
  isGroupCollapsed,
  onToggleGroup,
  onNavClick,
  onEditFilter,
  onDeleteFilter,
  onEditCollection,
  onRenameCollection,
  onDeleteCollection,
  isDragging,
  activeId,
}: SortableCollectionItemProps): ReactNode {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: getItemId(item),
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  // Get IDs for children within this collection for nested SortableContext
  const childIds = item.items.map((child) => getCollectionChildId(item.id, child))

  return (
    <div ref={setNodeRef} style={style} className="w-full min-w-0 overflow-hidden">
      <CollectionDropZone collectionId={item.id} isExpanded={!isGroupCollapsed}>
        <div className="flex items-center group/groupheader w-full min-w-0">
          <div className="flex-1 min-w-0 overflow-hidden">
            <SidebarGroup
              name={item.name}
              icon={<GroupIcon className="h-[18px] w-[18px] text-gray-500" />}
              isCollapsed={isCollapsed}
              isGroupCollapsed={isGroupCollapsed}
              onToggle={onToggleGroup}
              onEdit={onEditCollection}
              onRename={onRenameCollection}
              onDelete={onDeleteCollection}
            >
              {/* Nested SortableContext for items within this collection */}
              <SortableContext items={childIds} strategy={verticalListSortingStrategy}>
                {item.items.map((child) => (
                  <SortableCollectionChild
                    key={getCollectionChildId(item.id, child)}
                    collectionId={item.id}
                    item={child}
                    isCollapsed={isCollapsed}
                    onNavClick={onNavClick}
                    onEdit={child.type === 'filter' ? () => onEditFilter(child.id) : undefined}
                    onDelete={child.type === 'filter' ? () => onDeleteFilter(child.id) : undefined}
                    activeId={activeId}
                  />
                ))}
              </SortableContext>
            </SidebarGroup>
          </div>
          {/* Drag handle for collections on right */}
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
      </CollectionDropZone>
    </div>
  )
}
