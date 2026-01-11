/**
 * Tests for Sidebar route generation.
 *
 * These tests ensure navigation links use the correct /app prefix.
 */
import { describe, it, expect } from 'vitest'
import { getBuiltinRoute, getFilterRoute } from './routes'

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

describe('getFilterRoute', () => {
  it('returns /app/content/filters/:id for any filter', () => {
    expect(getFilterRoute('123')).toBe('/app/content/filters/123')
    expect(getFilterRoute('456')).toBe('/app/content/filters/456')
    expect(getFilterRoute('789')).toBe('/app/content/filters/789')
  })

  it('all filter routes start with /app/', () => {
    const testIds = ['1', '2', '3', '4']
    for (const id of testIds) {
      expect(getFilterRoute(id).startsWith('/app/')).toBe(true)
    }
  })
})
