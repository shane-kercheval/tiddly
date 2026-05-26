import { describe, it, expect } from 'vitest'
import { validateRoadmap, ROADMAP } from './roadmap'

const validColumn = {
  title: 'Backlog',
  description: 'Planned work.',
  items: [{ title: 'T', description: 'D' }],
}

describe('validateRoadmap', () => {
  it('accepts the real roadmap.json (loaded at module import)', () => {
    expect(ROADMAP.columns.length).toBeGreaterThan(0)
    expect(ROADMAP.ideas.length).toBeGreaterThan(0)
    for (const column of ROADMAP.columns) {
      expect(column.items.length).toBeGreaterThan(0)
    }
  })

  it('rejects a column missing a title or description', () => {
    expect(() =>
      validateRoadmap({ columns: [{ description: 'D', items: [] }], ideas: [] }),
    ).toThrow(/missing a title/)
    expect(() =>
      validateRoadmap({ columns: [{ title: 'X', items: [] }], ideas: [] }),
    ).toThrow(/missing a description/)
  })

  it('rejects an item missing a description', () => {
    expect(() =>
      validateRoadmap({
        columns: [{ title: 'X', description: 'D', items: [{ title: 'T' }] }],
        ideas: [],
      }),
    ).toThrow(/missing a description/)
  })

  it('rejects a non-object root and missing columns/ideas arrays', () => {
    expect(() => validateRoadmap(null)).toThrow(/must be an object/)
    expect(() => validateRoadmap({ ideas: [] })).toThrow(/columns array/)
    expect(() => validateRoadmap({ columns: [validColumn] })).toThrow(/ideas array/)
  })

  it('rejects ideas that are not an array', () => {
    expect(() => validateRoadmap({ columns: [validColumn], ideas: {} })).toThrow(/ideas array/)
  })

  it('rejects a non-string date wherever it appears (columns and ideas)', () => {
    expect(() =>
      validateRoadmap({
        columns: [{ title: 'X', description: 'D', items: [{ title: 'T', description: 'D', date: 202605 }] }],
        ideas: [],
      }),
    ).toThrow(/non-string date/)
    expect(() =>
      validateRoadmap({
        columns: [validColumn],
        ideas: [{ title: 'I', description: 'D', date: 202605 }],
      }),
    ).toThrow(/non-string date/)
  })
})
