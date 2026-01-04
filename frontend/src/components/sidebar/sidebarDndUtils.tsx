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
  SidebarListItemComputed,
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
 * Get the appropriate icon for a list based on its content types.
 * Single type shows type-specific icon, multiple types show shared/list icon.
 */
export function getListIcon(contentTypes: string[]): ReactNode {
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
  if (item.type === 'list') return `list:${item.id}`
  return `group:${item.id}`
}

/**
 * Get a unique ID for an item inside a group.
 * Format: "ingroup:{groupId}:{type}:{key|id}"
 */
export function getGroupChildId(
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
export function parseGroupChildId(id: string): {
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
export function computedToMinimal(items: SidebarItemComputed[]): SidebarItem[] {
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
 * Custom collision detection for sidebar drag-and-drop with nested SortableContexts.
 *
 * Behavior:
 * - Pointer anywhere inside a different group's bounds -> drop into that group (dropzone)
 * - Pointer within own group's content area -> reorder among siblings only
 * - Pointer outside all groups -> root-level sorting
 */
export const customCollisionDetection: CollisionDetection = (args) => {
  const activeId = String(args.active.id)
  const activeGroupChild = parseGroupChildId(activeId)
  const sourceGroupId = activeGroupChild?.groupId ?? null
  const isDraggingGroup = activeId.startsWith('group:')

  // Get all sortable collisions (exclude dropzones)
  const sortableContainers = args.droppableContainers.filter(
    (container) => !String(container.id).startsWith('dropzone:')
  )
  const allSortingCollisions = closestCenter({ ...args, droppableContainers: sortableContainers })

  // Helper to get root-only collisions
  const getRootCollisions = () =>
    allSortingCollisions.filter((collision) => {
      const id = String(collision.id)
      return !id.startsWith('ingroup:')
    })

  // Check if pointer is over any group's dropzone
  const dropzoneCollisions = pointerWithin(args).filter(
    (collision) => String(collision.id).startsWith('dropzone:')
  )

  // Find which dropzone (if any) the pointer is currently in
  let currentDropzoneGroupId: string | null = null

  for (const collision of dropzoneCollisions) {
    const groupId = String(collision.id).replace('dropzone:', '')
    const rect = args.droppableRects.get(collision.id)
    if (rect && args.pointerCoordinates) {
      const { y } = args.pointerCoordinates
      if (y >= rect.top && y <= rect.bottom) {
        currentDropzoneGroupId = groupId
        break
      }
    }
  }

  const isInOwnGroup = sourceGroupId !== null && sourceGroupId === currentDropzoneGroupId
  const isOverDifferentGroup = currentDropzoneGroupId !== null && !isInOwnGroup

  // Case 1: Pointer is inside a DIFFERENT group's bounds -> drop into that group
  // Dropzone activates for the entire group area
  // Groups cannot be dropped into other groups
  if (isOverDifferentGroup && !isDraggingGroup) {
    const dropzoneCollision = dropzoneCollisions.find(
      (c) => String(c.id) === `dropzone:${currentDropzoneGroupId}`
    )
    if (dropzoneCollision) {
      return [dropzoneCollision]
    }
  }

  // Case 2: Within own group - return only sibling collisions for reordering
  if (isInOwnGroup && sourceGroupId) {
    const siblingCollisions = allSortingCollisions.filter((collision) => {
      const parsed = parseGroupChildId(String(collision.id))
      return parsed && parsed.groupId === sourceGroupId
    })
    if (siblingCollisions.length > 0) {
      return siblingCollisions
    }
  }

  // Case 3: Dragging an in-group item but pointer is OUTSIDE all groups
  // Return only root-level collisions
  if (sourceGroupId && !currentDropzoneGroupId) {
    const rootCollisions = getRootCollisions()
    if (rootCollisions.length > 0) {
      return rootCollisions
    }
  }

  // Case 4: Dragging a root item (list or builtin, not in any group)
  // Return only root-level collisions
  if (!sourceGroupId && !isDraggingGroup) {
    const rootCollisions = getRootCollisions()
    if (rootCollisions.length > 0) {
      return rootCollisions
    }
  }

  // Case 5: Dragging a group - only allow root-level reordering
  if (isDraggingGroup) {
    const rootCollisions = getRootCollisions()
    if (rootCollisions.length > 0) {
      return rootCollisions
    }
  }

  // Fallback: return root-level collisions only
  return getRootCollisions()
}
