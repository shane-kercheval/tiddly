/**
 * Main sidebar component with navigation, inline management UI, and drag-and-drop.
 */
import { useState, useMemo, useCallback, useEffect } from 'react'
import type { ReactNode } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
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
import { useTabNavigation } from '../../hooks/useTabNavigation'
import { queryClient } from '../../queryClient'
import { invalidateListQueries } from '../../utils/invalidateListQueries'
import { getFirstGroupTags } from '../../utils'
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
import { getListRoute } from './routes'
import { ListModal } from '../ListModal'
import {
  SettingsIcon,
  CollapseIcon,
  MenuIcon,
  CloseIcon,
  PlusIcon,
  BookmarkIcon,
  NoteIcon,
  PromptIcon,
} from '../icons'
import type {
  SidebarItemComputed,
  SidebarBuiltinItemComputed,
  SidebarListItemComputed,
  SidebarGroupComputed,
  SidebarOrder,
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
  const location = useLocation()
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
  const { currentListId } = useTabNavigation()

  const currentList = useMemo(
    () => currentListId !== undefined ? lists.find((list) => list.id === currentListId) : undefined,
    [currentListId, lists]
  )
  const initialTagsFromList = useMemo(() => getFirstGroupTags(currentList), [currentList])

  // Modal state
  const [isListModalOpen, setIsListModalOpen] = useState(false)
  const [editingList, setEditingList] = useState<ContentList | undefined>(undefined)

  // Drag state
  const [activeId, setActiveId] = useState<string | null>(null)

  const isSettingsExpanded = expandedSections.includes('settings')

  // Quick-add handlers
  const handleQuickAddBookmark = (): void => {
    navigate('/app/bookmarks/new', {
      state: {
        returnTo: location.pathname + location.search,
        initialTags: initialTagsFromList,
      },
    })
    onNavClick?.()
  }

  const handleQuickAddNote = (): void => {
    navigate('/app/notes/new', {
      state: {
        returnTo: location.pathname + location.search,
        initialTags: initialTagsFromList,
      },
    })
    onNavClick?.()
  }

  const handleQuickAddPrompt = (): void => {
    navigate('/app/prompts/new', {
      state: {
        returnTo: location.pathname + location.search,
        initialTags: initialTagsFromList,
      },
    })
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

  // Get root-level sortable IDs only (groups are treated as atomic units)
  // In-group items have their own nested SortableContext in SortableSidebarGroup
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

  // Create a new group (added to top of sidebar) - optimistic update
  const handleNewGroup = async (): Promise<void> => {
    if (!sidebar) return

    const newGroupComputed: SidebarGroupComputed = {
      type: 'group',
      id: crypto.randomUUID(),
      name: 'New Group',
      items: [],
    }

    // Optimistically add to UI
    const optimisticItems = [newGroupComputed, ...sidebar.items]
    setSidebarOptimistic(optimisticItems)

    const updatedSidebar: SidebarOrder = {
      version: SIDEBAR_VERSION,
      items: computedToMinimal(optimisticItems),
    }

    try {
      await updateSidebar(updatedSidebar)
    } catch {
      rollbackSidebar()
      toast.error('Failed to create group')
    }
  }

  // Rename a group - optimistic update
  const handleRenameGroup = async (groupId: string, newName: string): Promise<void> => {
    if (!sidebar) return

    // Optimistically update UI
    const optimisticItems = sidebar.items.map((item) => {
      if (item.type === 'group' && item.id === groupId) {
        return { ...item, name: newName }
      }
      return item
    })
    setSidebarOptimistic(optimisticItems)

    try {
      await updateSidebar({ version: SIDEBAR_VERSION, items: computedToMinimal(optimisticItems) })
    } catch {
      rollbackSidebar()
      toast.error('Failed to rename group')
    }
  }

  // Delete a group (moves contents to root) - optimistic update
  const handleDeleteGroup = async (groupId: string): Promise<void> => {
    if (!sidebar) return

    const group = sidebar.items.find(
      (item): item is SidebarGroupComputed => item.type === 'group' && item.id === groupId
    )

    if (!group) return

    // Optimistically update UI - replace group with its contents
    const optimisticItems = sidebar.items.flatMap((item) => {
      if (item.type === 'group' && item.id === groupId) {
        return item.items // Return the group's children directly
      }
      return [item]
    })
    setSidebarOptimistic(optimisticItems)

    try {
      await updateSidebar({ version: SIDEBAR_VERSION, items: computedToMinimal(optimisticItems) })
    } catch {
      rollbackSidebar()
      toast.error('Failed to delete group')
    }
  }

  // Open list modal for editing
  const handleEditList = (listId: number): void => {
    const list = getListById(listId)
    if (list) {
      setEditingList(list)
      setIsListModalOpen(true)
    }
  }

  // Delete a list (confirmation is handled in SidebarNavItem) - optimistic update
  const handleDeleteList = async (listId: number): Promise<void> => {
    // Helper to recursively remove list from sidebar items (including from groups)
    const removeListFromItems = (items: SidebarItemComputed[]): SidebarItemComputed[] => {
      return items
        .filter((item) => !(item.type === 'list' && item.id === listId))
        .map((item) => {
          if (item.type === 'group') {
            return {
              ...item,
              items: item.items.filter((child) => !(child.type === 'list' && child.id === listId)),
            }
          }
          return item
        })
    }

    // Optimistically remove from sidebar (instant visual feedback)
    if (sidebar) {
      const optimisticItems = removeListFromItems(sidebar.items)
      setSidebarOptimistic(optimisticItems)
    }

    const wasViewingDeletedList = currentListId === listId

    try {
      await deleteList(listId)
      // Navigate after successful deletion (not before, to avoid confusing state on failure)
      if (wasViewingDeletedList) {
        navigate('/app/content')
      }
    } catch {
      rollbackSidebar()
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
    // Move the new list to the top of the sidebar
    const currentSidebar = useSettingsStore.getState().sidebar
    if (currentSidebar) {
      const newListItem = { type: 'list' as const, id: result.id }
      const otherItems = computedToMinimal(currentSidebar.items).filter(
        (item) => !(item.type === 'list' && item.id === result.id)
      )
      await updateSidebar({
        version: SIDEBAR_VERSION,
        items: [newListItem, ...otherItems],
      })
    }
    // Navigate to the new list using path-based route
    navigate(getListRoute(result.id))
    return result
  }

  const handleUpdateList = async (
    ...args: Parameters<typeof updateListStore>
  ): Promise<Awaited<ReturnType<typeof updateListStore>>> => {
    const [listId, data] = args

    // Helper to update list in sidebar items (including in groups)
    const updateListInItems = (
      items: SidebarItemComputed[],
      id: number,
      updates: { name?: string; content_types?: string[] }
    ): SidebarItemComputed[] => {
      return items.map((item) => {
        if (item.type === 'list' && item.id === id) {
          return { ...item, ...updates }
        }
        if (item.type === 'group') {
          return {
            ...item,
            items: item.items.map((child) =>
              child.type === 'list' && child.id === id
                ? { ...child, ...updates }
                : child
            ),
          }
        }
        return item
      })
    }

    // Optimistically update sidebar if we have name or content_types changes
    if (sidebar && (data.name || data.content_types)) {
      const optimisticItems = updateListInItems(sidebar.items, listId, {
        name: data.name,
        content_types: data.content_types,
      })
      setSidebarOptimistic(optimisticItems)
    }

    try {
      const result = await updateListStore(...args)
      // Invalidate queries for this list since filters may have changed
      await invalidateListQueries(queryClient, result.id)
      return result
    } catch (error) {
      rollbackSidebar()
      // Re-throw so ListModal can display the error in its form UI and manage button state.
      // This differs from other handlers that swallow errors and show toasts, because
      // modal-based operations need error propagation for proper form state management.
      throw error
    }
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
      {/* Quick-add bar: Group/List on left, Bookmark/Note/Collapse on right */}
      {!isCollapsed ? (
        <div className="flex items-center gap-1 px-2 py-1.5 border-b border-gray-200">
          {/* Hidden on mobile - drag-drop doesn't work well on touch */}
          <button
            onClick={handleNewGroup}
            className="hidden md:flex items-center gap-1 rounded-md px-2 py-1 text-xs text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
            title="New Group"
          >
            <PlusIcon className="h-3 w-3" />
            <span>Group</span>
          </button>
          <button
            onClick={handleNewList}
            className="hidden md:flex items-center gap-1 rounded-md px-2 py-1 text-xs text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
            title="New List"
          >
            <PlusIcon className="h-3 w-3" />
            <span>List</span>
          </button>
          <div className="flex-1" />
          <button
            onClick={handleQuickAddBookmark}
            className="p-1.5 rounded-md text-blue-500 hover:bg-blue-50 hover:text-blue-600 transition-colors"
            title="New Bookmark"
          >
            <BookmarkIcon className="h-4 w-4" />
          </button>
          <button
            onClick={handleQuickAddNote}
            className="p-1.5 rounded-md text-green-500 hover:bg-green-50 hover:text-green-600 transition-colors"
            title="New Note"
          >
            <NoteIcon className="h-4 w-4" />
          </button>
          <button
            onClick={handleQuickAddPrompt}
            className="p-1.5 rounded-md text-orange-500 hover:bg-orange-50 hover:text-orange-600 transition-colors"
            title="New Prompt"
          >
            <PromptIcon className="h-4 w-4" />
          </button>
          <button
            onClick={toggleCollapse}
            className="hidden md:block p-1.5 rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
            title="Collapse sidebar"
          >
            <CollapseIcon className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="hidden md:flex items-center justify-center px-2 py-1.5 border-b border-gray-200">
          <button
            onClick={toggleCollapse}
            className="p-1.5 rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
            title="Expand sidebar"
          >
            <CollapseIcon className="h-4 w-4 rotate-180" />
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

          {/* Settings Section (not draggable) */}
          <div className="mt-4 border-t border-gray-200 pt-4">
            <SidebarGroup
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
              <SidebarNavItem
                to="/app/settings/faq"
                label="FAQ"
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

      {/* User Section */}
      <div className="border-t border-gray-200 px-2 h-12 shrink-0 flex items-center overflow-hidden">
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
        className={`fixed inset-y-0 left-0 z-40 w-72 transform bg-white shadow-lg transition-transform md:hidden ${
          isMobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="h-full pt-4">
          <SidebarContent isCollapsed={false} onNavClick={closeMobile} />
        </div>
      </aside>

      {/* Desktop sidebar */}
      <aside
        className={`hidden h-screen flex-shrink-0 border-r border-gray-200 bg-white transition-all md:block ${
          isCollapsed ? 'w-16' : 'w-72'
        }`}
      >
        <div className="h-full overflow-hidden">
          <SidebarContent isCollapsed={isCollapsed} />
        </div>
      </aside>
    </>
  )
}
