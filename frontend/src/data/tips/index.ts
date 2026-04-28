/**
 * Tip-corpus public API: validation + selectors used by the rest of the frontend.
 *
 * Validation runs at module load against `allTips`. The pure `validateTips`
 * function is exported separately so the same rules can be unit-tested with
 * ad-hoc inputs without re-triggering module-load side effects.
 */
import { matchPathPrefix } from '../../utils/matchPathPrefix'
import { ALL_CONTENT_TYPES, type ContentType } from '../../types'
import { allTips } from './tips'
import {
  BODY_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  type Tip,
  type TipCategory,
} from './types'

export { allTips } from './tips'
export type { Tip, TipCategory, TipAudience, TipMedia, RelatedDoc } from './types'

const CONTENT_TYPE_TO_CATEGORY: Record<ContentType, TipCategory> = {
  bookmark: 'bookmarks',
  note: 'notes',
  prompt: 'prompts',
}

/**
 * Validate tip schema invariants. Throws on the first violation found.
 *
 * Pure: takes the tip array as an argument so tests can drive it with bad
 * inputs without mutating the live corpus.
 */
export function validateTips(tips: readonly Tip[]): void {
  const seenIds = new Set<string>()
  // category → priority → first id seen at that priority. Each tip's
  // starterPriority must be unique within EVERY category it claims, so
  // multi-category starters get checked once per declared category.
  const starterPriorityByCategory = new Map<TipCategory, Map<number, string>>()

  for (const tip of tips) {
    if (seenIds.has(tip.id)) {
      throw new Error(`Duplicate tip id: "${tip.id}"`)
    }
    seenIds.add(tip.id)

    if (tip.title.length > TITLE_MAX_LENGTH) {
      throw new Error(
        `Tip "${tip.id}" title exceeds ${TITLE_MAX_LENGTH} chars (${tip.title.length}).`,
      )
    }

    if (tip.body.length > BODY_MAX_LENGTH) {
      throw new Error(
        `Tip "${tip.id}" body exceeds ${BODY_MAX_LENGTH} chars (${tip.body.length}).`,
      )
    }

    if (tip.categories.length === 0) {
      throw new Error(`Tip "${tip.id}" has an empty categories array.`)
    }

    if (tip.starter === true) {
      if (tip.starterPriority === undefined) {
        throw new Error(
          `Tip "${tip.id}" is marked starter but has no starterPriority.`,
        )
      }
      for (const category of tip.categories) {
        let prioritiesForCategory = starterPriorityByCategory.get(category)
        if (prioritiesForCategory === undefined) {
          prioritiesForCategory = new Map()
          starterPriorityByCategory.set(category, prioritiesForCategory)
        }
        const collidingId = prioritiesForCategory.get(tip.starterPriority)
        if (collidingId !== undefined) {
          throw new Error(
            `Starter priority ${tip.starterPriority} is duplicated within category "${category}" `
            + `(tips "${collidingId}" and "${tip.id}").`,
          )
        }
        prioritiesForCategory.set(tip.starterPriority, tip.id)
      }
    }
  }
}

// Run at module load — surfaces invalid corpus state on import, not at runtime.
validateTips(allTips)

/**
 * Return tips that claim the given category, sorted by display priority
 * (lower = higher rank), tied by id ascending. Tips without a `priority` sort
 * to the bottom.
 */
export function getTipsByCategory(category: TipCategory): Tip[] {
  return allTips
    .filter((tip) => tip.categories.includes(category))
    .sort(byPriorityThenId)
}

/**
 * Return tips whose `areas` cover the given route path via exact-or-longest-prefix
 * match. Tips with no `areas` field never match — `areas` is the relevance hint.
 */
export function getTipsByArea(routePath: string): Tip[] {
  return allTips.filter(
    (tip) => tip.areas !== undefined && matchPathPrefix(routePath, tip.areas) !== undefined,
  )
}

/**
 * Return starter tips, sorted by `starterPriority` ascending. With a category
 * argument, scoped to starters claiming that category.
 */
export function getStarterTips(category?: TipCategory): Tip[] {
  const starters = allTips.filter(
    (tip) =>
      tip.starter === true
      && (category === undefined || tip.categories.includes(category)),
  )
  return [...starters].sort(byStarterPriorityThenId)
}

