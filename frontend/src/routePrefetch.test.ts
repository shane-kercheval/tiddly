/**
 * Tests for routePrefetch module.
 */
import { describe, it, expect } from 'vitest'
import { findMatchingRoute, prefetchRoute } from './routePrefetch'

describe('findMatchingRoute', () => {
  it('should return exact match for known path', () => {
    expect(findMatchingRoute('/features')).toBe('/features')
  })

  it('should return prefix match for dynamic segment', () => {
    expect(findMatchingRoute('/app/notes/abc123')).toBe('/app/notes')
  })

  it('should return prefix match for /app/bookmarks/new', () => {
    expect(findMatchingRoute('/app/bookmarks/new')).toBe('/app/bookmarks')
  })

  it('should return undefined for non-matching path', () => {
    expect(findMatchingRoute('/nonexistent/path')).toBeUndefined()
  })

  it('should return exact match for /docs/api (not prefix /docs)', () => {
    expect(findMatchingRoute('/docs/api')).toBe('/docs/api')
  })

  it('should return exact match for /docs/api/bookmarks (not prefix /docs/api)', () => {
    expect(findMatchingRoute('/docs/api/bookmarks')).toBe('/docs/api/bookmarks')
  })

  it('should return exact match for /docs/features/content-types (not prefix /docs/features)', () => {
    expect(findMatchingRoute('/docs/features/content-types')).toBe('/docs/features/content-types')
  })

  it('should return exact match for /docs/features (not prefix /docs)', () => {
    expect(findMatchingRoute('/docs/features')).toBe('/docs/features')
  })

  it('should return exact match for /docs', () => {
    expect(findMatchingRoute('/docs')).toBe('/docs')
  })

  it('should return exact match for settings paths', () => {
    expect(findMatchingRoute('/app/settings/general')).toBe('/app/settings/general')
    expect(findMatchingRoute('/app/settings/mcp')).toBe('/app/settings/mcp')
  })

  it('should strip query string before matching', () => {
    expect(findMatchingRoute('/app/settings/general?tab=foo')).toBe('/app/settings/general')
  })

  it('should strip hash before matching', () => {
    expect(findMatchingRoute('/docs/features#section')).toBe('/docs/features')
  })

  it('should strip both query and hash before matching', () => {
    expect(findMatchingRoute('/features?ref=nav#top')).toBe('/features')
  })

  it('should return undefined for empty string', () => {
    expect(findMatchingRoute('')).toBeUndefined()
  })

  it('should return undefined for root path (eagerly loaded)', () => {
    expect(findMatchingRoute('/')).toBeUndefined()
  })

  it('should fall back to /docs/api prefix for unlisted endpoint slugs', () => {
    // Unlisted slugs prefix-match to /docs/api (DocsAPI), not DocsAPIEndpoint.
    // If a new endpoint is added to the router, add it to routePrefetch.ts too.
    expect(findMatchingRoute('/docs/api/unknown-endpoint')).toBe('/docs/api')
  })
})

describe('prefetchRoute', () => {
  it('should not throw for matching path', () => {
    expect(() => prefetchRoute('/features')).not.toThrow()
  })

  it('should not throw for non-matching path', () => {
    expect(() => prefetchRoute('/nonexistent')).not.toThrow()
  })
})
