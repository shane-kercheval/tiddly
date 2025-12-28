/**
 * Main sidebar component with navigation, inline management UI, and drag-and-drop.
 */
import { useState, useMemo, useCallback, useEffect } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { useSidebarStore } from '../../stores/sidebarStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useListsStore } from '../../stores/listsStore'
import { useTagsStore } from '../../stores/tagsStore'
import { SidebarGroup } from './SidebarGroup'
import { SidebarNavItem } from './SidebarNavItem'
import { SidebarUserSection } from './SidebarUserSection'
import { SortableNavItem } from './SortableSidebarItem'
import { SortableGroupItem } from './SortableSidebarGroup'
import {
  getItemId,
  getGroupChildId,
  parseGroupChildId,
  computedToMinimal,
  customCollisionDetection,
} from './sidebarDndUtils'
import { ListModal } from '../ListModal'
import {
  SettingsIcon,
  CollapseIcon,
  MenuIcon,
  CloseIcon,
  PlusIcon,
  BookmarkIcon,
  NoteIcon,
} from '../icons'
import type {
  SidebarItemComputed,
  SidebarBuiltinItemComputed,
  SidebarListItemComputed,
  SidebarGroupComputed,
  SidebarOrder,
  SidebarGroup as SidebarGroupType,
  ContentList,
} from '../../types'

const SIDEBAR_VERSION = 1

/**
 * Cancelable debounce utility.
 * Returns a debounced function with a .cancel() method for cleanup.
 */
interface DebouncedFunction<T extends (...args: Parameters<T>) => void> {
  (...args: Parameters<T>): void
  cancel: () => void
}

function debounce<T extends (...args: Parameters<T>) => void>(
  fn: T,
  delay: number
): DebouncedFunction<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  const debouncedFn = (...args: Parameters<T>): void => {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
    timeoutId = setTimeout(() => {
      timeoutId = null
      fn(...args)
    }, delay)
  }

  debouncedFn.cancel = (): void => {
    if (timeoutId) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
  }

  return debouncedFn
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
  const rollbackSidebar = useSettingsStore((state) => state.rollbackSidebar)
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

  // Debounced sidebar update with error handling and rollback
  const debouncedUpdateSidebar = useMemo(
    () =>
      debounce((newSidebar: SidebarOrder) => {
        updateSidebar(newSidebar).catch(() => {
          rollbackSidebar()
          toast.error('Failed to save sidebar order')
        })
      }, 300),
    [updateSidebar, rollbackSidebar]
  )

  // Cleanup debounce on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      debouncedUpdateSidebar.cancel()
    }
  }, [debouncedUpdateSidebar])

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

  // Delete a list (confirmation is handled in SidebarNavItem)
  const handleDeleteList = async (listId: number): Promise<void> => {
    try {
      await deleteList(listId)
      // Refresh sidebar to remove deleted list
      await fetchSidebar()
    } catch {
      toast.error('Failed to delete list')
    }
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
  ): Promise<Awaited<ReturnType<typeof createList>>> => {
    const result = await createList(...args)
    // Refresh sidebar to show new list
    await fetchSidebar()
    return result
  }

  const handleUpdateList = async (
    ...args: Parameters<typeof updateListStore>
  ): Promise<Awaited<ReturnType<typeof updateListStore>>> => {
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
