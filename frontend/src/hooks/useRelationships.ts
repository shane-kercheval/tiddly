/**
 * TanStack Query key factory for content relationships.
 *
 * Provides query key helpers for relationship cache management.
 * Relationship mutations now go through entity create/update payloads
 * rather than standalone API calls.
 */
import type { ContentType } from '../types'

/**
 * Query key factory for relationship cache keys.
 *
 * Key Structure:
 * - ['relationships']                              - all relationship queries
 * - ['relationships', 'content', type, id]         - base key for a content item
 */
export const relationshipKeys = {
  all: ['relationships'] as const,
  forContent: (type: ContentType, id: string) =>
    [...relationshipKeys.all, 'content', type, id] as const,
}
