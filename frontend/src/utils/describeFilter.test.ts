import { describe, it, expect } from 'vitest'
import {
  composeDescription,
  describeSavedFilter,
  describeSearchOverlay,
  describeTagChips,
  resolveFilterContentTypes,
} from './describeFilter'
import type { ContentFilter, ContentType, FilterGroup } from '../types'

function buildFilter(overrides: Partial<ContentFilter> = {}): ContentFilter {
  return {
    id: 'filter-id',
    name: 'Filter',
    content_types: ['bookmark'],
    filter_expression: {
      groups: [{ tags: ['python'], operator: 'AND' }],
      group_operator: 'OR',
    },
    default_sort_by: null,
    default_sort_ascending: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

function group(...tags: string[]): FilterGroup {
  return { tags, operator: 'AND' }
}

describe('resolveFilterContentTypes', () => {
  it('returns content_types when non-empty', () => {
    const filter = buildFilter({ content_types: ['note'] })
    expect(resolveFilterContentTypes(filter)).toEqual(['note'])
  })

  it('falls back to all content types when content_types is empty', () => {
    const filter = buildFilter({ content_types: [] })
    expect(resolveFilterContentTypes(filter)).toEqual(['bookmark', 'note', 'prompt'])
  })
})

describe('describeSavedFilter', () => {
  it('describes a single-group, single-tag, single-type filter', () => {
    const filter = buildFilter({
      content_types: ['bookmark'],
      filter_expression: { groups: [group('python')], group_operator: 'OR' },
    })
    expect(describeSavedFilter(filter, ['bookmark'], 'active')).toEqual({
      title: 'No bookmarks tagged with "python" yet',
    })
  })

  it('joins multiple tags in one AND group with "and"', () => {
    const filter = buildFilter({
      filter_expression: { groups: [group('python', 'tutorial')], group_operator: 'OR' },
    })
    expect(describeSavedFilter(filter, ['bookmark'], 'active').title)
      .toBe('No bookmarks tagged with "python" and "tutorial" yet')
  })

  it('joins multiple OR groups with "or", parenthesizing each AND group', () => {
    const filter = buildFilter({
      content_types: [],
      filter_expression: {
        groups: [group('python', 'reading-list'), group('rust', 'tutorial')],
        group_operator: 'OR',
      },
    })
    expect(describeSavedFilter(filter, ['bookmark', 'note', 'prompt'], 'active').title)
      .toBe('No items tagged with ("python" and "reading-list") or ("rust" and "tutorial") yet')
  })

  it('uses "or" between content type plurals for the 2-type case', () => {
    const filter = buildFilter({
      content_types: ['bookmark', 'note'],
      filter_expression: { groups: [group('python')], group_operator: 'OR' },
    })
    expect(describeSavedFilter(filter, ['bookmark', 'note'], 'active').title)
      .toBe('No bookmarks or notes tagged with "python" yet')
  })

  it('collapses to "items" when effective types cover everything', () => {
    const filter = buildFilter({
      content_types: ['bookmark', 'note', 'prompt'],
      filter_expression: { groups: [group('python')], group_operator: 'OR' },
    })
    expect(describeSavedFilter(filter, ['bookmark', 'note', 'prompt'], 'active').title)
      .toBe('No items tagged with "python" yet')
  })

  it('uses "items" when effective content types is empty (defensive)', () => {
    const filter = buildFilter({
      filter_expression: { groups: [group('python')], group_operator: 'OR' },
    })
    expect(describeSavedFilter(filter, [], 'active').title)
      .toBe('No items tagged with "python" yet')
  })

  it('composes the archived view modifier', () => {
    const filter = buildFilter({
      filter_expression: { groups: [group('python')], group_operator: 'OR' },
    })
    expect(describeSavedFilter(filter, ['bookmark'], 'archived').title)
      .toBe('No archived bookmarks tagged with "python" yet')
  })

  it('composes the deleted view modifier', () => {
    const filter = buildFilter({
      filter_expression: { groups: [group('python')], group_operator: 'OR' },
    })
    expect(describeSavedFilter(filter, ['bookmark'], 'deleted').title)
      .toBe('No deleted bookmarks tagged with "python" yet')
  })

  it('returns the fallback when groups is empty', () => {
    const filter = buildFilter({
      filter_expression: { groups: [], group_operator: 'OR' },
    })
    expect(describeSavedFilter(filter, ['bookmark'], 'active'))
      .toEqual({ title: 'No items match this filter yet' })
  })

  it('returns the fallback when every group has only empty-string tags', () => {
    const filter = buildFilter({
      filter_expression: { groups: [{ tags: [''], operator: 'AND' }], group_operator: 'OR' },
    })
    expect(describeSavedFilter(filter, ['bookmark'], 'active'))
      .toEqual({ title: 'No items match this filter yet' })
  })

  it('reflects narrowed effective content types in the noun', () => {
    // Filter declares both, but a transient content-type chip narrows to notes.
    const filter = buildFilter({
      content_types: ['bookmark', 'note'],
      filter_expression: { groups: [group('python')], group_operator: 'OR' },
    })
    expect(describeSavedFilter(filter, ['note'], 'active').title)
      .toBe('No notes tagged with "python" yet')
  })

  it('quotes tags that contain spaces so they read as one tag, not multiple', () => {
    // The drift this guards against: an unquoted multi-word tag like
    // `reading list` reads as if it were two tags joined by an unfortunate
    // accident. Quotes make the boundary unambiguous.
    const filter = buildFilter({
      filter_expression: {
        groups: [group('reading list', 'data science')],
        group_operator: 'OR',
      },
    })
    expect(describeSavedFilter(filter, ['bookmark'], 'active').title)
      .toBe('No bookmarks tagged with "reading list" and "data science" yet')
  })

  it('escapes embedded double quotes in tag names so copy stays balanced', () => {
    // A tag containing a `"` (rare but legal in the tag store) would render
    // unbalanced quotes if we used naive wrapping. The escape keeps the copy
    // honest at the cost of a visible backslash.
    const filter = buildFilter({
      filter_expression: { groups: [group('he"llo')], group_operator: 'OR' },
    })
    expect(describeSavedFilter(filter, ['bookmark'], 'active').title)
      .toBe('No bookmarks tagged with "he\\"llo" yet')
  })
})

describe('describeTagChips', () => {
  const allTypes: ContentType[] = ['bookmark', 'note', 'prompt']

  it('standalone: single tag with match=all', () => {
    const result = describeTagChips(['python'], 'all', ['bookmark'], ['bookmark'], 'active', 'standalone')
    expect(result.title).toBe('No bookmarks tagged with "python" yet')
    expect(result.description).toBe('')
  })

  it('standalone: multiple tags with match=all join with "and"', () => {
    expect(describeTagChips(['python', 'tutorial'], 'all', ['bookmark'], ['bookmark'], 'active', 'standalone').title)
      .toBe('No bookmarks tagged with "python" and "tutorial" yet')
  })

  it('standalone: multiple tags with match=any join with "or"', () => {
    expect(describeTagChips(['python', 'rust'], 'any', ['bookmark'], ['bookmark'], 'active', 'standalone').title)
      .toBe('No bookmarks tagged with "python" or "rust" yet')
  })

  it('standalone: narrows the noun when content type chip is a subset of available types', () => {
    expect(describeTagChips(['python'], 'all', ['note'], allTypes, 'active', 'standalone').title)
      .toBe('No notes tagged with "python" yet')
  })

  it('standalone: keeps the broad noun when chip selection equals available types', () => {
    expect(describeTagChips(['python'], 'all', allTypes, allTypes, 'active', 'standalone').title)
      .toBe('No items tagged with "python" yet')
  })

  it('standalone: composes archived view modifier', () => {
    expect(describeTagChips(['python'], 'all', ['bookmark'], ['bookmark'], 'archived', 'standalone').title)
      .toBe('No archived bookmarks tagged with "python" yet')
  })

  it('overlay: single tag returns subordinate clause without a title', () => {
    const result = describeTagChips(['tutorial'], 'all', allTypes, allTypes, 'active', 'overlay')
    expect(result.title).toBeUndefined()
    expect(result.description).toBe('You\'re also filtering by tag "tutorial".')
  })

  it('overlay: multiple tags with match=all use "and" and the "tags" label', () => {
    expect(describeTagChips(['tutorial', 'rust'], 'all', allTypes, allTypes, 'active', 'overlay').description)
      .toBe('You\'re also filtering by tags "tutorial" and "rust".')
  })

  it('overlay: multiple tags with match=any use "or"', () => {
    expect(describeTagChips(['tutorial', 'rust'], 'any', allTypes, allTypes, 'active', 'overlay').description)
      .toBe('You\'re also filtering by tags "tutorial" or "rust".')
  })

  it('returns empty result for empty tag list (defensive)', () => {
    const standalone = describeTagChips([], 'all', allTypes, allTypes, 'active', 'standalone')
    expect(standalone.title).toBe('No items match this filter yet')
    const overlay = describeTagChips([], 'all', allTypes, allTypes, 'active', 'overlay')
    expect(overlay.description).toBe('')
  })
})

describe('describeSearchOverlay', () => {
  it('wraps a plain query in double quotes', () => {
    expect(describeSearchOverlay('hello')).toBe('Matching "hello".')
  })

  it('escapes embedded double quotes so the rendered string stays balanced', () => {
    // A user typing a literal double-quote into the search box should not
    // produce malformed empty-state copy. `JSON.stringify` renders the
    // embedded quote as `\"`, which is unambiguous if slightly ugly.
    expect(describeSearchOverlay('he"llo')).toBe('Matching "he\\"llo".')
  })

  it('preserves whitespace and special characters in the query', () => {
    expect(describeSearchOverlay('multi word')).toBe('Matching "multi word".')
  })
})

describe('composeDescription', () => {
  it('joins non-empty fragments with a single space', () => {
    expect(composeDescription('First.', 'Second.')).toBe('First. Second.')
  })

  it('drops empty fragments so a missing overlay does not leave stray spaces', () => {
    expect(composeDescription('Primary.', '', 'Secondary.')).toBe('Primary. Secondary.')
    expect(composeDescription('', 'Only.')).toBe('Only.')
    expect(composeDescription('Only.', '')).toBe('Only.')
  })

  it('returns the empty string when every fragment is empty', () => {
    expect(composeDescription('', '', '')).toBe('')
  })
})
