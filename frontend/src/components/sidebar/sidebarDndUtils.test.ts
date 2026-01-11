/**
 * Tests for sidebar drag-and-drop utility functions.
 */
import { describe, it, expect } from 'vitest'
import {
  getItemId,
  getCollectionChildId,
  parseCollectionChildId,
  computedToMinimal,
  getBuiltinIcon,
  getFilterIcon,
} from './sidebarDndUtils'
import type {
  SidebarItemComputed,
  SidebarBuiltinItemComputed,
  SidebarFilterItemComputed,
  SidebarCollectionComputed,
} from '../../types'

describe('sidebarDndUtils', () => {
  describe('getBuiltinIcon', () => {
    it('should return an icon for "all"', () => {
      const icon = getBuiltinIcon('all')
      expect(icon).toBeDefined()
    })

    it('should return an icon for "archived"', () => {
      const icon = getBuiltinIcon('archived')
      expect(icon).toBeDefined()
    })

    it('should return an icon for "trash"', () => {
      const icon = getBuiltinIcon('trash')
      expect(icon).toBeDefined()
    })
  })

  describe('getFilterIcon', () => {
    it('should return bookmark icon for bookmark-only filters', () => {
      const icon = getFilterIcon(['bookmark'])
      expect(icon).toBeDefined()
    })

    it('should return note icon for note-only filters', () => {
      const icon = getFilterIcon(['note'])
      expect(icon).toBeDefined()
    })

    it('should return list/shared icon for mixed content types', () => {
      const icon = getFilterIcon(['bookmark', 'note'])
      expect(icon).toBeDefined()
    })

    it('should return list/shared icon for empty content types', () => {
      const icon = getFilterIcon([])
      expect(icon).toBeDefined()
    })
  })

  describe('getItemId', () => {
    it('should return correct ID for builtin item', () => {
      const item: SidebarBuiltinItemComputed = {
        type: 'builtin',
        key: 'all',
        name: 'All Content',
      }
      expect(getItemId(item)).toBe('builtin:all')
    })

    it('should return correct ID for filter item', () => {
      const item: SidebarFilterItemComputed = {
        type: 'filter',
        id: '42',
        name: 'My Filter',
        content_types: ['bookmark'],
      }
      expect(getItemId(item)).toBe('filter:42')
    })

    it('should return correct ID for collection item', () => {
      const item: SidebarCollectionComputed = {
        type: 'collection',
        id: 'abc-123',
        name: 'Work',
        items: [],
      }
      expect(getItemId(item)).toBe('collection:abc-123')
    })

    it('should handle all builtin keys', () => {
      const builtins: SidebarBuiltinItemComputed[] = [
        { type: 'builtin', key: 'all', name: 'All Content' },
        { type: 'builtin', key: 'archived', name: 'Archived' },
        { type: 'builtin', key: 'trash', name: 'Trash' },
      ]

      expect(getItemId(builtins[0])).toBe('builtin:all')
      expect(getItemId(builtins[1])).toBe('builtin:archived')
      expect(getItemId(builtins[2])).toBe('builtin:trash')
    })
  })

  describe('getCollectionChildId', () => {
    it('should return correct ID for builtin child in collection', () => {
      const child: SidebarBuiltinItemComputed = {
        type: 'builtin',
        key: 'archived',
        name: 'Archived',
      }
      expect(getCollectionChildId('collection-123', child)).toBe('incollection:collection-123:builtin:archived')
    })

    it('should return correct ID for filter child in collection', () => {
      const child: SidebarFilterItemComputed = {
        type: 'filter',
        id: '99',
        name: 'My Filter',
        content_types: ['note'],
      }
      expect(getCollectionChildId('collection-456', child)).toBe('incollection:collection-456:filter:99')
    })

    it('should work with UUID format collection IDs', () => {
      const child: SidebarFilterItemComputed = {
        type: 'filter',
        id: '1',
        name: 'Test',
        content_types: [],
      }
      expect(getCollectionChildId('550e8400-e29b-41d4-a716-446655440000', child)).toBe(
        'incollection:550e8400-e29b-41d4-a716-446655440000:filter:1'
      )
    })
  })

  describe('parseCollectionChildId', () => {
    it('should return null for non-incollection ID', () => {
      expect(parseCollectionChildId('builtin:all')).toBeNull()
      expect(parseCollectionChildId('filter:5')).toBeNull()
      expect(parseCollectionChildId('collection:abc')).toBeNull()
    })

    it('should return null for malformed incollection ID', () => {
      expect(parseCollectionChildId('incollection:only-two-parts')).toBeNull()
      expect(parseCollectionChildId('incollection:one:two:three:four:five')).toBeNull()
    })

    it('should parse builtin child ID correctly', () => {
      const result = parseCollectionChildId('incollection:collection-123:builtin:archived')

      expect(result).toEqual({
        collectionId: 'collection-123',
        type: 'builtin',
        key: 'archived',
      })
    })

    it('should parse filter child ID correctly', () => {
      const result = parseCollectionChildId('incollection:collection-456:filter:99')

      expect(result).toEqual({
        collectionId: 'collection-456',
        type: 'filter',
        filterId: '99',
      })
    })

    it('should handle UUID format collection IDs', () => {
      const result = parseCollectionChildId('incollection:550e8400-e29b-41d4-a716-446655440000:filter:42')

      expect(result).toEqual({
        collectionId: '550e8400-e29b-41d4-a716-446655440000',
        type: 'filter',
        filterId: '42',
      })
    })

    it('should return null for invalid type', () => {
      const result = parseCollectionChildId('incollection:collection-123:invalid:foo')
      expect(result).toBeNull()
    })

    it('should handle filter ID that parses to string', () => {
      const result = parseCollectionChildId('incollection:abc:filter:123')
      expect(result?.filterId).toBe('123')
    })
  })

  describe('computedToMinimal', () => {
    it('should convert builtin items correctly', () => {
      const items: SidebarItemComputed[] = [
        { type: 'builtin', key: 'all', name: 'All Content' },
        { type: 'builtin', key: 'archived', name: 'Archived' },
      ]

      const result = computedToMinimal(items)

      expect(result).toEqual([
        { type: 'builtin', key: 'all' },
        { type: 'builtin', key: 'archived' },
      ])
    })

    it('should convert filter items correctly', () => {
      const items: SidebarItemComputed[] = [
        { type: 'filter', id: '1', name: 'Filter One', content_types: ['bookmark'] },
        { type: 'filter', id: '2', name: 'Filter Two', content_types: ['note', 'bookmark'] },
      ]

      const result = computedToMinimal(items)

      expect(result).toEqual([
        { type: 'filter', id: '1' },
        { type: 'filter', id: '2' },
      ])
    })

    it('should convert collection items correctly', () => {
      const items: SidebarItemComputed[] = [
        {
          type: 'collection',
          id: 'collection-1',
          name: 'Work',
          items: [
            { type: 'filter', id: '5', name: 'Projects', content_types: ['note'] },
            { type: 'builtin', key: 'archived', name: 'Archived' },
          ],
        },
      ]

      const result = computedToMinimal(items)

      expect(result).toEqual([
        {
          type: 'collection',
          id: 'collection-1',
          name: 'Work',
          items: [
            { type: 'filter', id: '5' },
            { type: 'builtin', key: 'archived' },
          ],
        },
      ])
    })

    it('should handle empty array', () => {
      expect(computedToMinimal([])).toEqual([])
    })

    it('should handle mixed items at root level', () => {
      const items: SidebarItemComputed[] = [
        { type: 'builtin', key: 'all', name: 'All Content' },
        { type: 'filter', id: '1', name: 'Test', content_types: [] },
        {
          type: 'collection',
          id: 'c1',
          name: 'Collection',
          items: [{ type: 'filter', id: '2', name: 'Nested', content_types: [] }],
        },
        { type: 'builtin', key: 'trash', name: 'Trash' },
      ]

      const result = computedToMinimal(items)

      expect(result).toEqual([
        { type: 'builtin', key: 'all' },
        { type: 'filter', id: '1' },
        {
          type: 'collection',
          id: 'c1',
          name: 'Collection',
          items: [{ type: 'filter', id: '2' }],
        },
        { type: 'builtin', key: 'trash' },
      ])
    })

    it('should handle collections with empty items array', () => {
      const items: SidebarItemComputed[] = [
        {
          type: 'collection',
          id: 'empty-collection',
          name: 'Empty',
          items: [],
        },
      ]

      const result = computedToMinimal(items)

      expect(result).toEqual([
        {
          type: 'collection',
          id: 'empty-collection',
          name: 'Empty',
          items: [],
        },
      ])
    })

    it('should strip computed properties from nested items', () => {
      const items: SidebarItemComputed[] = [
        {
          type: 'collection',
          id: 'c1',
          name: 'Work',
          items: [
            {
              type: 'filter',
              id: '42',
              name: 'This name should be stripped',
              content_types: ['bookmark', 'note'],
            },
          ],
        },
      ]

      const result = computedToMinimal(items)
      const collectionResult = result[0] as { type: 'collection'; items: Array<{ type: string; id: string; name?: string }> }

      // The nested filter should not have name or content_types
      expect(collectionResult.items[0]).toEqual({ type: 'filter', id: '42' })
      expect('name' in collectionResult.items[0]).toBe(false)
    })
  })

  describe('round-trip consistency', () => {
    it('getCollectionChildId and parseCollectionChildId should be consistent', () => {
      const filterChild: SidebarFilterItemComputed = {
        type: 'filter',
        id: '123',
        name: 'Test',
        content_types: [],
      }

      const collectionId = 'my-collection-uuid'
      const childId = getCollectionChildId(collectionId, filterChild)
      const parsed = parseCollectionChildId(childId)

      expect(parsed).toEqual({
        collectionId: 'my-collection-uuid',
        type: 'filter',
        filterId: '123',
      })
    })

    it('getCollectionChildId and parseCollectionChildId should be consistent for builtins', () => {
      const builtinChild: SidebarBuiltinItemComputed = {
        type: 'builtin',
        key: 'all',
        name: 'All Content',
      }

      const collectionId = 'another-collection'
      const childId = getCollectionChildId(collectionId, builtinChild)
      const parsed = parseCollectionChildId(childId)

      expect(parsed).toEqual({
        collectionId: 'another-collection',
        type: 'builtin',
        key: 'all',
      })
    })
  })
})
