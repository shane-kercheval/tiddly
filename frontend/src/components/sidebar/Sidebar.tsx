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
import { queryClient } from '../../queryClient'
import { invalidateFilterQueries } from '../../utils/invalidateFilterQueries'
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
  SidebarFilterItemComputed,
  SidebarCollectionComputed,
  SidebarOrder,
  ContentFilter,
  ContentType,
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
  const filters = useFiltersStore((state) => state.filters)
  const deleteFilter = useFiltersStore((state) => state.deleteFilter)
  const tags = useTagsStore((state) => state.tags)
  const { currentFilterId } = useTabNavigation()

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

  // Create a new collection via modal - optimistic update
  const handleCreateCollection = async (name: string, filterIds: string[]): Promise<void> => {
    if (!sidebar) return

    // Build collection items from filter IDs
    const collectionItems = filterIds
      .map((id) => {
        const filter = getFilterById(id)
        if (!filter) return null
        return {
          type: 'filter' as const,
          id: filter.id,
          name: filter.name,
          content_types: filter.content_types,
        }
      })
      .filter((item): item is SidebarFilterItemComputed => item !== null)

    const newCollectionComputed: SidebarCollectionComputed = {
      type: 'collection',
      id: crypto.randomUUID(),
      name,
      items: collectionItems,
    }

    // Remove filters that are now in the collection from root level
    const filterIdsInCollection = new Set(filterIds)
    const filteredRootItems = sidebar.items.filter(
      (item) => !(item.type === 'filter' && filterIdsInCollection.has(item.id))
    )

    // Optimistically add to UI
    const optimisticItems = [newCollectionComputed, ...filteredRootItems]
    setSidebarOptimistic(optimisticItems)

    const updatedSidebar: SidebarOrder = {
      version: SIDEBAR_VERSION,
      items: computedToMinimal(optimisticItems),
    }

    try {
      await updateSidebar(updatedSidebar)
    } catch {
      rollbackSidebar()
      throw new Error('Failed to create collection')
    }
  }

  // Update an existing collection via modal - optimistic update
  const handleUpdateCollection = async (id: string, name: string, filterIds: string[]): Promise<void> => {
    if (!sidebar) return

    // Build collection items from filter IDs
    const collectionItems = filterIds
      .map((filterId) => {
        const filter = getFilterById(filterId)
        if (!filter) return null
        return {
          type: 'filter' as const,
          id: filter.id,
          name: filter.name,
          content_types: filter.content_types,
        }
      })
      .filter((item): item is SidebarFilterItemComputed => item !== null)

    // Find the old collection to get its previous filter IDs
    const oldCollection = sidebar.items.find(
      (item): item is SidebarCollectionComputed => item.type === 'collection' && item.id === id
    )
    const oldFilterIds = new Set(
      oldCollection?.items.filter((item) => item.type === 'filter').map((item) => item.id) ?? []
    )
    const newFilterIds = new Set(filterIds)

    // Filters removed from collection should go back to root (at the end)
    const removedFilterItems: SidebarFilterItemComputed[] = []
    for (const filterId of oldFilterIds) {
      if (!newFilterIds.has(filterId)) {
        const filter = getFilterById(filterId)
        if (filter) {
          removedFilterItems.push({
            type: 'filter',
            id: filter.id,
            name: filter.name,
            content_types: filter.content_types,
          })
        }
      }
    }

    // Filters added to collection should be removed from root
    const optimisticItems = sidebar.items
      .filter((item) => !(item.type === 'filter' && newFilterIds.has(item.id) && !oldFilterIds.has(item.id)))
      .map((item) => {
        if (item.type === 'collection' && item.id === id) {
          return { ...item, name, items: collectionItems }
        }
        return item
      })

    // Add removed filters to root
    optimisticItems.push(...removedFilterItems)

    setSidebarOptimistic(optimisticItems)

    try {
      await updateSidebar({ version: SIDEBAR_VERSION, items: computedToMinimal(optimisticItems) })
    } catch {
      rollbackSidebar()
      throw new Error('Failed to update collection')
    }
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

  // Rename a collection - optimistic update
  const handleRenameCollection = async (collectionId: string, newName: string): Promise<void> => {
    if (!sidebar) return

    // Optimistically update UI
    const optimisticItems = sidebar.items.map((item) => {
      if (item.type === 'collection' && item.id === collectionId) {
        return { ...item, name: newName }
      }
      return item
    })
    setSidebarOptimistic(optimisticItems)

    try {
      await updateSidebar({ version: SIDEBAR_VERSION, items: computedToMinimal(optimisticItems) })
    } catch {
      rollbackSidebar()
      toast.error('Failed to rename collection')
    }
  }

  // Delete a collection (moves contents to root) - optimistic update
  const handleDeleteCollection = async (collectionId: string): Promise<void> => {
    if (!sidebar) return

    const collection = sidebar.items.find(
      (item): item is SidebarCollectionComputed => item.type === 'collection' && item.id === collectionId
    )

    if (!collection) return

    // Optimistically update UI - replace collection with its contents
    const optimisticItems = sidebar.items.flatMap((item) => {
      if (item.type === 'collection' && item.id === collectionId) {
        return item.items // Return the collection's children directly
      }
      return [item]
    })
    setSidebarOptimistic(optimisticItems)

    try {
      await updateSidebar({ version: SIDEBAR_VERSION, items: computedToMinimal(optimisticItems) })
    } catch {
      rollbackSidebar()
      toast.error('Failed to delete collection')
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

  // Delete a filter (confirmation is handled in SidebarNavItem) - optimistic update
  const handleDeleteFilter = async (filterId: string): Promise<void> => {
    // Helper to recursively remove filter from sidebar items (including from collections)
    const removeFilterFromItems = (items: SidebarItemComputed[]): SidebarItemComputed[] => {
      return items
        .filter((item) => !(item.type === 'filter' && item.id === filterId))
        .map((item) => {
          if (item.type === 'collection') {
            return {
              ...item,
              items: item.items.filter((child) => !(child.type === 'filter' && child.id === filterId)),
            }
          }
          return item
        })
    }

    // Optimistically remove from sidebar (instant visual feedback)
    if (sidebar) {
      const optimisticItems = removeFilterFromItems(sidebar.items)
      setSidebarOptimistic(optimisticItems)
    }

    const wasViewingDeletedFilter = currentFilterId === filterId

    try {
      await deleteFilter(filterId)
      // Navigate after successful deletion (not before, to avoid confusing state on failure)
      if (wasViewingDeletedFilter) {
        navigate('/app/content')
      }
    } catch {
      rollbackSidebar()
      toast.error('Failed to delete filter')
    }
  }

  // Open filter modal for creating
  const handleNewFilter = (): void => {
    setEditingFilter(undefined)
    setIsFilterModalOpen(true)
  }

  // Filter modal handlers - wrap to refresh sidebar after changes
  const createFilter = useFiltersStore((state) => state.createFilter)
  const updateFilterStore = useFiltersStore((state) => state.updateFilter)

  const handleCreateFilter = async (
    ...args: Parameters<typeof createFilter>
  ): Promise<Awaited<ReturnType<typeof createFilter>>> => {
    const result = await createFilter(...args)
    // Refresh sidebar to show new filter
    await fetchSidebar()
    // Move the new filter to the top of the sidebar
    const currentSidebar = useSettingsStore.getState().sidebar
    if (currentSidebar) {
      const newFilterItem = { type: 'filter' as const, id: result.id }
      const otherItems = computedToMinimal(currentSidebar.items).filter(
        (item) => !(item.type === 'filter' && item.id === result.id)
      )
      await updateSidebar({
        version: SIDEBAR_VERSION,
        items: [newFilterItem, ...otherItems],
      })
    }
    // Navigate to the new filter using path-based route
    navigate(getFilterRoute(result.id))
    return result
  }

  const handleUpdateFilter = async (
    ...args: Parameters<typeof updateFilterStore>
  ): Promise<Awaited<ReturnType<typeof updateFilterStore>>> => {
    const [filterId, data] = args

    // Helper to update filter in sidebar items (including in collections)
    const updateFilterInItems = (
      items: SidebarItemComputed[],
      id: string,
      updates: { name?: string; content_types?: ContentType[] }
    ): SidebarItemComputed[] => {
      return items.map((item) => {
        if (item.type === 'filter' && item.id === id) {
          return { ...item, ...updates }
        }
        if (item.type === 'collection') {
          return {
            ...item,
            items: item.items.map((child) =>
              child.type === 'filter' && child.id === id
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
      const optimisticItems = updateFilterInItems(sidebar.items, filterId, {
        name: data.name,
        content_types: data.content_types,
      })
      setSidebarOptimistic(optimisticItems)
    }

    try {
      const result = await updateFilterStore(...args)
      // Invalidate queries for this filter since filter expression may have changed
      await invalidateFilterQueries(queryClient, result.id)
      return result
    } catch (error) {
      rollbackSidebar()
      // Re-throw so FilterModal can display the error in its form UI and manage button state.
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
          onRenameCollection={(newName) => handleRenameCollection(item.id, newName)}
          onDeleteCollection={() => handleDeleteCollection(item.id)}
          isDragging={activeId === getItemId(item)}
          activeId={activeId}
        />
      )
    }
    return renderNavItem(item)
  }

  return (
    <div className="flex h-full flex-col">
      {/* Quick-add bar: Collection/Filter on left, Bookmark/Note/Collapse on right */}
      {!isCollapsed ? (
        <div className="flex items-center gap-1 px-2 py-1.5 border-b border-gray-200">
          {/* Hidden on mobile - drag-drop doesn't work well on touch */}
          <button
            onClick={handleNewCollection}
            className="hidden md:flex items-center gap-1 rounded-md px-2 py-1 text-xs text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
            title="New Collection"
          >
            <PlusIcon className="h-3 w-3" />
            <span>Collection</span>
          </button>
          <button
            onClick={handleNewFilter}
            className="hidden md:flex items-center gap-1 rounded-md px-2 py-1 text-xs text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
            title="New Filter"
          >
            <PlusIcon className="h-3 w-3" />
            <span>Filter</span>
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
                {activeItem.name}
              </span>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {/* User Section */}
      <div className="border-t border-gray-200 px-2 h-12 shrink-0 flex items-center overflow-hidden">
        <SidebarUserSection isCollapsed={isCollapsed} />
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
        onCreate={handleCreateCollection}
        onUpdate={handleUpdateCollection}
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
