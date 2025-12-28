/**
 * Route generation utilities for sidebar navigation.
 */

import type { BuiltinKey } from '../../types'

/**
 * Get the route path for a builtin sidebar item.
 */
export function getBuiltinRoute(key: BuiltinKey): string {
  switch (key) {
    case 'all':
      return '/app/content'
    case 'archived':
      return '/app/content/archived'
    case 'trash':
      return '/app/content/trash'
  }
}

/**
 * Get the route path for a list sidebar item.
 *
 * The route is determined by the list's content_types:
 * - bookmark only → /app/bookmarks/lists/:id
 * - note only → /app/notes/lists/:id
 * - mixed or other → /app/content/lists/:id
 */
export function getListRoute(listId: number, contentTypes: string[]): string {
  const isBookmarkOnly =
    contentTypes.length === 1 && contentTypes[0] === 'bookmark'
  const isNoteOnly = contentTypes.length === 1 && contentTypes[0] === 'note'

  if (isBookmarkOnly) {
    return `/app/bookmarks/lists/${listId}`
  }
  if (isNoteOnly) {
    return `/app/notes/lists/${listId}`
  }
  // Mixed or other content types go to unified content route
  return `/app/content/lists/${listId}`
}
