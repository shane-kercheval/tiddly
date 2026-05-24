import { describe, it, expect } from 'vitest'
import { validateFaq, FAQ_SECTIONS } from './faq'

describe('validateFaq', () => {
  it('accepts the real faq.json (loaded at module import)', () => {
    expect(FAQ_SECTIONS.length).toBeGreaterThan(0)
    for (const section of FAQ_SECTIONS) {
      expect(section.items.length).toBeGreaterThan(0)
    }
  })

  it('rejects a non-array root', () => {
    expect(() => validateFaq({ section: 'x' })).toThrow(/must be an array/)
  })

  it('rejects a section with no title', () => {
    expect(() => validateFaq([{ items: [{ question: 'q', answer: 'a' }] }])).toThrow(/section title/)
  })

  it('rejects a section with no items', () => {
    expect(() => validateFaq([{ section: 'X', items: [] }])).toThrow(/no items/)
  })

  it('rejects an item missing a question or answer', () => {
    expect(() => validateFaq([{ section: 'X', items: [{ answer: 'a' }] }])).toThrow(/missing a question/)
    expect(() => validateFaq([{ section: 'X', items: [{ question: 'q' }] }])).toThrow(/missing an answer/)
  })
})
