import { describe, it, expect } from 'vitest'
import { matchPathPrefix } from './matchPathPrefix'

describe('matchPathPrefix', () => {
  it('returns exact match when present', () => {
    expect(matchPathPrefix('/docs', ['/docs', '/docs/faq'])).toBe('/docs')
  })

  it('returns longest matching prefix when no exact match', () => {
    const prefixes = ['/docs', '/docs/features', '/docs/features/shortcuts']
    expect(matchPathPrefix('/docs/features/shortcuts/cmd-d', prefixes))
      .toBe('/docs/features/shortcuts')
  })

  it('returns undefined when no prefix matches', () => {
    expect(matchPathPrefix('/elsewhere', ['/docs', '/app/bookmarks'])).toBeUndefined()
  })

  it('strips query string before matching', () => {
    expect(matchPathPrefix('/docs/faq?ref=footer', ['/docs/faq'])).toBe('/docs/faq')
  })

  it('strips hash before matching', () => {
    expect(matchPathPrefix('/docs/faq#anchor', ['/docs/faq'])).toBe('/docs/faq')
  })

  it('strips both query and hash before matching', () => {
    expect(matchPathPrefix('/docs/faq?x=1#section', ['/docs/faq'])).toBe('/docs/faq')
  })

  it('does not match a prefix that is a substring but not a path segment', () => {
    // "/app/notes" should not be considered a prefix of "/app/notesthing".
    expect(matchPathPrefix('/app/notesthing', ['/app/notes'])).toBeUndefined()
  })

  it('matches when path equals prefix exactly even with trailing slash logic', () => {
    expect(matchPathPrefix('/app/notes', ['/app/notes'])).toBe('/app/notes')
  })

  it('returns undefined for empty prefix list', () => {
    expect(matchPathPrefix('/anything', [])).toBeUndefined()
  })

  it('handles unsorted input — longest prefix still wins', () => {
    // Longest-prefix logic must be order-independent.
    const prefixes = ['/docs/features/shortcuts', '/docs', '/docs/features']
    expect(matchPathPrefix('/docs/features/shortcuts/x', prefixes))
      .toBe('/docs/features/shortcuts')
  })
})
