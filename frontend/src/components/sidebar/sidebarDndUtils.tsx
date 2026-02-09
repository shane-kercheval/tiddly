/**
 * Utility functions and collision detection for sidebar drag-and-drop.
 */
import type { ReactNode } from 'react'
import { closestCenter, pointerWithin, type CollisionDetection } from '@dnd-kit/core'
import {
  ArchiveIcon,
  TrashIcon,
  BookmarkIcon,
  NoteIcon,
  PromptIcon,
  ListIcon,
} from '../icons'
import type {
  BuiltinKey,
  SidebarItemComputed,
  SidebarBuiltinItemComputed,
  SidebarFilterItemComputed,
  SidebarItem,
} from '../../types'
import { CONTENT_TYPE_ICON_COLORS } from '../../constants/contentTypeStyles'

/**
 * Get the appropriate icon for a builtin sidebar item.
 */
export function getBuiltinIcon(key: BuiltinKey): ReactNode {
  switch (key) {
    case 'all':
      return <ListIcon className="h-4 w-4 text-purple-600" />
    case 'archived':
      return <ArchiveIcon className="h-4 w-4 text-gray-500" />
    case 'trash':
      return <TrashIcon className="h-4 w-4 text-red-500" />
  }
}

/**
 * Get the appropriate icon for a filter based on its content types.
 * Single type shows type-specific icon, multiple types show shared/list icon.
 */
export function getFilterIcon(contentTypes: string[]): ReactNode {
  const hasBookmarks = contentTypes.includes('bookmark')
  const hasNotes = contentTypes.includes('note')
  const hasPrompts = contentTypes.includes('prompt')

  // Count how many types are present
  const typeCount = [hasBookmarks, hasNotes, hasPrompts].filter(Boolean).length

  // Single type - show type-specific icon
  if (typeCount === 1) {
    if (hasBookmarks) {
      return <BookmarkIcon className={`h-4 w-4 ${CONTENT_TYPE_ICON_COLORS.bookmark}`} />
    }
    if (hasNotes) {
      return <NoteIcon className={`h-4 w-4 ${CONTENT_TYPE_ICON_COLORS.note}`} />
    }
    if (hasPrompts) {
      return <PromptIcon className={`h-4 w-4 ${CONTENT_TYPE_ICON_COLORS.prompt}`} />
    }
  }

  // Multiple types or none - use shared/list icon
  return <ListIcon className="h-4 w-4 text-purple-500" />
}

/**
 * Get a unique ID for a sidebar item (for drag-and-drop).
 */
export function getItemId(item: SidebarItemComputed): string {
  if (item.type === 'builtin') return `builtin:${item.key}`
  if (item.type === 'filter') return `filter:${item.id}`
  return `collection:${item.id}`
}

/**
 * Get a unique ID for an item inside a collection.
 * Format: "incollection:{collectionId}:{type}:{key|id}"
 */
export function getCollectionChildId(
  collectionId: string,
  child: SidebarBuiltinItemComputed | SidebarFilterItemComputed
): string {
  if (child.type === 'builtin') return `incollection:${collectionId}:builtin:${child.key}`
  return `incollection:${collectionId}:filter:${child.id}`
}

/**
 * Parse a collection child ID back to its components.
 * Returns null if not a valid collection child ID.
 */
export function parseCollectionChildId(id: string): {
  collectionId: string
  type: 'builtin' | 'filter'
  key?: string
  filterId?: string
} | null {
  if (!id.startsWith('incollection:')) return null
  const parts = id.split(':')
  if (parts.length !== 4) return null
  const [, collectionId, type, keyOrId] = parts
  if (type === 'builtin') {
    return { collectionId, type: 'builtin', key: keyOrId }
  }
  if (type === 'filter') {
    return { collectionId, type: 'filter', filterId: keyOrId }
  }
  return null
}

/**
 * Convert computed sidebar back to minimal format for API updates.
 */
export function computedToMinimal(items: SidebarItemComputed[]): SidebarItem[] {
  return items.map((item): SidebarItem => {
    if (item.type === 'builtin') {
      return { type: 'builtin', key: item.key }
    }
    if (item.type === 'filter') {
      return { type: 'filter', id: item.id }
    }
    // Collection
    return {
      type: 'collection',
      id: item.id,
      name: item.name,
      items: item.items.map((child) =>
        child.type === 'builtin'
          ? { type: 'builtin' as const, key: child.key }
          : { type: 'filter' as const, id: child.id }
      ),
    }
  })
}

