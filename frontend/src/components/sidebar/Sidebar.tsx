/**
 * Main sidebar component with navigation, inline management UI, and drag-and-drop.
 */
import { useState, useMemo, useCallback } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  DndContext,
  closestCenter,
  pointerWithin,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
  type CollisionDetection,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useSidebarStore } from '../../stores/sidebarStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useListsStore } from '../../stores/listsStore'
import { useTagsStore } from '../../stores/tagsStore'
import { getBuiltinRoute, getListRoute } from './routes'
import { SidebarGroup } from './SidebarGroup'
import { SidebarNavItem } from './SidebarNavItem'
import { SidebarUserSection } from './SidebarUserSection'
import { ListModal } from '../ListModal'
import {
  SharedIcon,
  ArchiveIcon,
  TrashIcon,
  SettingsIcon,
  CollapseIcon,
  MenuIcon,
  CloseIcon,
  ListIcon,
  GroupIcon,
  PlusIcon,
  GripIcon,
  BookmarkIcon,
  NoteIcon,
} from '../icons'
import type {
  BuiltinKey,
  SidebarItemComputed,
  SidebarBuiltinItemComputed,
  SidebarListItemComputed,
  SidebarGroupComputed,
  SidebarOrder,
  SidebarItem,
  SidebarGroup as SidebarGroupType,
  ContentList,
} from '../../types'

const SIDEBAR_VERSION = 1

function getBuiltinIcon(key: BuiltinKey): ReactNode {
  switch (key) {
    case 'all':
      return <SharedIcon className="h-4 w-4 text-purple-600" />
    case 'archived':
      return <ArchiveIcon className="h-4 w-4 text-gray-500" />
    case 'trash':
      return <TrashIcon className="h-4 w-4 text-red-500" />
  }
}

/**
 * Get the appropriate icon for a list based on its content types.
 */
function getListIcon(contentTypes: string[]): ReactNode {
  const hasBookmarks = contentTypes.includes('bookmark')
  const hasNotes = contentTypes.includes('note')

  if (hasBookmarks && !hasNotes) {
    return <BookmarkIcon className="h-4 w-4 text-blue-500" />
  }
  if (hasNotes && !hasBookmarks) {
    return <NoteIcon className="h-4 w-4 text-green-500" />
  }
  // Both or neither - use shared/list icon
  return <ListIcon className="h-4 w-4 text-purple-500" />
}

/**
 * Get a unique ID for a sidebar item (for drag-and-drop).
 */
function getItemId(item: SidebarItemComputed): string {
  if (item.type === 'builtin') return `builtin:${item.key}`
  if (item.type === 'list') return `list:${item.id}`
  return `group:${item.id}`
}

/**
 * Get a unique ID for an item inside a group.
 * Format: "ingroup:{groupId}:{type}:{key|id}"
 */
function getGroupChildId(
  groupId: string,
  child: SidebarBuiltinItemComputed | SidebarListItemComputed
): string {
  if (child.type === 'builtin') return `ingroup:${groupId}:builtin:${child.key}`
  return `ingroup:${groupId}:list:${child.id}`
}

/**
 * Parse a group child ID back to its components.
 * Returns null if not a valid group child ID.
 */
function parseGroupChildId(id: string): {
  groupId: string
  type: 'builtin' | 'list'
  key?: string
  listId?: number
} | null {
  if (!id.startsWith('ingroup:')) return null
  const parts = id.split(':')
  if (parts.length !== 4) return null
  const [, groupId, type, keyOrId] = parts
  if (type === 'builtin') {
    return { groupId, type: 'builtin', key: keyOrId }
  }
  if (type === 'list') {
    return { groupId, type: 'list', listId: parseInt(keyOrId, 10) }
  }
  return null
}

/**
 * Convert computed sidebar back to minimal format for API updates.
 */
function computedToMinimal(items: SidebarItemComputed[]): SidebarItem[] {
  return items.map((item): SidebarItem => {
    if (item.type === 'builtin') {
      return { type: 'builtin', key: item.key }
    }
    if (item.type === 'list') {
      return { type: 'list', id: item.id }
    }
    // Group
    return {
      type: 'group',
      id: item.id,
      name: item.name,
      items: item.items.map((child) =>
        child.type === 'builtin'
          ? { type: 'builtin' as const, key: child.key }
          : { type: 'list' as const, id: child.id }
      ),
    }
  })
}

