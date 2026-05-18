/**
 * Invariants for the hand-curated docs search index.
 *
 * The drift this guards against: a typo in `DOCS_ROUTES[i].path` (e.g.
 * `/docs/extensions/crhome`) would silently produce a palette entry that
 * navigates to a 404. Asserting every path resolves through `findMatchingRoute`
 * makes the typo a build-time failure instead.
 */
import { describe, it, expect } from 'vitest'
import { DOCS_ROUTES } from './docsRoutes'
import { findMatchingRoute } from '../routePrefetch'

describe('DOCS_ROUTES', () => {
  it('every path resolves via findMatchingRoute (no typos, no stale routes)', () => {
    const failures: string[] = []
    for (const route of DOCS_ROUTES) {
      if (findMatchingRoute(route.path) === undefined) {
        failures.push(`Docs path "${route.path}" (${route.label}) does not resolve via routePrefetch`)
      }
    }
    expect(failures).toEqual([])
  })

  it('every label uses the `Docs:` prefix for visual grouping in the palette', () => {
    for (const route of DOCS_ROUTES) {
      expect(route.label.startsWith('Docs: ')).toBe(true)
    }
  })

  it('every entry has a non-trivial searchText (keyword density invariant)', () => {
    // A drift signal: if someone adds a route but forgets to write its
    // keyword summary, palette search for that page falls back to label-only
    // matching. Catch the empty / placeholder case explicitly. The 30-char
    // floor is a soft check that catches "todo" or single-word stubs while
    // leaving generous headroom for genuinely-short labels (Safari, Tips).
    const failures: string[] = []
    for (const route of DOCS_ROUTES) {
      if (route.searchText.trim().length < 30) {
        failures.push(
          `Docs entry "${route.label}" searchText is suspiciously short `
          + `(${route.searchText.trim().length} chars); add keyword density.`,
        )
      }
    }
    expect(failures).toEqual([])
  })

  it('paths are unique across the index', () => {
    const seen = new Set<string>()
    const duplicates: string[] = []
    for (const route of DOCS_ROUTES) {
      if (seen.has(route.path)) duplicates.push(route.path)
      seen.add(route.path)
    }
    expect(duplicates).toEqual([])
  })
})
