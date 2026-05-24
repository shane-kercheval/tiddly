import { describe, it, expect } from 'vitest'
import { validateKnownIssues, KNOWN_ISSUES_SECTIONS } from './knownIssues'

const validItem = { title: 'T', status: 'bug', body: 'B' }

describe('validateKnownIssues', () => {
  it('accepts the real known-issues.json (loaded at module import)', () => {
    expect(KNOWN_ISSUES_SECTIONS.length).toBeGreaterThan(0)
    for (const section of KNOWN_ISSUES_SECTIONS) {
      expect(section.items.length).toBeGreaterThan(0)
    }
  })

  it('rejects an invalid status (the render-crash guard)', () => {
    expect(() =>
      validateKnownIssues([{ section: 'X', items: [{ ...validItem, status: 'limitaton' }] }]),
    ).toThrow(/invalid status/)
  })

  it('rejects an item missing a title or body', () => {
    expect(() => validateKnownIssues([{ section: 'X', items: [{ status: 'bug', body: 'B' }] }])).toThrow(
      /missing a title/,
    )
    expect(() => validateKnownIssues([{ section: 'X', items: [{ title: 'T', status: 'bug' }] }])).toThrow(
      /missing a body/,
    )
  })

  it('rejects a non-array root and a section with no items', () => {
    expect(() => validateKnownIssues({})).toThrow(/must be an array/)
    expect(() => validateKnownIssues([{ section: 'X', items: [] }])).toThrow(/no items/)
  })
})
