import { describe, it, expect } from 'vitest'
import { validateChangelog, CHANGELOG } from './changelog'

const validEntry = { title: 'T', description: 'D', tag: 'web' }
const validCategory = { label: 'New', emoji: '🚀', entries: [validEntry] }

describe('validateChangelog', () => {
  it('accepts the real changelog.json (loaded at module import)', () => {
    expect(CHANGELOG.length).toBeGreaterThan(0)
    for (const month of CHANGELOG) {
      expect(month.categories.length).toBeGreaterThan(0)
      for (const category of month.categories) {
        expect(category.entries.length).toBeGreaterThan(0)
      }
    }
  })

  it('rejects an invalid tag (the render-crash guard)', () => {
    expect(() =>
      validateChangelog([
        { month: 'X', theme: 'T', categories: [{ ...validCategory, entries: [{ ...validEntry, tag: 'webb' }] }] },
      ]),
    ).toThrow(/invalid tag/)
  })

  it('rejects a month missing a label or theme', () => {
    expect(() => validateChangelog([{ theme: 'T', categories: [validCategory] }])).toThrow(
      /missing a month label/,
    )
    expect(() => validateChangelog([{ month: 'X', categories: [validCategory] }])).toThrow(
      /missing a theme/,
    )
  })

  it('rejects an entry missing a title or description', () => {
    expect(() =>
      validateChangelog([
        { month: 'X', theme: 'T', categories: [{ ...validCategory, entries: [{ description: 'D' }] }] },
      ]),
    ).toThrow(/missing a title/)
    expect(() =>
      validateChangelog([
        { month: 'X', theme: 'T', categories: [{ ...validCategory, entries: [{ title: 'T' }] }] },
      ]),
    ).toThrow(/missing a description/)
  })

  it('rejects a non-array root and a month with no categories', () => {
    expect(() => validateChangelog({})).toThrow(/must be an array/)
    expect(() => validateChangelog([{ month: 'X', theme: 'T', categories: [] }])).toThrow(/no categories/)
  })
})