/**
 * Custom collision detection for sidebar drag-and-drop with nested SortableContexts.
 *
 * State Machine:
 * ┌─────────────────────────────────────────────────────────────────────────────────┐
 * │ Dragging Item             │ Pointer Location           │ Result                 │
 * ├───────────────────────────┼────────────────────────────┼────────────────────────┤
 * │ Collection child          │ Same collection            │ Reorder among siblings │
 * │ Collection child          │ Different collection       │ Move to that collection│
 * │ Collection child          │ Root area (outside all)    │ Extract to root level  │
 * │ Root item (filter/builtin)│ Over collection dropzone   │ Insert into collection │
 * │ Root item (filter/builtin)│ Root area                  │ Reorder at root        │
 * │ Collection                │ Anywhere                   │ Reorder at root only   │
 * └─────────────────────────────────────────────────────────────────────────────────┘
 *
 * Note: Collections cannot be dropped into other collections (no nesting).
 */
export const customCollisionDetection: CollisionDetection = (args) => {
  const activeId = String(args.active.id)
  const activeCollectionChild = parseCollectionChildId(activeId)
  const sourceCollectionId = activeCollectionChild?.collectionId ?? null
  const isDraggingCollection = activeId.startsWith('collection:')

  // Get all sortable collisions (exclude dropzones)
  const sortableContainers = args.droppableContainers.filter(
    (container) => !String(container.id).startsWith('dropzone:')
  )
  const allSortingCollisions = closestCenter({ ...args, droppableContainers: sortableContainers })

  // Helper to get root-only collisions
  const getRootCollisions = () =>
    allSortingCollisions.filter((collision) => {
      const id = String(collision.id)
      return !id.startsWith('incollection:')
    })

  // Check if pointer is over any collection's dropzone
  const dropzoneCollisions = pointerWithin(args).filter(
    (collision) => String(collision.id).startsWith('dropzone:')
  )

  // Find which dropzone (if any) the pointer is currently in
  let currentDropzoneCollectionId: string | null = null

  for (const collision of dropzoneCollisions) {
    const collectionId = String(collision.id).replace('dropzone:', '')
    const rect = args.droppableRects.get(collision.id)
    if (rect && args.pointerCoordinates) {
      const { y } = args.pointerCoordinates
      if (y >= rect.top && y <= rect.bottom) {
        currentDropzoneCollectionId = collectionId
        break
      }
    }
  }

  const isInOwnCollection = sourceCollectionId !== null && sourceCollectionId === currentDropzoneCollectionId
  const isOverDifferentCollection = currentDropzoneCollectionId !== null && !isInOwnCollection

  // Case 1: Pointer is inside a DIFFERENT collection's bounds -> drop into that collection
  // Dropzone activates for the entire collection area
  // Collections cannot be dropped into other collections
  if (isOverDifferentCollection && !isDraggingCollection) {
    const dropzoneCollision = dropzoneCollisions.find(
      (c) => String(c.id) === `dropzone:${currentDropzoneCollectionId}`
    )
    if (dropzoneCollision) {
      return [dropzoneCollision]
    }
  }

  // Case 2: Within own collection - return only sibling collisions for reordering
  if (isInOwnCollection && sourceCollectionId) {
    const siblingCollisions = allSortingCollisions.filter((collision) => {
      const parsed = parseCollectionChildId(String(collision.id))
      return parsed && parsed.collectionId === sourceCollectionId
    })
    if (siblingCollisions.length > 0) {
      return siblingCollisions
    }
  }

  // Case 3: Dragging an in-collection item but pointer is OUTSIDE all collections
  // Return only root-level collisions
  if (sourceCollectionId && !currentDropzoneCollectionId) {
    const rootCollisions = getRootCollisions()
    if (rootCollisions.length > 0) {
      return rootCollisions
    }
  }

  // Case 4: Dragging a root item (filter or builtin, not in any collection)
  // Return only root-level collisions
  if (!sourceCollectionId && !isDraggingCollection) {
    const rootCollisions = getRootCollisions()
    if (rootCollisions.length > 0) {
      return rootCollisions
    }
  }

  // Case 5: Dragging a collection - only allow root-level reordering
  if (isDraggingCollection) {
    const rootCollisions = getRootCollisions()
    if (rootCollisions.length > 0) {
      return rootCollisions
    }
  }

  // Fallback: return root-level collisions only
  return getRootCollisions()
}