/**
 * Pick starter tips relevant to a given set of content types, deterministically
 * ordered for stable UI.
 *
 * Mapping: bookmark→bookmarks, note→notes, prompt→prompts. Iteration order
 * across types is pinned to `ALL_CONTENT_TYPES` so cross-category UI order is
 * stable. Round-robin draws one starter tip per type per round, breaking
 * priority ties by tip id (ascending), deduping by id, and capping at `limit`.
 *
 * When a requested type has fewer starters than its share of the limit, the
 * remaining slots are filled from other types' remaining starters (rather than
 * under-filling). The single source of truth for this rule is M1's contract:
 * "Empty starter set for a type → that type contributes zero tips, others
 * fill the limit."
 */
export function pickStarterTipsForContentTypes(
  types: readonly ContentType[],
  limit: number = 3,
): Tip[] {
  return pickStarterTipsFromCorpus(allTips, types, limit)
}

/**
 * Pure variant of `pickStarterTipsForContentTypes` that takes the corpus as an
 * argument. Used internally and by tests that need to exercise edge cases the
 * live corpus doesn't currently express (e.g., a content type with zero starters).
 */
export function pickStarterTipsFromCorpus(
  tips: readonly Tip[],
  types: readonly ContentType[],
  limit: number,
): Tip[] {
  if (limit <= 0) return []

  // Walk types in ALL_CONTENT_TYPES order, restricted to types that were requested.
  const requested = new Set(types)
  const orderedTypes = ALL_CONTENT_TYPES.filter((type) => requested.has(type))

  // Sorted starter tips per category (priority asc, then id asc). With
  // multi-category tips, the same tip can appear in more than one list — e.g.
  // a tip with categories ['notes', 'prompts'] appears in both note and prompt
  // starters. The id-dedupe in the round-robin loop below collapses repeats.
  const startersByType = new Map<ContentType, Tip[]>()
  for (const type of orderedTypes) {
    const category = CONTENT_TYPE_TO_CATEGORY[type]
    const starters = tips
      .filter((tip) => tip.starter === true && tip.categories.includes(category))
      .sort(byStarterPriorityThenId)
    startersByType.set(type, starters)
  }

  // Round-robin: each round, take the next remaining starter from each type.
  // The cursor advances even when a candidate is deduped so a multi-category
  // tip doesn't keep blocking the same slot across rounds.
  const picked: Tip[] = []
  const seenIds = new Set<string>()
  const cursors = new Map<ContentType, number>(orderedTypes.map((type) => [type, 0]))

  let progressed = true
  while (picked.length < limit && progressed) {
    progressed = false
    for (const type of orderedTypes) {
      if (picked.length >= limit) break
      const starters = startersByType.get(type)!
      const cursor = cursors.get(type)!
      if (cursor >= starters.length) continue
      const candidate = starters[cursor]
      cursors.set(type, cursor + 1)
      progressed = true
      if (seenIds.has(candidate.id)) continue
      picked.push(candidate)
      seenIds.add(candidate.id)
    }
  }

  return picked
}

/**
 * Case-insensitive substring search over title and the *raw markdown body* (not
 * rendered text). Empty/whitespace-only query returns no results.
 */
export function searchTips(query: string): Tip[] {
  const trimmed = query.trim()
  if (trimmed.length === 0) return []
  const needle = trimmed.toLowerCase()
  return allTips.filter(
    (tip) =>
      tip.title.toLowerCase().includes(needle) || tip.body.toLowerCase().includes(needle),
  )
}

/**
 * Compare tips by display priority (lower rank first), tied by id ascending.
 * Tips without `priority` sort after those with one. Safe for any tip array.
 */
export function byPriorityThenId(left: Tip, right: Tip): number {
  const leftPriority = left.priority ?? Number.POSITIVE_INFINITY
  const rightPriority = right.priority ?? Number.POSITIVE_INFINITY
  if (leftPriority !== rightPriority) return leftPriority - rightPriority
  return left.id.localeCompare(right.id)
}

// Callers must pre-filter to `starter === true`. validateTips guarantees those
// tips have starterPriority set, so the non-null assertions below are safe.
function byStarterPriorityThenId(left: Tip, right: Tip): number {
  const diff = left.starterPriority! - right.starterPriority!
  if (diff !== 0) return diff
  return left.id.localeCompare(right.id)
}