/**
 * Debounce utility
 */
function debounce<T extends (...args: Parameters<T>) => void>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId)
    timeoutId = setTimeout(() => fn(...args), delay)
  }
}

/**
 * Custom collision detection that prioritizes:
 * 1. Items within the same group (for intra-group reordering)
 * 2. Droppable zones (for dropping into groups)
 * 3. Root-level items (for root reordering)
 */
const customCollisionDetection: CollisionDetection = (args) => {
  const { active } = args
  const activeId = String(active.id)

  // Check if we're dragging a group child
  const activeGroupChild = parseGroupChildId(activeId)

  if (activeGroupChild) {
    const pointerCollisions = pointerWithin(args)

    // 1. Check if over a DIFFERENT group's dropzone (moving to another group)
    const otherGroupDropzone = pointerCollisions.find((collision) => {
      const id = String(collision.id)
      if (!id.startsWith('dropzone:')) return false
      const dropGroupId = id.replace('dropzone:', '')
      return dropGroupId !== activeGroupChild.groupId
    })
    if (otherGroupDropzone) {
      return [otherGroupDropzone]
    }

    // 2. Check if we're still over our OWN group's dropzone
    const ownGroupDropzone = pointerCollisions.find((collision) => {
      const id = String(collision.id)
      return id === `dropzone:${activeGroupChild.groupId}`
    })

    if (ownGroupDropzone) {
      // We're within our group, so prioritize sibling reordering
      const allCollisions = closestCenter(args)
      const siblingCollisions = allCollisions.filter((collision) => {
        const collisionId = String(collision.id)
        const collisionGroupChild = parseGroupChildId(collisionId)
        return collisionGroupChild && collisionGroupChild.groupId === activeGroupChild.groupId
      })
      if (siblingCollisions.length > 0) {
        return siblingCollisions
      }
    }

    // 3. We're outside our group - allow root-level placement
    return closestCenter(args)
  }

  // For root-level items, check dropzones first
  const pointerCollisions = pointerWithin(args)
  const dropzoneCollisions = pointerCollisions.filter(
    (collision) => String(collision.id).startsWith('dropzone:')
  )

  if (dropzoneCollisions.length > 0) {
    return dropzoneCollisions
  }

  // Otherwise use standard closest center for sortable reordering
  return closestCenter(args)
}

