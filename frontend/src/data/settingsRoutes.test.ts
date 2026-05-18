/**
 * Invariants for the hand-curated settings search index.
 *
 * Same shape as `docsRoutes.test.ts` — these guards catch typos in paths,
 * stub or missing keyword summaries, and duplicate entries before they ship.
 */
import { describe, it, expect } from 'vitest'
import { SETTINGS_ROUTES } from './settingsRoutes'
import { findMatchingRoute } from '../routePrefetch'

describe('SETTINGS_ROUTES', () => {
  it('every path resolves via findMatchingRoute (no typos, no stale routes)', () => {
    const failures: string[] = []
    for (const route of SETTINGS_ROUTES) {
      if (findMatchingRoute(route.path) === undefined) {
        failures.push(`Settings path "${route.path}" (${route.label}) does not resolve via routePrefetch`)
      }
    }
    expect(failures).toEqual([])
  })

  it('every label uses the `Settings:` prefix for visual grouping in the palette', () => {
    for (const route of SETTINGS_ROUTES) {
      expect(route.label.startsWith('Settings: ')).toBe(true)
    }
  })

  it('every entry has a non-trivial searchText (keyword density invariant)', () => {
    const failures: string[] = []
    for (const route of SETTINGS_ROUTES) {
      if (route.searchText.trim().length < 30) {
        failures.push(
          `Settings entry "${route.label}" searchText is suspiciously short `
          + `(${route.searchText.trim().length} chars); add keyword density.`,
        )
      }
    }
    expect(failures).toEqual([])
  })

  it('paths are unique across the index', () => {
    const seen = new Set<string>()
    const duplicates: string[] = []
    for (const route of SETTINGS_ROUTES) {
      if (seen.has(route.path)) duplicates.push(route.path)
      seen.add(route.path)
    }
    expect(duplicates).toEqual([])
  })
})
