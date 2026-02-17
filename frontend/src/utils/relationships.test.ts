/**
 * Tests for relationship utility functions.
 */
import { describe, it, expect } from 'vitest'
import type { RelationshipWithContent, RelationshipInputPayload } from '../types'
import { getLinkedItem, toRelationshipInputs, relationshipsEqual } from './relationships'

function makeRelWithContent(
  overrides: Partial<RelationshipWithContent> = {},
): RelationshipWithContent {
  return {
    id: 'rel-1',
    source_type: 'bookmark',
    source_id: 'bm-1',
    target_type: 'note',
    target_id: 'note-1',
    relationship_type: 'related',
    description: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    source_title: 'Bookmark Title',
    source_url: 'https://example.com',
    source_prompt_name: null,
    source_deleted: false,
    source_archived: false,
    target_title: 'Note Title',
    target_url: null,
    target_prompt_name: null,
    target_deleted: false,
    target_archived: false,
    ...overrides,
  }
}

describe('getLinkedItem', () => {
  it('should return target side when self is source', () => {
    const rel = makeRelWithContent()
    const result = getLinkedItem(rel, 'bookmark', 'bm-1')

    expect(result.type).toBe('note')
    expect(result.id).toBe('note-1')
    expect(result.title).toBe('Note Title')
    expect(result.url).toBeNull()
    expect(result.deleted).toBe(false)
    expect(result.archived).toBe(false)
  })

  it('should return source side when self is target', () => {
    const rel = makeRelWithContent()
    const result = getLinkedItem(rel, 'note', 'note-1')

    expect(result.type).toBe('bookmark')
    expect(result.id).toBe('bm-1')
    expect(result.title).toBe('Bookmark Title')
    expect(result.url).toBe('https://example.com')
  })

  it('should return prompt name for prompt relationships', () => {
    const rel = makeRelWithContent({
      source_type: 'bookmark',
      source_id: 'bm-1',
      target_type: 'prompt',
      target_id: 'prompt-1',
      target_prompt_name: 'my-prompt',
    })
    const result = getLinkedItem(rel, 'bookmark', 'bm-1')

    expect(result.promptName).toBe('my-prompt')
  })

  it('should return null promptName for non-prompt relationships', () => {
    const rel = makeRelWithContent()
    const result = getLinkedItem(rel, 'bookmark', 'bm-1')

    expect(result.promptName).toBeNull()
  })

  it('should preserve description', () => {
    const rel = makeRelWithContent({ description: 'See also' })
    const result = getLinkedItem(rel, 'bookmark', 'bm-1')

    expect(result.description).toBe('See also')
  })

  it('should preserve relationship ID', () => {
    const rel = makeRelWithContent({ id: 'rel-42' })
    const result = getLinkedItem(rel, 'bookmark', 'bm-1')

    expect(result.relationshipId).toBe('rel-42')
  })

  it('should propagate deleted and archived flags', () => {
    const rel = makeRelWithContent({
      target_deleted: true,
      target_archived: true,
    })
    const result = getLinkedItem(rel, 'bookmark', 'bm-1')

    expect(result.deleted).toBe(true)
    expect(result.archived).toBe(true)
  })
})

describe('toRelationshipInputs', () => {
  it('should convert to input payloads from source perspective', () => {
    const rels = [makeRelWithContent()]
    const result = toRelationshipInputs(rels, 'bookmark', 'bm-1')

    expect(result).toEqual([
      {
        target_type: 'note',
        target_id: 'note-1',
        relationship_type: 'related',
        description: null,
      },
    ])
  })

  it('should convert to input payloads from target perspective', () => {
    const rels = [makeRelWithContent()]
    const result = toRelationshipInputs(rels, 'note', 'note-1')

    expect(result).toEqual([
      {
        target_type: 'bookmark',
        target_id: 'bm-1',
        relationship_type: 'related',
        description: null,
      },
    ])
  })

  it('should handle multiple relationships', () => {
    const rels = [
      makeRelWithContent({ id: 'rel-1', target_type: 'note', target_id: 'note-1' }),
      makeRelWithContent({
        id: 'rel-2',
        target_type: 'prompt',
        target_id: 'prompt-1',
        target_title: 'Prompt',
      }),
    ]
    const result = toRelationshipInputs(rels, 'bookmark', 'bm-1')

    expect(result).toHaveLength(2)
    expect(result[0].target_type).toBe('note')
    expect(result[1].target_type).toBe('prompt')
  })

  it('should handle empty array', () => {
    expect(toRelationshipInputs([], 'bookmark', 'bm-1')).toEqual([])
  })
})

describe('relationshipsEqual', () => {
  const relA: RelationshipInputPayload = {
    target_type: 'note',
    target_id: 'note-1',
    relationship_type: 'related',
  }
  const relB: RelationshipInputPayload = {
    target_type: 'prompt',
    target_id: 'prompt-1',
    relationship_type: 'related',
  }

  it('should return true for identical arrays', () => {
    expect(relationshipsEqual([relA], [relA])).toBe(true)
  })

  it('should return true for same items in different order', () => {
    expect(relationshipsEqual([relA, relB], [relB, relA])).toBe(true)
  })

  it('should return false for different lengths', () => {
    expect(relationshipsEqual([relA], [relA, relB])).toBe(false)
  })

  it('should return false for different items', () => {
    expect(relationshipsEqual([relA], [relB])).toBe(false)
  })

  it('should return true for empty arrays', () => {
    expect(relationshipsEqual([], [])).toBe(true)
  })

  it('should compare descriptions', () => {
    const withDesc: RelationshipInputPayload = { ...relA, description: 'foo' }
    const withoutDesc: RelationshipInputPayload = { ...relA }

    expect(relationshipsEqual([withDesc], [withoutDesc])).toBe(false)
    expect(relationshipsEqual([withDesc], [{ ...relA, description: 'foo' }])).toBe(true)
  })

  it('should treat null and undefined description as equal', () => {
    const withNull: RelationshipInputPayload = { ...relA, description: null }
    const withUndefined: RelationshipInputPayload = { ...relA }

    expect(relationshipsEqual([withNull], [withUndefined])).toBe(true)
  })
})
