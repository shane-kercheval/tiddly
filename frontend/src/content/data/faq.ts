/**
 * FAQ corpus loader: reads + validates `faq.json` at module load.
 *
 * The JSON is the canonical source (served at `/data/faq.json`). Validation here
 * replaces the compile-time shape checking lost when this content moved out of
 * TSX — a malformed section or item fails fast at load/test rather than rendering
 * blank or crashing a `.map`. `validateFaq` is exported pure so tests can drive it
 * with bad inputs.
 */
import faqData from './faq.json'

export interface FaqItem {
  question: string
  answer: string
}

export interface FaqSection {
  section: string
  items: FaqItem[]
}

export function validateFaq(data: unknown): FaqSection[] {
  if (!Array.isArray(data)) {
    throw new Error('faq.json must be an array of sections.')
  }
  return data.map((rawSection, sectionIndex) => {
    if (typeof rawSection !== 'object' || rawSection === null) {
      throw new Error(`faq.json section ${sectionIndex} is not an object.`)
    }
    const section = rawSection as Record<string, unknown>
    if (typeof section.section !== 'string' || section.section.length === 0) {
      throw new Error(`faq.json section ${sectionIndex} is missing a section title.`)
    }
    if (!Array.isArray(section.items) || section.items.length === 0) {
      throw new Error(`faq.json section "${section.section}" has no items.`)
    }
    const items = section.items.map((rawItem, itemIndex) => {
      const item = rawItem as Record<string, unknown>
      if (typeof item?.question !== 'string' || item.question.length === 0) {
        throw new Error(`faq.json "${section.section}" item ${itemIndex} is missing a question.`)
      }
      if (typeof item.answer !== 'string' || item.answer.length === 0) {
        throw new Error(`faq.json "${section.section}" item ${itemIndex} is missing an answer.`)
      }
      return { question: item.question, answer: item.answer }
    })
    return { section: section.section, items }
  })
}

export const FAQ_SECTIONS = validateFaq(faqData)
