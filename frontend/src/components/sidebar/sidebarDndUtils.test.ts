/**
 * Tests for sidebar drag-and-drop utility functions.
 */
import { describe, it, expect } from 'vitest'
import {
  getItemId,
  getGroupChildId,
  parseGroupChildId,
  computedToMinimal,
  getBuiltinIcon,
  getListIcon,
} from './sidebarDndUtils'
import type {
  SidebarItemComputed,
  SidebarBuiltinItemComputed,
  SidebarListItemComputed,
  SidebarGroupComputed,
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

  describe('getListIcon', () => {
    it('should return bookmark icon for bookmark-only lists', () => {
      const icon = getListIcon(['bookmark'])
      expect(icon).toBeDefined()
    })

    it('should return note icon for note-only lists', () => {
      const icon = getListIcon(['note'])
      expect(icon).toBeDefined()
    })

    it('should return list/shared icon for mixed content types', () => {
      const icon = getListIcon(['bookmark', 'note'])
      expect(icon).toBeDefined()
    })

    it('should return list/shared icon for empty content types', () => {
      const icon = getListIcon([])
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

    it('should return correct ID for list item', () => {
      const item: SidebarListItemComputed = {
        type: 'list',
        id: '42',
        name: 'My List',
        content_types: ['bookmark'],
      }
      expect(getItemId(item)).toBe('list:42')
    })

    it('should return correct ID for group item', () => {
      const item: SidebarGroupComputed = {
        type: 'group',
        id: 'abc-123',
        name: 'Work',
        items: [],
      }
      expect(getItemId(item)).toBe('group:abc-123')
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

  describe('getGroupChildId', () => {
    it('should return correct ID for builtin child in group', () => {
      const child: SidebarBuiltinItemComputed = {
        type: 'builtin',
        key: 'archived',
        name: 'Archived',
      }
      expect(getGroupChildId('group-123', child)).toBe('ingroup:group-123:builtin:archived')
    })

    it('should return correct ID for list child in group', () => {
      const child: SidebarListItemComputed = {
        type: 'list',
        id: '99',
        name: 'My List',
        content_types: ['note'],
      }
      expect(getGroupChildId('group-456', child)).toBe('ingroup:group-456:list:99')
    })

    it('should work with UUID format group IDs', () => {
      const child: SidebarListItemComputed = {
        type: 'list',
        id: '1',
        name: 'Test',
        content_types: [],
      }
      expect(getGroupChildId('550e8400-e29b-41d4-a716-446655440000', child)).toBe(
        'ingroup:550e8400-e29b-41d4-a716-446655440000:list:1'
      )
    })
  })

  describe('parseGroupChildId', () => {
    it('should return null for non-ingroup ID', () => {
      expect(parseGroupChildId('builtin:all')).toBeNull()
      expect(parseGroupChildId('list:5')).toBeNull()
      expect(parseGroupChildId('group:abc')).toBeNull()
    })

    it('should return null for malformed ingroup ID', () => {
      expect(parseGroupChildId('ingroup:only-two-parts')).toBeNull()
      expect(parseGroupChildId('ingroup:one:two:three:four:five')).toBeNull()
    })

    it('should parse builtin child ID correctly', () => {
      const result = parseGroupChildId('ingroup:group-123:builtin:archived')

      expect(result).toEqual({
        groupId: 'group-123',
        type: 'builtin',
        key: 'archived',
      })
    })

    it('should parse list child ID correctly', () => {
      const result = parseGroupChildId('ingroup:group-456:list:99')

      expect(result).toEqual({
        groupId: 'group-456',
        type: 'list',
        listId: '99',
      })
    })

    it('should handle UUID format group IDs', () => {
      const result = parseGroupChildId('ingroup:550e8400-e29b-41d4-a716-446655440000:list:42')

      expect(result).toEqual({
        groupId: '550e8400-e29b-41d4-a716-446655440000',
        type: 'list',
        listId: '42',
      })
    })

    it('should return null for invalid type', () => {
      const result = parseGroupChildId('ingroup:group-123:invalid:foo')
      expect(result).toBeNull()
    })

    it('should handle list ID that parses to string', () => {
      const result = parseGroupChildId('ingroup:abc:list:123')
      expect(result?.listId).toBe('123')
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

    it('should convert list items correctly', () => {
      const items: SidebarItemComputed[] = [
        { type: 'list', id: '1', name: 'List One', content_types: ['bookmark'] },
        { type: 'list', id: '2', name: 'List Two', content_types: ['note', 'bookmark'] },
      ]

      const result = computedToMinimal(items)

      expect(result).toEqual([
        { type: 'list', id: '1' },
        { type: 'list', id: '2' },
      ])
    })

    it('should convert group items correctly', () => {
      const items: SidebarItemComputed[] = [
        {
          type: 'group',
          id: 'group-1',
          name: 'Work',
          items: [
            { type: 'list', id: '5', name: 'Projects', content_types: ['note'] },
            { type: 'builtin', key: 'archived', name: 'Archived' },
          ],
        },
      ]

      const result = computedToMinimal(items)

      expect(result).toEqual([
        {
          type: 'group',
          id: 'group-1',
          name: 'Work',
          items: [
            { type: 'list', id: '5' },
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
        { type: 'list', id: '1', name: 'Test', content_types: [] },
        {
          type: 'group',
          id: 'g1',
          name: 'Group',
          items: [{ type: 'list', id: '2', name: 'Nested', content_types: [] }],
        },
        { type: 'builtin', key: 'trash', name: 'Trash' },
      ]

      const result = computedToMinimal(items)

      expect(result).toEqual([
        { type: 'builtin', key: 'all' },
        { type: 'list', id: '1' },
        {
          type: 'group',
          id: 'g1',
          name: 'Group',
          items: [{ type: 'list', id: '2' }],
        },
        { type: 'builtin', key: 'trash' },
      ])
    })

    it('should handle groups with empty items array', () => {
      const items: SidebarItemComputed[] = [
        {
          type: 'group',
          id: 'empty-group',
          name: 'Empty',
          items: [],
        },
      ]

      const result = computedToMinimal(items)

      expect(result).toEqual([
        {
          type: 'group',
          id: 'empty-group',
          name: 'Empty',
          items: [],
        },
      ])
    })

    it('should strip computed properties from nested items', () => {
      const items: SidebarItemComputed[] = [
        {
          type: 'group',
          id: 'g1',
          name: 'Work',
          items: [
            {
              type: 'list',
              id: '42',
              name: 'This name should be stripped',
              content_types: ['bookmark', 'note'],
            },
          ],
        },
      ]

      const result = computedToMinimal(items)
      const groupResult = result[0] as { type: 'group'; items: Array<{ type: string; id: string; name?: string }> }

      // The nested list should not have name or content_types
      expect(groupResult.items[0]).toEqual({ type: 'list', id: '42' })
      expect('name' in groupResult.items[0]).toBe(false)
    })
  })

  describe('round-trip consistency', () => {
    it('getGroupChildId and parseGroupChildId should be consistent', () => {
      const listChild: SidebarListItemComputed = {
        type: 'list',
        id: '123',
        name: 'Test',
        content_types: [],
      }

      const groupId = 'my-group-uuid'
      const childId = getGroupChildId(groupId, listChild)
      const parsed = parseGroupChildId(childId)

      expect(parsed).toEqual({
        groupId: 'my-group-uuid',
        type: 'list',
        listId: '123',
      })
    })

    it('getGroupChildId and parseGroupChildId should be consistent for builtins', () => {
      const builtinChild: SidebarBuiltinItemComputed = {
        type: 'builtin',
        key: 'all',
        name: 'All Content',
      }

      const groupId = 'another-group'
      const childId = getGroupChildId(groupId, builtinChild)
      const parsed = parseGroupChildId(childId)

      expect(parsed).toEqual({
        groupId: 'another-group',
        type: 'builtin',
        key: 'all',
      })
    })
  })
})
