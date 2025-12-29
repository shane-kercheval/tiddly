/**
 * Route generation utilities for sidebar navigation.
 *
 * All content routes use the unified /app/content/* pattern.
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
 * All lists use the unified /app/content/lists/:id route.
 * The list's content_types configuration determines what content is shown,
 * not the URL pattern.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function getListRoute(listId: number, _contentTypes?: string[]): string {
  return `/app/content/lists/${listId}`
}
