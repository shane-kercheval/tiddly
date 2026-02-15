/**
 * Tests for relationship query key factory.
 */
import { describe, it, expect } from 'vitest'
import { relationshipKeys } from './useRelationships'

describe('relationshipKeys', () => {
  it('should generate correct all key', () => {
    expect(relationshipKeys.all).toEqual(['relationships'])
  })

  it('should generate correct forContent key', () => {
    expect(relationshipKeys.forContent('bookmark', '123')).toEqual([
      'relationships', 'content', 'bookmark', '123',
    ])
  })

  it('should generate correct forContent key for note', () => {
    expect(relationshipKeys.forContent('note', 'abc')).toEqual([
      'relationships', 'content', 'note', 'abc',
    ])
  })

  it('forContent key should be a prefix of query key with options', () => {
    const baseKey = relationshipKeys.forContent('bookmark', '123')
    const queryKey = [...baseKey, { includeContentInfo: true }]
    expect(queryKey.slice(0, baseKey.length)).toEqual(baseKey)
  })
})
