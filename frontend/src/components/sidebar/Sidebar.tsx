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
import { useFiltersStore } from '../../stores/filtersStore'
import { useTagsStore } from '../../stores/tagsStore'
import { useTabNavigation } from '../../hooks/useTabNavigation'
import { useCollectionOperations } from '../../hooks/useCollectionOperations'
import { useFilterOperations } from '../../hooks/useFilterOperations'
import { getFirstGroupTags } from '../../utils'
import { SidebarGroup } from './SidebarGroup'
import { SidebarNavItem } from './SidebarNavItem'
import { SidebarUserSection } from './SidebarUserSection'
import { SortableNavItem } from './SortableSidebarItem'
import { SortableCollectionItem } from './SortableSidebarCollection'
import {
  getItemId,
  getCollectionChildId,
  parseCollectionChildId,
  computedToMinimal,
  customCollisionDetection,
} from './sidebarDndUtils'
import { getFilterRoute } from './routes'
import { FilterModal } from '../FilterModal'
import { CollectionModal } from '../CollectionModal'
import {
  SettingsIcon,
  MenuIcon,
  CollapseIcon,
  PlusIcon,
  BookmarkIcon,
  NoteIcon,
  PromptIcon,
} from '../icons'
import { Tooltip } from '../ui'
import type {
  SidebarItemComputed,
  SidebarBuiltinItemComputed,
  SidebarFilterItemComputed,
  SidebarCollectionComputed,
  SidebarOrder,
  ContentFilter,
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
  const filters = useFiltersStore((state) => state.filters)
  const tags = useTagsStore((state) => state.tags)
  const { currentFilterId } = useTabNavigation()

  // CRUD operations hooks
  const {
    createCollection,
    updateCollection,
    renameCollection,
    deleteCollection,
  } = useCollectionOperations()
  const {
    createFilter,
    updateFilter,
    deleteFilter,
  } = useFilterOperations()

  const currentFilter = useMemo(
    () => currentFilterId !== undefined ? filters.find((filter) => filter.id === currentFilterId) : undefined,
    [currentFilterId, filters]
  )
  const initialTagsFromFilter = useMemo(() => getFirstGroupTags(currentFilter), [currentFilter])

  // Modal state
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false)
  const [editingFilter, setEditingFilter] = useState<ContentFilter | undefined>(undefined)
  const [isCollectionModalOpen, setIsCollectionModalOpen] = useState(false)
  const [editingCollection, setEditingCollection] = useState<SidebarCollectionComputed | undefined>(undefined)

  // Drag state
  const [activeId, setActiveId] = useState<string | null>(null)

  const isSettingsExpanded = expandedSections.includes('settings')

  // Quick-add handlers
  const handleQuickAddBookmark = (): void => {
    navigate('/app/bookmarks/new', {
      state: {
        returnTo: location.pathname + location.search,
        initialTags: initialTagsFromFilter,
      },
    })
    onNavClick?.()
  }

  const handleQuickAddNote = (): void => {
    navigate('/app/notes/new', {
      state: {
        returnTo: location.pathname + location.search,
        initialTags: initialTagsFromFilter,
      },
    })
    onNavClick?.()
  }

  const handleQuickAddPrompt = (): void => {
    navigate('/app/prompts/new', {
      state: {
        returnTo: location.pathname + location.search,
        initialTags: initialTagsFromFilter,
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

  // Get full filter data from store by ID
  const getFilterById = useCallback(
    (id: string): ContentFilter | undefined => {
      return filters.find((f) => f.id === id)
    },
    [filters]
  )

  // Compute filters available for collection modal (not already in other collections)
  const getAvailableFiltersForCollection = useCallback(
    (editingCollectionId?: string): ContentFilter[] => {
      if (!sidebar) return filters

      const placedFilterIds = new Set<string>()
      for (const item of sidebar.items) {
        // Skip the collection being edited (its filters should remain available)
        if (item.type === 'collection' && item.id !== editingCollectionId) {
          for (const child of item.items) {
            if (child.type === 'filter') {
              placedFilterIds.add(child.id)
            }
          }
        }
      }

      return filters.filter((f) => !placedFilterIds.has(f.id))
    },
    [sidebar, filters]
  )

  // Open collection modal for creating
  const handleNewCollection = (): void => {
    setEditingCollection(undefined)
    setIsCollectionModalOpen(true)
  }

  // Open collection modal for editing
  const handleEditCollection = (collectionId: string): void => {
    const collection = sidebar?.items.find(
      (item): item is SidebarCollectionComputed => item.type === 'collection' && item.id === collectionId
    )
    if (collection) {
      setEditingCollection(collection)
      setIsCollectionModalOpen(true)
    }
  }

  // Open filter modal for editing
  const handleEditFilter = (filterId: string): void => {
    const filter = getFilterById(filterId)
    if (filter) {
      setEditingFilter(filter)
      setIsFilterModalOpen(true)
    }
  }

  // Delete a filter - wraps hook with navigation
  const handleDeleteFilter = async (filterId: string): Promise<void> => {
    const wasViewingDeletedFilter = currentFilterId === filterId
    const success = await deleteFilter(filterId)
    // Navigate after successful deletion (not before, to avoid confusing state on failure)
    if (success && wasViewingDeletedFilter) {
      navigate('/app/content')
    }
  }

  // Open filter modal for creating
  const handleNewFilter = (): void => {
    setEditingFilter(undefined)
    setIsFilterModalOpen(true)
  }

  // Create filter - wraps hook with navigation
  const handleCreateFilter = async (
    data: Parameters<typeof createFilter>[0]
  ): Promise<Awaited<ReturnType<typeof createFilter>>> => {
    const result = await createFilter(data)
    // Navigate to the new filter using path-based route
    navigate(getFilterRoute(result.id))
    return result
  }

  // Update filter - direct passthrough to hook
  const handleUpdateFilter = updateFilter

  // Drag handlers
  const handleDragStart = (event: DragStartEvent): void => {
    setActiveId(event.active.id as string)
  }

  const handleDragOver = (): void => {
    // Could implement hover highlighting for collections here
  }

  const handleDragEnd = (event: DragEndEvent): void => {
    setActiveId(null)

    const { active, over } = event
    if (!over || active.id === over.id || !sidebar) return

    const activeIdStr = active.id as string
    const overIdStr = over.id as string

    const items = [...sidebar.items]

    // Parse IDs to determine what's being dragged and where
    const activeCollectionChild = parseCollectionChildId(activeIdStr)
    const overCollectionChild = parseCollectionChildId(overIdStr)
    const isOverDropzone = overIdStr.startsWith('dropzone:')
    const isDraggingCollection = activeIdStr.startsWith('collection:')

    // Case 1: Dragging an item within a collection (intra-collection reorder)
    if (activeCollectionChild && overCollectionChild && activeCollectionChild.collectionId === overCollectionChild.collectionId) {
      const collectionIndex = items.findIndex(
        (item): item is SidebarCollectionComputed =>
          item.type === 'collection' && item.id === activeCollectionChild.collectionId
      )
      if (collectionIndex === -1) return

      const collection = items[collectionIndex] as SidebarCollectionComputed
      const collectionItems = [...collection.items]

      const activeChildIndex = collectionItems.findIndex(
        (child) => getCollectionChildId(collection.id, child) === activeIdStr
      )
      const overChildIndex = collectionItems.findIndex(
        (child) => getCollectionChildId(collection.id, child) === overIdStr
      )

      if (activeChildIndex === -1 || overChildIndex === -1) return

      // Reorder within collection
      const [removed] = collectionItems.splice(activeChildIndex, 1)
      collectionItems.splice(overChildIndex, 0, removed)

      items[collectionIndex] = { ...collection, items: collectionItems }

      setSidebarOptimistic(items)
      debouncedUpdateSidebar({ version: SIDEBAR_VERSION, items: computedToMinimal(items) })
      return
    }

    // Case 2: Dragging from a collection to a dropzone (another collection or same collection)
    if (activeCollectionChild && isOverDropzone && !isDraggingCollection) {
      const targetCollectionId = overIdStr.replace('dropzone:', '')

      // Find source and target collections
      const sourceCollectionIndex = items.findIndex(
        (item): item is SidebarCollectionComputed =>
          item.type === 'collection' && item.id === activeCollectionChild.collectionId
      )
      const targetCollectionIndex = items.findIndex(
        (item): item is SidebarCollectionComputed =>
          item.type === 'collection' && item.id === targetCollectionId
      )

      if (sourceCollectionIndex === -1 || targetCollectionIndex === -1) return

      const sourceCollection = items[sourceCollectionIndex] as SidebarCollectionComputed
      const sourceItems = [...sourceCollection.items]

      const activeChildIndex = sourceItems.findIndex(
        (child) => getCollectionChildId(sourceCollection.id, child) === activeIdStr
      )
      if (activeChildIndex === -1) return

      // Remove from source collection
      const [removed] = sourceItems.splice(activeChildIndex, 1)
      items[sourceCollectionIndex] = { ...sourceCollection, items: sourceItems }

      // Add to target collection
      const targetCollection = items[targetCollectionIndex] as SidebarCollectionComputed
      items[targetCollectionIndex] = {
        ...targetCollection,
        items: [...targetCollection.items, removed],
      }

      setSidebarOptimistic(items)
      debouncedUpdateSidebar({ version: SIDEBAR_VERSION, items: computedToMinimal(items) })
      return
    }

    // Case 3: Dragging from a collection to root level
    if (activeCollectionChild && !isOverDropzone && !overCollectionChild) {
      const sourceCollectionIndex = items.findIndex(
        (item): item is SidebarCollectionComputed =>
          item.type === 'collection' && item.id === activeCollectionChild.collectionId
      )
      if (sourceCollectionIndex === -1) return

      const sourceCollection = items[sourceCollectionIndex] as SidebarCollectionComputed
      const sourceItems = [...sourceCollection.items]

      const activeChildIndex = sourceItems.findIndex(
        (child) => getCollectionChildId(sourceCollection.id, child) === activeIdStr
      )
      if (activeChildIndex === -1) return

      // Remove from source collection
      const [removed] = sourceItems.splice(activeChildIndex, 1)
      items[sourceCollectionIndex] = { ...sourceCollection, items: sourceItems }

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

    // Case 4: Dragging from root level to a collection dropzone
    if (!activeCollectionChild && isOverDropzone && !isDraggingCollection) {
      const activeIndex = items.findIndex((item) => getItemId(item) === activeIdStr)
      if (activeIndex === -1) return

      const targetCollectionId = overIdStr.replace('dropzone:', '')
      const targetCollectionIndex = items.findIndex(
        (item): item is SidebarCollectionComputed =>
          item.type === 'collection' && item.id === targetCollectionId
      )
      if (targetCollectionIndex === -1) return

      const targetCollection = items[targetCollectionIndex] as SidebarCollectionComputed
      const [removed] = items.splice(activeIndex, 1)

      const adjustedCollectionIndex =
        activeIndex < targetCollectionIndex ? targetCollectionIndex - 1 : targetCollectionIndex
      items[adjustedCollectionIndex] = {
        ...targetCollection,
        items: [...targetCollection.items, removed as SidebarBuiltinItemComputed | SidebarFilterItemComputed],
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

  // Find the active item for the drag overlay (including items inside collections)
  const activeItem = useMemo((): SidebarItemComputed | SidebarBuiltinItemComputed | SidebarFilterItemComputed | null => {
    if (!activeId || !sidebar) return null

    // Check if it's an item inside a collection
    const collectionChildInfo = parseCollectionChildId(activeId)
    if (collectionChildInfo) {
      // Find the collection and then the child within it
      const collection = sidebar.items.find(
        (item): item is SidebarCollectionComputed =>
          item.type === 'collection' && item.id === collectionChildInfo.collectionId
      )
      if (collection) {
        return collection.items.find(
          (child) => getCollectionChildId(collection.id, child) === activeId
        ) ?? null
      }
      return null
    }

    // Otherwise look at root level
    return sidebar.items.find((item) => getItemId(item) === activeId) ?? null
  }, [activeId, sidebar])

  // Render a builtin or filter item
  const renderNavItem = (
    item: SidebarBuiltinItemComputed | SidebarFilterItemComputed
  ): ReactNode => (
    <SortableNavItem
      key={getItemId(item)}
      item={item}
      isCollapsed={isCollapsed}
      onNavClick={onNavClick}
      onEdit={item.type === 'filter' ? () => handleEditFilter(item.id) : undefined}
      onDelete={item.type === 'filter' ? () => handleDeleteFilter(item.id) : undefined}
      isDragging={activeId === getItemId(item)}
    />
  )

  // Render a sidebar item based on type
  const renderItem = (item: SidebarItemComputed): ReactNode => {
    if (item.type === 'collection') {
      return (
        <SortableCollectionItem
          key={getItemId(item)}
          item={item}
          isCollapsed={isCollapsed}
          isGroupCollapsed={isGroupCollapsed(item.id)}
          onToggleGroup={() => toggleGroup(item.id)}
          onNavClick={onNavClick}
          onEditFilter={handleEditFilter}
          onDeleteFilter={handleDeleteFilter}
          onEditCollection={() => handleEditCollection(item.id)}
          onRenameCollection={(newName) => renameCollection(item.id, newName)}
          onDeleteCollection={() => deleteCollection(item.id)}
          isDragging={activeId === getItemId(item)}
          activeId={activeId}
        />
      )
    }
    return renderNavItem(item)
  }

  return (
    <div className="flex h-full flex-col">
      {/* Quick-add bar: Collection/Filter on left, Bookmark/Note/Prompt on right */}
      {!isCollapsed && (
        <div className="flex items-center gap-1 px-2 py-1.5 border-b border-gray-200">
          {/* Hidden on mobile - drag-drop doesn't work well on touch */}
          <button
            onClick={handleNewCollection}
            className="hidden md:flex items-center gap-1 rounded-md px-2 py-1 text-xs text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
            aria-label="New Collection"
          >
            <PlusIcon className="h-3 w-3" />
            <span>Collection</span>
          </button>
          <button
            onClick={handleNewFilter}
            className="hidden md:flex items-center gap-1 rounded-md px-2 py-1 text-xs text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
            aria-label="New Filter"
          >
            <PlusIcon className="h-3 w-3" />
            <span>Filter</span>
          </button>
          <div className="flex-1" />
          <Tooltip content="New Bookmark" compact>
            <button
              onClick={handleQuickAddBookmark}
              className="p-1.5 rounded-md text-brand-bookmark hover:bg-brand-bookmark-light hover:text-brand-bookmark transition-colors"
              aria-label="New Bookmark"
            >
              <BookmarkIcon className="h-4 w-4" />
            </button>
          </Tooltip>
          <Tooltip content="New Note" compact>
            <button
              onClick={handleQuickAddNote}
              className="p-1.5 rounded-md text-brand-note hover:bg-brand-note-light hover:text-brand-note transition-colors"
              aria-label="New Note"
            >
              <NoteIcon className="h-4 w-4" />
            </button>
          </Tooltip>
          <Tooltip content="New Prompt" compact>
            <button
              onClick={handleQuickAddPrompt}
              className="p-1.5 rounded-md text-brand-prompt hover:bg-brand-prompt-light hover:text-brand-prompt transition-colors"
              aria-label="New Prompt"
            >
              <PromptIcon className="h-4 w-4" />
            </button>
          </Tooltip>
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
        <nav className="flex-1 space-y-0.5 overflow-y-auto overflow-x-hidden px-2 pt-2">
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
                label="AI Integration"
                isCollapsed={isCollapsed}
                onClick={onNavClick}
              />
              <SidebarNavItem
                to="/app/settings/history"
                label="Version History"
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
                {activeItem.name}
              </span>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {/* User Section */}
      <div className={`border-t border-gray-200 px-2 shrink-0 flex items-center overflow-hidden ${isCollapsed ? 'h-20 py-2' : 'h-12'}`}>
        <SidebarUserSection isCollapsed={isCollapsed} onToggleCollapse={toggleCollapse} />
      </div>

      {/* Filter Modal */}
      <FilterModal
        isOpen={isFilterModalOpen}
        onClose={() => {
          setIsFilterModalOpen(false)
          setEditingFilter(undefined)
        }}
        filter={editingFilter}
        tagSuggestions={tags}
        onCreate={handleCreateFilter}
        onUpdate={handleUpdateFilter}
      />

      {/* Collection Modal */}
      <CollectionModal
        isOpen={isCollectionModalOpen}
        onClose={() => {
          setIsCollectionModalOpen(false)
          setEditingCollection(undefined)
        }}
        collection={editingCollection}
        availableFilters={getAvailableFiltersForCollection(editingCollection?.id)}
        onCreate={createCollection}
        onUpdate={updateCollection}
      />
    </div>
  )
}

export function Sidebar(): ReactNode {
  const { isCollapsed, isMobileOpen, toggleMobile, closeMobile } = useSidebarStore()

  return (
    <>
      {/* Mobile menu button - bottom left, hidden when sidebar is open */}
      {!isMobileOpen && (
        <button
          onClick={toggleMobile}
          className="fixed left-4 bottom-4 z-50 rounded-lg bg-white p-2 shadow-md md:hidden"
          aria-label="Open menu"
        >
          <MenuIcon />
        </button>
      )}

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
        <div className="h-full flex flex-col">
          <div className="flex-1 overflow-hidden">
            <SidebarContent isCollapsed={false} onNavClick={closeMobile} />
          </div>
          {/* Mobile close button - chevron at bottom matching desktop style */}
          <div className="border-t border-gray-200 px-2 py-2 shrink-0">
            <button
              onClick={closeMobile}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
              title="Close menu"
            >
              <CollapseIcon className="h-4 w-4" />
              <span>Close menu</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Desktop sidebar */}
      <aside
        id="desktop-sidebar"
        className={`hidden h-dvh flex-shrink-0 border-r border-gray-200 bg-white transition-all md:block ${
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
