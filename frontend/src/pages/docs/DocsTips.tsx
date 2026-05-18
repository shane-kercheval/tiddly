/**
 * Tips docs page — browsable, filterable, searchable view of the full tip
 * corpus, rendered as a single flat list ordered by global `priority`.
 *
 * Filter semantics:
 *   - search: case-insensitive substring on title + raw markdown body
 *   - category: multi-select; empty = no filter. A tip matches if ANY of its
 *     categories ∈ selected set.
 *   - audience: single-select; "Beginner" and "Power user" inclusively match
 *     `audience: 'all'` tips because `'all'` semantically means "applies to
 *     everyone."
 *
 * Filters intersect: matching tip ∈ search ∩ category ∩ audience.
 * Surviving tips render in `byPriorityThenId` order (lower priority = higher
 * rank; id tiebreaker; tips without a priority sort to the bottom).
 */
import { useMemo, useState, type ReactNode } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import { useHashScroll } from '../../hooks/useHashScroll'
import { allTips, byPriorityThenId, searchTips } from '../../data/tips'
import type { Tip, TipAudience, TipCategory } from '../../data/tips/types'
import { TipCard } from '../../components/tips/TipCard'
import { FilterChip, EmptyState } from '../../components/ui'
import { SearchIcon } from '../../components/icons'

type AudienceFilter = 'all' | TipAudience

const AUDIENCE_FILTER_LABELS: Record<AudienceFilter, string> = {
  all: 'All',
  beginner: 'Beginner',
  power: 'Power user',
}

const AUDIENCE_FILTER_OPTIONS: AudienceFilter[] = ['all', 'beginner', 'power']

// Category-chip ordering: content-type categories first (most-used surfaces),
// then the rest alphabetical. Only categories present in the corpus surface.
const PRIMARY_CATEGORY_ORDER: TipCategory[] = ['bookmarks', 'notes', 'prompts']

export function DocsTips(): ReactNode {
  usePageTitle('Docs - Tips')
  useHashScroll()

  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategories, setSelectedCategories] = useState<Set<TipCategory>>(new Set())
  const [audienceFilter, setAudienceFilter] = useState<AudienceFilter>('all')

  const debouncedQuery = useDebouncedValue(searchQuery, 200)

  const presentCategories = useMemo<TipCategory[]>(() => {
    const present = new Set<TipCategory>()
    for (const tip of allTips) {
      for (const category of tip.categories) present.add(category)
    }
    const primary = PRIMARY_CATEGORY_ORDER.filter((cat) => present.has(cat))
    const secondary = Array.from(present)
      .filter((cat) => !PRIMARY_CATEGORY_ORDER.includes(cat))
      .sort()
    return [...primary, ...secondary]
  }, [])

  const filteredTips = useMemo(
    () => filterTips(allTips, debouncedQuery, selectedCategories, audienceFilter),
    [debouncedQuery, selectedCategories, audienceFilter],
  )

  const toggleCategory = (category: TipCategory): void => {
    setSelectedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(category)) {
        next.delete(category)
      } else {
        next.add(category)
      }
      return next
    })
  }

  const clearAllFilters = (): void => {
    setSearchQuery('')
    setSelectedCategories(new Set())
    setAudienceFilter('all')
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Tips</h1>
      <p className="text-sm text-gray-600 mb-6">
        Short, focused tips for getting more out of Tiddly. Filter by topic or
        audience, or search by keyword.
      </p>

      <div className="mb-4">
        <input
          type="search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search tips..."
          aria-label="Search tips"
          className="block w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400/20"
        />
      </div>

      <div className="mb-3">
        <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">
          Categories
        </div>
        <div className="flex flex-wrap gap-1.5">
          {presentCategories.map((category) => (
            <FilterChip
              key={category}
              label={category}
              selected={selectedCategories.has(category)}
              onClick={() => toggleCategory(category)}
            />
          ))}
        </div>
      </div>

      <div className="mb-6">
        <div
          id="audience-filter-label"
          className="mb-1.5 text-xs font-medium uppercase tracking-wide text-gray-500"
        >
          Audience
        </div>
        <div
          className="flex flex-wrap gap-1.5"
          role="radiogroup"
          aria-labelledby="audience-filter-label"
        >
          {AUDIENCE_FILTER_OPTIONS.map((option) => (
            <FilterChip
              key={option}
              label={AUDIENCE_FILTER_LABELS[option]}
              selected={audienceFilter === option}
              onClick={() => setAudienceFilter(option)}
              role="radio"
            />
          ))}
        </div>
      </div>

      {filteredTips.length === 0 ? (
        <EmptyState
          icon={<SearchIcon />}
          title="No tips match your filters"
          description="Try clearing a filter or rewording your search."
          actions={[{
            label: 'Clear filters',
            onClick: clearAllFilters,
            variant: 'secondary',
          }]}
        />
      ) : (
        <div>
          {filteredTips.map((tip) => (
            <TipCard key={tip.id} tip={tip} variant="full" />
          ))}
        </div>
      )}
    </div>
  )
}

function filterTips(
  tips: readonly Tip[],
  query: string,
  selectedCategories: ReadonlySet<TipCategory>,
  audience: AudienceFilter,
): Tip[] {
  // Search uses the M1 helper so docs/tips and any future surface (palette,
  // ambient callouts) stay in lockstep on what "matches" means. An empty
  // query means "no search filter," not "match nothing."
  const searchPool = query.trim().length > 0 ? searchTips(query) : tips
  return searchPool
    .filter((tip) => {
      const matchesCategory =
        selectedCategories.size === 0
        || tip.categories.some((cat) => selectedCategories.has(cat))
      // Inclusive match: a narrow audience filter ("Beginner" or "Power user")
      // also surfaces tips marked `audience: 'all'`, since 'all' means "applies
      // to everyone" rather than its own segment.
      const matchesAudience =
        audience === 'all' || tip.audience === audience || tip.audience === 'all'
      return matchesCategory && matchesAudience
    })
    .sort(byPriorityThenId)
}