/**
 * Droppable zone for a group - allows items to be dropped into groups
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

interface SortableNavItemProps {
  item: SidebarBuiltinItemComputed | SidebarListItemComputed
  isCollapsed: boolean
  onNavClick?: () => void
  onEdit?: () => void
  onDelete?: () => void
  isDragging?: boolean
}

function SortableNavItem({
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

interface SortableGroupProps {
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

function SortableGroupItem({
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
}: SortableGroupProps): ReactNode {
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
              id={item.id}
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

interface SidebarContentProps {
  isCollapsed: boolean
  onNavClick?: () => void
}

function SidebarContent({ isCollapsed, onNavClick }: SidebarContentProps): ReactNode {
  const navigate = useNavigate()
  const { expandedSections, toggleSection, toggleCollapse, isGroupCollapsed, toggleGroup } =
    useSidebarStore()
  const sidebar = useSettingsStore((state) => state.sidebar)
  const updateSidebar = useSettingsStore((state) => state.updateSidebar)
  const setSidebarOptimistic = useSettingsStore((state) => state.setSidebarOptimistic)
  const fetchSidebar = useSettingsStore((state) => state.fetchSidebar)
  const lists = useListsStore((state) => state.lists)
  const deleteList = useListsStore((state) => state.deleteList)
  const tags = useTagsStore((state) => state.tags)

  // Modal state
  const [isListModalOpen, setIsListModalOpen] = useState(false)
  const [editingList, setEditingList] = useState<ContentList | undefined>(undefined)

  // Drag state
  const [activeId, setActiveId] = useState<string | null>(null)

  const isSettingsExpanded = expandedSections.includes('settings')

  // Quick-add handlers
  const handleQuickAddBookmark = (): void => {
    navigate('/app/bookmarks?action=add')
    onNavClick?.()
  }

  const handleQuickAddNote = (): void => {
    navigate('/app/notes/new')
    onNavClick?.()
  }

  // Configure sensors for pointer and keyboard
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 }, // Prevent accidental drags
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  // Get all sortable IDs for the root level
  const rootItemIds = useMemo(() => {
    if (!sidebar) return []
    return sidebar.items.map(getItemId)
  }, [sidebar])

  // Debounced sidebar update
  const debouncedUpdateSidebar = useMemo(
    () =>
      debounce((newSidebar: SidebarOrder) => {
        updateSidebar(newSidebar)
      }, 300),
    [updateSidebar]
  )

  // Get full list data from store by ID
  const getListById = useCallback(
    (id: number): ContentList | undefined => {
      return lists.find((l) => l.id === id)
    },
    [lists]
  )

  // Create a new group
  const handleNewGroup = async (): Promise<void> => {
    if (!sidebar) return

    const newGroup: SidebarGroupType = {
      type: 'group',
      id: crypto.randomUUID(),
      name: 'New Group',
      items: [],
    }

    const updatedSidebar: SidebarOrder = {
      version: SIDEBAR_VERSION,
      items: [...computedToMinimal(sidebar.items), newGroup],
    }

    await updateSidebar(updatedSidebar)
  }

  // Rename a group
  const handleRenameGroup = async (groupId: string, newName: string): Promise<void> => {
    if (!sidebar) return

    const updatedItems = computedToMinimal(sidebar.items).map((item) => {
      if (item.type === 'group' && item.id === groupId) {
        return { ...item, name: newName }
      }
      return item
    })

    await updateSidebar({ version: SIDEBAR_VERSION, items: updatedItems })
  }

  // Delete a group (moves contents to root)
  const handleDeleteGroup = async (groupId: string): Promise<void> => {
    if (!sidebar) return

    const group = sidebar.items.find(
      (item): item is SidebarGroupComputed => item.type === 'group' && item.id === groupId
    )

    if (!group) return

    // Extract items from group and add to root, then remove group
    const groupItemsMinimal = group.items.map((child) =>
      child.type === 'builtin'
        ? { type: 'builtin' as const, key: child.key }
        : { type: 'list' as const, id: child.id }
    )

    const updatedItems = computedToMinimal(sidebar.items).flatMap((item) => {
      if (item.type === 'group' && item.id === groupId) {
        // Replace group with its contents
        return groupItemsMinimal
      }
      return [item]
    })

    await updateSidebar({ version: SIDEBAR_VERSION, items: updatedItems })
  }

  // Open list modal for editing
  const handleEditList = (listId: number): void => {
    const list = getListById(listId)
    if (list) {
      setEditingList(list)
      setIsListModalOpen(true)
    }
  }

  // Delete a list
  const handleDeleteList = async (listId: number): Promise<void> => {
    if (!confirm('Are you sure you want to delete this list?')) return
    await deleteList(listId)
    // Refresh sidebar to remove deleted list
    await fetchSidebar()
  }

  // Open list modal for creating
  const handleNewList = (): void => {
    setEditingList(undefined)
    setIsListModalOpen(true)
  }

  // List modal handlers - wrap to refresh sidebar after changes
  const createList = useListsStore((state) => state.createList)
  const updateListStore = useListsStore((state) => state.updateList)

  const handleCreateList = async (
    ...args: Parameters<typeof createList>
  ): Promise<ReturnType<typeof createList>> => {
    const result = await createList(...args)
    // Refresh sidebar to show new list
    await fetchSidebar()
    return result
  }

  const handleUpdateList = async (
    ...args: Parameters<typeof updateListStore>
  ): Promise<ReturnType<typeof updateListStore>> => {
    const result = await updateListStore(...args)
    // Refresh sidebar to show updated list
    await fetchSidebar()
    return result
  }

  // Drag handlers
  const handleDragStart = (event: DragStartEvent): void => {
    setActiveId(event.active.id as string)
  }

  const handleDragOver = (): void => {
    // Could implement hover highlighting for groups here
  }

  const handleDragEnd = (event: DragEndEvent): void => {
    setActiveId(null)

    const { active, over } = event
    if (!over || active.id === over.id || !sidebar) return

    const activeIdStr = active.id as string
    const overIdStr = over.id as string

    const items = [...sidebar.items]

    // Parse IDs to determine what's being dragged and where
    const activeGroupChild = parseGroupChildId(activeIdStr)
    const overGroupChild = parseGroupChildId(overIdStr)
    const isOverDropzone = overIdStr.startsWith('dropzone:')
    const isDraggingGroup = activeIdStr.startsWith('group:')

    // Case 1: Dragging an item within a group (intra-group reorder)
    if (activeGroupChild && overGroupChild && activeGroupChild.groupId === overGroupChild.groupId) {
      const groupIndex = items.findIndex(
        (item): item is SidebarGroupComputed =>
          item.type === 'group' && item.id === activeGroupChild.groupId
      )
      if (groupIndex === -1) return

      const group = items[groupIndex] as SidebarGroupComputed
      const groupItems = [...group.items]

      const activeChildIndex = groupItems.findIndex(
        (child) => getGroupChildId(group.id, child) === activeIdStr
      )
      const overChildIndex = groupItems.findIndex(
        (child) => getGroupChildId(group.id, child) === overIdStr
      )

      if (activeChildIndex === -1 || overChildIndex === -1) return

      // Reorder within group
      const [removed] = groupItems.splice(activeChildIndex, 1)
      groupItems.splice(overChildIndex, 0, removed)

      items[groupIndex] = { ...group, items: groupItems }

      setSidebarOptimistic(items)
      debouncedUpdateSidebar({ version: SIDEBAR_VERSION, items: computedToMinimal(items) })
      return
    }

    // Case 2: Dragging from a group to a dropzone (another group or same group)
    if (activeGroupChild && isOverDropzone && !isDraggingGroup) {
      const targetGroupId = overIdStr.replace('dropzone:', '')

      // Find source and target groups
      const sourceGroupIndex = items.findIndex(
        (item): item is SidebarGroupComputed =>
          item.type === 'group' && item.id === activeGroupChild.groupId
      )
      const targetGroupIndex = items.findIndex(
        (item): item is SidebarGroupComputed =>
          item.type === 'group' && item.id === targetGroupId
      )

      if (sourceGroupIndex === -1 || targetGroupIndex === -1) return

      const sourceGroup = items[sourceGroupIndex] as SidebarGroupComputed
      const sourceItems = [...sourceGroup.items]

      const activeChildIndex = sourceItems.findIndex(
        (child) => getGroupChildId(sourceGroup.id, child) === activeIdStr
      )
      if (activeChildIndex === -1) return

      // Remove from source group
      const [removed] = sourceItems.splice(activeChildIndex, 1)
      items[sourceGroupIndex] = { ...sourceGroup, items: sourceItems }

      // Add to target group
      const targetGroup = items[targetGroupIndex] as SidebarGroupComputed
      items[targetGroupIndex] = {
        ...targetGroup,
        items: [...targetGroup.items, removed],
      }

      setSidebarOptimistic(items)
      debouncedUpdateSidebar({ version: SIDEBAR_VERSION, items: computedToMinimal(items) })
      return
    }

    // Case 3: Dragging from a group to root level
    if (activeGroupChild && !isOverDropzone && !overGroupChild) {
      const sourceGroupIndex = items.findIndex(
        (item): item is SidebarGroupComputed =>
          item.type === 'group' && item.id === activeGroupChild.groupId
      )
      if (sourceGroupIndex === -1) return

      const sourceGroup = items[sourceGroupIndex] as SidebarGroupComputed
      const sourceItems = [...sourceGroup.items]

      const activeChildIndex = sourceItems.findIndex(
        (child) => getGroupChildId(sourceGroup.id, child) === activeIdStr
      )
      if (activeChildIndex === -1) return

      // Remove from source group
      const [removed] = sourceItems.splice(activeChildIndex, 1)
      items[sourceGroupIndex] = { ...sourceGroup, items: sourceItems }

      // Add to root level at the position of the drop target
      const overIndex = items.findIndex((item) => getItemId(item) === overIdStr)
      if (overIndex !== -1) {
        items.splice(overIndex, 0, removed)
      } else {
        items.push(removed)
      }

      setSidebarOptimistic(items)
      debouncedUpdateSidebar({ version: SIDEBAR_VERSION, items: computedToMinimal(items) })
      return
    }

    // Case 4: Dragging from root level to a group dropzone
    if (!activeGroupChild && isOverDropzone && !isDraggingGroup) {
      const activeIndex = items.findIndex((item) => getItemId(item) === activeIdStr)
      if (activeIndex === -1) return

      const targetGroupId = overIdStr.replace('dropzone:', '')
      const targetGroupIndex = items.findIndex(
        (item): item is SidebarGroupComputed =>
          item.type === 'group' && item.id === targetGroupId
      )
      if (targetGroupIndex === -1) return

      const targetGroup = items[targetGroupIndex] as SidebarGroupComputed
      const [removed] = items.splice(activeIndex, 1)

      const adjustedGroupIndex =
        activeIndex < targetGroupIndex ? targetGroupIndex - 1 : targetGroupIndex
      items[adjustedGroupIndex] = {
        ...targetGroup,
        items: [...targetGroup.items, removed as SidebarBuiltinItemComputed | SidebarListItemComputed],
      }

      setSidebarOptimistic(items)
      debouncedUpdateSidebar({ version: SIDEBAR_VERSION, items: computedToMinimal(items) })
      return
    }

    // Case 5: Standard root-level reorder
    const activeIndex = items.findIndex((item) => getItemId(item) === activeIdStr)
    const overIndex = items.findIndex((item) => getItemId(item) === overIdStr)

    if (activeIndex === -1 || overIndex === -1) return

    const [removed] = items.splice(activeIndex, 1)
    items.splice(overIndex, 0, removed)

    setSidebarOptimistic(items)
    debouncedUpdateSidebar({
      version: SIDEBAR_VERSION,
      items: computedToMinimal(items),
    })
  }

  // Find the active item for the drag overlay (including items inside groups)
  const activeItem = useMemo((): SidebarItemComputed | SidebarBuiltinItemComputed | SidebarListItemComputed | null => {
    if (!activeId || !sidebar) return null

    // Check if it's an item inside a group
    const groupChildInfo = parseGroupChildId(activeId)
    if (groupChildInfo) {
      // Find the group and then the child within it
      const group = sidebar.items.find(
        (item): item is SidebarGroupComputed =>
          item.type === 'group' && item.id === groupChildInfo.groupId
      )
      if (group) {
        return group.items.find(
          (child) => getGroupChildId(group.id, child) === activeId
        ) ?? null
      }
      return null
    }

    // Otherwise look at root level
    return sidebar.items.find((item) => getItemId(item) === activeId) ?? null
  }, [activeId, sidebar])

  // Render a builtin or list item
  const renderNavItem = (
    item: SidebarBuiltinItemComputed | SidebarListItemComputed
  ): ReactNode => (
    <SortableNavItem
      key={getItemId(item)}
      item={item}
      isCollapsed={isCollapsed}
      onNavClick={onNavClick}
      onEdit={item.type === 'list' ? () => handleEditList(item.id) : undefined}
      onDelete={item.type === 'list' ? () => handleDeleteList(item.id) : undefined}
      isDragging={activeId === getItemId(item)}
    />
  )

  // Render a sidebar item based on type
  const renderItem = (item: SidebarItemComputed): ReactNode => {
    if (item.type === 'group') {
      return (
        <SortableGroupItem
          key={getItemId(item)}
          item={item}
          isCollapsed={isCollapsed}
          isGroupCollapsed={isGroupCollapsed(item.id)}
          onToggleGroup={() => toggleGroup(item.id)}
          onNavClick={onNavClick}
          onEditList={handleEditList}
          onDeleteList={handleDeleteList}
          onRenameGroup={(newName) => handleRenameGroup(item.id, newName)}
          onDeleteGroup={() => handleDeleteGroup(item.id)}
          isDragging={activeId === getItemId(item)}
          activeId={activeId}
        />
      )
    }
    return renderNavItem(item)
  }

  return (
    <div className="flex h-full flex-col">
      {/* Quick-add buttons */}
      {!isCollapsed && (
        <div className="flex items-center gap-1 px-3 pb-1.5 border-b border-gray-200">
          <span className="text-xs text-gray-500 mr-auto">Quick add:</span>
          <button
            onClick={handleQuickAddBookmark}
            className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
            title="New Bookmark"
          >
            <BookmarkIcon className="h-4 w-4" />
          </button>
          <button
            onClick={handleQuickAddNote}
            className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
            title="New Note"
          >
            <NoteIcon className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Navigation Items with Drag-and-Drop */}
      <DndContext
        sensors={sensors}
        collisionDetection={customCollisionDetection}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <nav className="flex-1 space-y-1 overflow-y-auto overflow-x-hidden px-2 pt-2">
          <SortableContext items={rootItemIds} strategy={verticalListSortingStrategy}>
            {sidebar?.items.map(renderItem)}
          </SortableContext>

          {/* Add Buttons - side by side above Settings */}
          {!isCollapsed && (
            <div className="flex items-center gap-1 mt-2 px-1">
              <button
                onClick={handleNewGroup}
                className="flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-xs text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
                title="New Group"
              >
                <PlusIcon className="h-3.5 w-3.5" />
                <span>Group</span>
              </button>
              <button
                onClick={handleNewList}
                className="flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-xs text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
                title="New List"
              >
                <PlusIcon className="h-3.5 w-3.5" />
                <span>List</span>
              </button>
            </div>
          )}

          {/* Settings Section (not draggable) */}
          <div className="mt-4 border-t border-gray-200 pt-4">
            <SidebarGroup
              id="settings"
              name="Settings"
              icon={<SettingsIcon className="h-5 w-5" />}
              isCollapsed={isCollapsed}
              isGroupCollapsed={!isSettingsExpanded}
              onToggle={() => toggleSection('settings')}
            >
              <SidebarNavItem
                to="/app/settings/general"
                label="General"
                isCollapsed={isCollapsed}
                onClick={onNavClick}
              />
              <SidebarNavItem
                to="/app/settings/tags"
                label="Tags"
                isCollapsed={isCollapsed}
                onClick={onNavClick}
              />
              <SidebarNavItem
                to="/app/settings/tokens"
                label="Personal Access Tokens"
                isCollapsed={isCollapsed}
                onClick={onNavClick}
              />
              <SidebarNavItem
                to="/app/settings/mcp"
                label="MCP Integration"
                isCollapsed={isCollapsed}
                onClick={onNavClick}
              />
            </SidebarGroup>
          </div>
        </nav>

        {/* Drag Overlay */}
        <DragOverlay>
          {activeItem && (
            <div className="rounded-lg bg-white shadow-lg border border-gray-200 px-3 py-2">
              <span className="text-sm text-gray-700">
                {activeItem.type === 'group' ? activeItem.name : activeItem.name}
              </span>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {/* Collapse Toggle (desktop only) */}
      <div className="hidden border-t border-gray-200 px-2 py-2 md:block">
        <button
          onClick={toggleCollapse}
          className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700 ${
            isCollapsed ? 'justify-center' : ''
          }`}
          title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <CollapseIcon
            className={`h-4 w-4 transition-transform ${isCollapsed ? 'rotate-180' : ''}`}
          />
          {!isCollapsed && <span>Collapse</span>}
        </button>
      </div>

      {/* User Section */}
      <div className="border-t border-gray-200 px-2 py-3">
        <SidebarUserSection isCollapsed={isCollapsed} />
      </div>

      {/* List Modal */}
      <ListModal
        isOpen={isListModalOpen}
        onClose={() => {
          setIsListModalOpen(false)
          setEditingList(undefined)
        }}
        list={editingList}
        tagSuggestions={tags}
        onCreate={handleCreateList}
        onUpdate={handleUpdateList}
      />
    </div>
  )
}

export function Sidebar(): ReactNode {
  const { isCollapsed, isMobileOpen, toggleMobile, closeMobile } = useSidebarStore()

  return (
    <>
      {/* Mobile menu button */}
      <button
        onClick={toggleMobile}
        className="fixed left-4 top-4 z-50 rounded-lg bg-white p-2 shadow-md md:hidden"
        aria-label={isMobileOpen ? 'Close menu' : 'Open menu'}
      >
        {isMobileOpen ? <CloseIcon /> : <MenuIcon />}
      </button>

      {/* Mobile backdrop */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-gray-900/20 backdrop-blur-sm md:hidden"
          onClick={closeMobile}
        />
      )}

      {/* Mobile sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 transform bg-white shadow-lg transition-transform md:hidden ${
          isMobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="h-full pt-16">
          <SidebarContent isCollapsed={false} onNavClick={closeMobile} />
        </div>
      </aside>

      {/* Desktop sidebar */}
      <aside
        className={`hidden h-screen flex-shrink-0 border-r border-gray-200 bg-white transition-all md:block ${
          isCollapsed ? 'w-16' : 'w-64'
        }`}
      >
        <div className="h-full pb-4 overflow-hidden">
          <SidebarContent isCollapsed={isCollapsed} />
        </div>
      </aside>
    </>
  )
}
