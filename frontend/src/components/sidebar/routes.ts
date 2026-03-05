/**
 * Route generation utilities for sidebar navigation.
 *
 * All content routes use the unified /app/content/* pattern.
 */

import type { NavigableBuiltinKey } from '../../types'

/**
 * Get the route path for a navigable builtin sidebar item.
 * Only accepts NavigableBuiltinKey — use isNavigableBuiltin() to narrow first.
 */
export function getBuiltinRoute(key: NavigableBuiltinKey): string {
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
 * Get the route path for a filter sidebar item.
 *
 * All filters use the unified /app/content/filters/:id route.
 * The filter's content_types configuration determines what content is shown,
 * not the URL pattern.
 */
export function getFilterRoute(filterId: string): string {
  return `/app/content/filters/${filterId}`
}
