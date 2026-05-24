/**
 * Known-issues corpus loader: reads + validates `known-issues.json` at module load.
 *
 * The JSON is the canonical source (served at `/data/known-issues.json`).
 * Validation here is load-bearing: the page renders a status badge via
 * `statusConfig[status]`, so an invalid `status` (typo, or a new category nobody
 * registered) would crash the page at render. Validating the enum at load turns
 * that production crash into a fail-fast at load/test. `validateKnownIssues` is
 * exported pure so tests can drive it with bad inputs.
 */
import knownIssuesData from './known-issues.json'

export type IssueStatus = 'expected-behavior' | 'bug' | 'limitation'

const VALID_STATUSES: ReadonlySet<string> = new Set<IssueStatus>([
  'expected-behavior',
  'bug',
  'limitation',
])

export interface KnownIssue {
  title: string
  status: IssueStatus
  body: string
}

export interface KnownIssuesSection {
  section: string
  items: KnownIssue[]
}

export function validateKnownIssues(data: unknown): KnownIssuesSection[] {
  if (!Array.isArray(data)) {
    throw new Error('known-issues.json must be an array of sections.')
  }
  return data.map((rawSection, sectionIndex) => {
    if (typeof rawSection !== 'object' || rawSection === null) {
      throw new Error(`known-issues.json section ${sectionIndex} is not an object.`)
    }
    const section = rawSection as Record<string, unknown>
    if (typeof section.section !== 'string' || section.section.length === 0) {
      throw new Error(`known-issues.json section ${sectionIndex} is missing a section title.`)
    }
    if (!Array.isArray(section.items) || section.items.length === 0) {
      throw new Error(`known-issues.json section "${section.section}" has no items.`)
    }
    const items = section.items.map((rawItem, itemIndex) => {
      const item = rawItem as Record<string, unknown>
      if (typeof item?.title !== 'string' || item.title.length === 0) {
        throw new Error(`known-issues.json "${section.section}" item ${itemIndex} is missing a title.`)
      }
      if (typeof item.body !== 'string' || item.body.length === 0) {
        throw new Error(`known-issues.json "${section.section}" item ${itemIndex} is missing a body.`)
      }
      if (typeof item.status !== 'string' || !VALID_STATUSES.has(item.status)) {
        throw new Error(
          `known-issues.json "${section.section}" item "${String(item.title)}" has invalid status ${JSON.stringify(item.status)} (expected expected-behavior | bug | limitation).`,
        )
      }
      return { title: item.title, status: item.status as IssueStatus, body: item.body }
    })
    return { section: section.section, items }
  })
}

export const KNOWN_ISSUES_SECTIONS = validateKnownIssues(knownIssuesData)
