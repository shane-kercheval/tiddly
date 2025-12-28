/**
 * Tests for Sidebar route generation.
 *
 * These tests ensure navigation links use the correct /app prefix.
 */
import { describe, it, expect } from 'vitest'
import { getBuiltinRoute, getListRoute } from './routes'

describe('getBuiltinRoute', () => {
  it('returns /app/content for "all"', () => {
    expect(getBuiltinRoute('all')).toBe('/app/content')
  })

  it('returns /app/content/archived for "archived"', () => {
    expect(getBuiltinRoute('archived')).toBe('/app/content/archived')
  })

  it('returns /app/content/trash for "trash"', () => {
    expect(getBuiltinRoute('trash')).toBe('/app/content/trash')
  })

  it('all builtin routes start with /app/', () => {
    const builtinKeys = ['all', 'archived', 'trash'] as const
    for (const key of builtinKeys) {
      expect(getBuiltinRoute(key).startsWith('/app/')).toBe(true)
    }
  })
})

describe('getListRoute', () => {
  it('returns /app/bookmarks/lists/:id for bookmark-only lists', () => {
    expect(getListRoute(123, ['bookmark'])).toBe('/app/bookmarks/lists/123')
  })

  it('returns /app/notes/lists/:id for note-only lists', () => {
    expect(getListRoute(456, ['note'])).toBe('/app/notes/lists/456')
  })

  it('returns /app/content/lists/:id for mixed content lists', () => {
    expect(getListRoute(789, ['bookmark', 'note'])).toBe('/app/content/lists/789')
  })

  it('returns /app/content/lists/:id for empty content_types', () => {
    expect(getListRoute(100, [])).toBe('/app/content/lists/100')
  })

  it('all list routes start with /app/', () => {
    const testCases = [
      { id: 1, contentTypes: ['bookmark'] },
      { id: 2, contentTypes: ['note'] },
      { id: 3, contentTypes: ['bookmark', 'note'] },
      { id: 4, contentTypes: [] },
    ]
    for (const { id, contentTypes } of testCases) {
      expect(getListRoute(id, contentTypes).startsWith('/app/')).toBe(true)
    }
  })
})
