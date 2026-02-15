/**
 * Tests for useHistory hooks and query key factory.
 *
 * Focuses on:
 * - Query key sorting for cache stability
 * - Query parameter serialization
 * - Empty arrays not adding params
 */
import { describe, it, expect } from 'vitest'
import { historyKeys } from './useHistory'
import type { ContentType, HistoryActionType } from '../types'

describe('historyKeys', () => {
  describe('user', () => {
    it('should produce same query key regardless of array order', () => {
      const key1 = historyKeys.user({
        contentTypes: ['bookmark', 'note'],
        actions: ['update', 'create'],
        sources: ['web', 'api'],
      })
      const key2 = historyKeys.user({
        contentTypes: ['note', 'bookmark'],
        actions: ['create', 'update'],
        sources: ['api', 'web'],
      })

      // Keys should be identical after sorting
      expect(JSON.stringify(key1)).toEqual(JSON.stringify(key2))
    })

    it('should include all filter params in query key', () => {
      const key = historyKeys.user({
        contentTypes: ['bookmark'],
        actions: ['create'],
        sources: ['web'],
        startDate: '2024-01-01T00:00:00Z',
        endDate: '2024-01-31T23:59:59Z',
        limit: 50,
        offset: 100,
      })

      expect(key).toEqual([
        'history',
        'user',
        {
          contentTypes: ['bookmark'],
          actions: ['create'],
          sources: ['web'],
          startDate: '2024-01-01T00:00:00Z',
          endDate: '2024-01-31T23:59:59Z',
          limit: 50,
          offset: 100,
        },
      ])
    })

    it('should handle undefined arrays', () => {
      const key = historyKeys.user({
        limit: 50,
      })

      expect(key).toEqual([
        'history',
        'user',
        {
          contentTypes: undefined,
          actions: undefined,
          sources: undefined,
          limit: 50,
        },
      ])
    })

    it('should normalize empty arrays to undefined (same key as no filter)', () => {
      const keyWithEmptyArrays = historyKeys.user({
        contentTypes: [],
        actions: [],
        sources: [],
        limit: 50,
      })

      const keyWithUndefined = historyKeys.user({
        contentTypes: undefined,
        actions: undefined,
        sources: undefined,
        limit: 50,
      })

      // Empty arrays and undefined should produce identical keys
      expect(JSON.stringify(keyWithEmptyArrays)).toEqual(JSON.stringify(keyWithUndefined))

      // Both should have undefined for the array fields
      const params = keyWithEmptyArrays[2] as Record<string, unknown>
      expect(params.contentTypes).toBeUndefined()
      expect(params.actions).toBeUndefined()
      expect(params.sources).toBeUndefined()
    })

    it('should sort arrays of multiple elements', () => {
      const key = historyKeys.user({
        contentTypes: ['prompt', 'bookmark', 'note'],
        actions: ['update', 'delete', 'archive', 'create'],
        sources: ['mcp-prompt', 'api', 'web', 'mcp-content'],
      })

      const params = key[2] as Record<string, unknown>
      expect(params.contentTypes).toEqual(['bookmark', 'note', 'prompt'])
      expect(params.actions).toEqual(['archive', 'create', 'delete', 'update'])
      expect(params.sources).toEqual(['api', 'mcp-content', 'mcp-prompt', 'web'])
    })

    it('should not mutate original arrays', () => {
      const originalEntityTypes: ContentType[] = ['note', 'bookmark']
      const originalActions: HistoryActionType[] = ['update', 'create']
      const originalSources: string[] = ['api', 'web']

      historyKeys.user({
        contentTypes: originalEntityTypes,
        actions: originalActions,
        sources: originalSources,
      })

      // Original arrays should be unchanged
      expect(originalEntityTypes).toEqual(['note', 'bookmark'])
      expect(originalActions).toEqual(['update', 'create'])
      expect(originalSources).toEqual(['api', 'web'])
    })
  })

  describe('entity', () => {
    it('should include entity type and id in key', () => {
      const key = historyKeys.entity('bookmark', '123', { limit: 50 })

      expect(key).toEqual(['history', 'bookmark', '123', { limit: 50 }])
    })
  })

  describe('diff', () => {
    it('should include entity type, id, and version in key', () => {
      const key = historyKeys.diff('bookmark', '789', 5)

      expect(key).toEqual(['history', 'bookmark', '789', 'diff', 5])
    })
  })
})
