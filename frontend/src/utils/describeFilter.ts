/**
 * Filter empty-state copy utilities (M6).
 *
 * Produces human-readable empty-state copy for saved-filter routes and for
 * transient tag-chip filters. Used by `AllContent.tsx`. Search-query and
 * content-type-chip-only empty states intentionally stay on generic copy —
 * the user already sees what they applied in the input field / chip row.
 */
import { ALL_CONTENT_TYPES, type ContentType, type ContentFilter, type ViewOption } from '../types'

/**
 * Normalize a saved filter's `content_types` field so callers see a consistent
 * non-empty list. Mirrors `AllContent.tsx`'s availableContentTypes fallback —
 * exported so both the page and the describe utilities can't drift.
 */
export function resolveFilterContentTypes(filter: ContentFilter): ContentType[] {
  if (filter.content_types.length === 0) return [...ALL_CONTENT_TYPES]
  return filter.content_types
}

/** Output shape for the saved-filter empty-state utility. */
export interface SavedFilterDescription {
  title: string
}

/** Output shape for the tag-chips empty-state utility. */
export interface TagChipsDescription {
  /** Present only in `'standalone'` mode. Caller uses for the EmptyState title. */
  title?: string
  /**
   * Standalone-mode descriptions are empty; overlay-mode descriptions are a
   * subordinate clause meant to compose after a saved-filter title.
   */
  description: string
}

/**
 * Empty-state copy for a saved-filter route when no items match. Effective
 * content types are passed by the caller (post-chip-narrowing) so the noun in
 * copy matches what the page is actually showing.
 */
export function describeSavedFilter(
  filter: ContentFilter,
  effectiveContentTypes: ContentType[],
  view: ViewOption,
): SavedFilterDescription {
  const tagGroups = filter.filter_expression.groups
    .map((group) => group.tags.filter((tag) => tag.length > 0))
    .filter((tags) => tags.length > 0)

  // Defensive: a filter with no usable tag groups can't be meaningfully described.
  // Should not occur in practice (the filter builder enforces ≥1 tag), but a
  // legacy or hand-crafted filter could trip this — fall back gracefully.
  if (tagGroups.length === 0) {
    return { title: 'No items match this filter yet' }
  }

  const noun = nounForContentTypes(effectiveContentTypes)
  const tagExpression = renderTagExpression(tagGroups)
  const viewPrefix = viewModifier(view)
  return { title: `No ${viewPrefix}${noun} tagged with ${tagExpression} yet` }
}

/**
 * Empty-state copy for transient tag-chip filters. In `'standalone'` mode, the
 * caller uses this as the primary empty-state copy. In `'overlay'` mode, the
 * caller appends `description` to a saved-filter description; it's phrased as
 * a subordinate clause to avoid the awkward two-sentence concatenation
 * problem ("No bookmarks tagged with X yet. No bookmarks tagged with Y yet.").
 */
export function describeTagChips(
  tags: string[],
  match: 'all' | 'any',
  contentTypes: ContentType[],
  availableContentTypes: ContentType[],
  view: ViewOption,
  mode: 'standalone' | 'overlay',
): TagChipsDescription {
  if (tags.length === 0) {
    return mode === 'standalone'
      ? { title: 'No items match this filter yet', description: '' }
      : { description: '' }
  }

  if (mode === 'overlay') {
    const joiner = match === 'all' ? ' and ' : ' or '
    const label = tags.length === 1 ? 'tag' : 'tags'
    const tagList = tags.map(quote).join(joiner)
    return { description: `You're also filtering by ${label} ${tagList}.` }
  }

  // Standalone: narrow the noun by the chips' content-type selection if it
  // actually narrows the set (chips equal to the full available set means the
  // user hasn't narrowed — fall back to the full noun).
  const effectiveTypes = contentTypes.length > 0
    && contentTypes.length < availableContentTypes.length
    ? contentTypes
    : availableContentTypes
  const noun = nounForContentTypes(effectiveTypes)
  const viewPrefix = viewModifier(view)
  const joiner = match === 'all' ? ' and ' : ' or '
  const tagList = tags.map(quote).join(joiner)
  return {
    title: `No ${viewPrefix}${noun} tagged with ${tagList} yet`,
    description: '',
  }
}

/**
 * Overlay clause for a transient search query, layered after a saved-filter
 * title. `JSON.stringify` handles escaping for queries that contain quotes —
 * a literal `"` in the input renders as `\"` (slightly ugly but unambiguous).
 */
export function describeSearchOverlay(query: string): string {
  return `Matching ${JSON.stringify(query)}.`
}

/**
 * Compose multiple description fragments with a single space. Empty fragments
 * are dropped so a missing overlay doesn't leave a stray space or double
 * period when assembled.
 */
export function composeDescription(...fragments: string[]): string {
  return fragments.filter((fragment) => fragment.length > 0).join(' ')
}

function nounForContentTypes(types: ContentType[]): string {
  if (types.length === 0) return 'items'
  // All three content types in scope reads as "items" rather than enumerating —
  // the user isn't narrowing by type, so naming each one is noise.
  if (types.length === ALL_CONTENT_TYPES.length) return 'items'
  if (types.length === 1) return pluralNoun(types[0])
  // 2-type joining uses "or" because each accepted type is an alternative, not
  // a conjunction ("either bookmarks OR notes will match" — never both at once
  // for a single item).
  return types
    .map(pluralNoun)
    .join(' or ')
}

function pluralNoun(type: ContentType): string {
  switch (type) {
    case 'bookmark': return 'bookmarks'
    case 'note': return 'notes'
    case 'prompt': return 'prompts'
  }
}

function viewModifier(view: ViewOption): string {
  if (view === 'archived') return 'archived '
  if (view === 'deleted') return 'deleted '
  return ''
}

function renderTagExpression(tagGroups: string[][]): string {
  if (tagGroups.length === 1) return tagGroups[0].map(quote).join(' and ')
  return tagGroups
    .map((group) => `(${group.map(quote).join(' and ')})`)
    .join(' or ')
}

// `JSON.stringify` handles both wrapping and escaping (`he"llo` → `"he\"llo"`).
// A bare template-string wrap would produce unbalanced quotes for any tag or
// query containing a literal `"` — the same class of bug `describeSearchOverlay`
// already guards against.
function quote(text: string): string {
  return JSON.stringify(text)
}
