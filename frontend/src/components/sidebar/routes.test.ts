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
  it('returns /app/content/lists/:id for any list', () => {
    expect(getListRoute('123')).toBe('/app/content/lists/123')
    expect(getListRoute('456')).toBe('/app/content/lists/456')
    expect(getListRoute('789')).toBe('/app/content/lists/789')
  })

  it('all list routes start with /app/', () => {
    const testIds = ['1', '2', '3', '4']
    for (const id of testIds) {
      expect(getListRoute(id).startsWith('/app/')).toBe(true)
    }
  })
})
