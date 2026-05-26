/**
 * Changelog corpus loader: reads + validates `changelog.json` at module load.
 *
 * The JSON is the canonical source (served at `/data/changelog.json`).
 * Validation here is load-bearing: the page renders a colored tag badge via
 * `tagConfig[tag]`, so an invalid `tag` (typo, or a new category nobody
 * registered) would crash the page at render. Validating the enum at load turns
 * that production crash into a fail-fast at load/test. The badge's class names
 * stay in the component (presentation); only content lives here.
 * `validateChangelog` is exported pure so tests can drive it with bad inputs.
 */
import changelogData from './changelog.json'

export type ChangelogTag = 'web' | 'api' | 'cli' | 'extension' | 'site' | 'performance' | 'ai'

const VALID_TAGS: ReadonlySet<string> = new Set<ChangelogTag>([
  'web',
  'api',
  'cli',
  'extension',
  'site',
  'performance',
  'ai',
])

export interface ChangelogEntry {
  title: string
  description: string
  pr?: number
  tag?: ChangelogTag
}

export interface ChangelogCategory {
  label: string
  emoji: string
  entries: ChangelogEntry[]
}

export interface ChangelogMonth {
  month: string
  theme: string
  categories: ChangelogCategory[]
}

function validateEntry(rawEntry: unknown, context: string, entryIndex: number): ChangelogEntry {
  const entry = rawEntry as Record<string, unknown>
  if (typeof entry?.title !== 'string' || entry.title.length === 0) {
    throw new Error(`changelog.json ${context} entry ${entryIndex} is missing a title.`)
  }
  if (typeof entry.description !== 'string' || entry.description.length === 0) {
    throw new Error(`changelog.json ${context} entry "${String(entry.title)}" is missing a description.`)
  }
  if (entry.pr !== undefined && typeof entry.pr !== 'number') {
    throw new Error(`changelog.json ${context} entry "${entry.title}" has a non-number pr.`)
  }
  if (entry.tag !== undefined && (typeof entry.tag !== 'string' || !VALID_TAGS.has(entry.tag))) {
    throw new Error(
      `changelog.json ${context} entry "${entry.title}" has invalid tag ${JSON.stringify(entry.tag)} (expected web | api | cli | extension | site | performance | ai).`,
    )
  }
  const result: ChangelogEntry = { title: entry.title, description: entry.description }
  if (entry.pr !== undefined) result.pr = entry.pr as number
  if (entry.tag !== undefined) result.tag = entry.tag as ChangelogTag
  return result
}

export function validateChangelog(data: unknown): ChangelogMonth[] {
  if (!Array.isArray(data)) {
    throw new Error('changelog.json must be an array of months.')
  }
  return data.map((rawMonth, monthIndex) => {
    if (typeof rawMonth !== 'object' || rawMonth === null) {
      throw new Error(`changelog.json month ${monthIndex} is not an object.`)
    }
    const month = rawMonth as Record<string, unknown>
    if (typeof month.month !== 'string' || month.month.length === 0) {
      throw new Error(`changelog.json month ${monthIndex} is missing a month label.`)
    }
    if (typeof month.theme !== 'string' || month.theme.length === 0) {
      throw new Error(`changelog.json month "${month.month}" is missing a theme.`)
    }
    if (!Array.isArray(month.categories) || month.categories.length === 0) {
      throw new Error(`changelog.json month "${month.month}" has no categories.`)
    }
    const categories = month.categories.map((rawCategory, categoryIndex) => {
      const category = rawCategory as Record<string, unknown>
      if (typeof category?.label !== 'string' || category.label.length === 0) {
        throw new Error(`changelog.json month "${month.month}" category ${categoryIndex} is missing a label.`)
      }
      if (typeof category.emoji !== 'string' || category.emoji.length === 0) {
        throw new Error(`changelog.json month "${month.month}" category "${category.label}" is missing an emoji.`)
      }
      if (!Array.isArray(category.entries) || category.entries.length === 0) {
        throw new Error(`changelog.json month "${month.month}" category "${category.label}" has no entries.`)
      }
      const entries = category.entries.map((rawEntry, entryIndex) =>
        validateEntry(rawEntry, `month "${month.month}" category "${category.label}"`, entryIndex),
      )
      return { label: category.label, emoji: category.emoji, entries }
    })
    return { month: month.month, theme: month.theme, categories }
  })
}

export const CHANGELOG = validateChangelog(changelogData)
