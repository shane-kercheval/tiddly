import { describe, it, expect } from 'vitest'
import {
  allTips,
  getStarterTips,
  getTipsByArea,
  getTipsByCategory,
  pickStarterTipsForContentTypes,
  pickStarterTipsFromCorpus,
  searchTips,
  validateTips,
} from './index'
import type { Tip, TipCategory } from './types'
import { BODY_MAX_LENGTH, TITLE_MAX_LENGTH } from './types'

const VALID_CATEGORIES: ReadonlySet<TipCategory> = new Set([
  'editor', 'search', 'filters', 'tags',
  'cli', 'extension', 'mcp', 'prompts',
  'bookmarks', 'notes', 'ai',
  'shortcuts', 'account',
])

function buildTip(overrides: Partial<Tip> = {}): Tip {
  return {
    id: 'fixture-tip',
    title: 'Fixture title',
    body: 'Fixture body.',
    category: 'editor',
    audience: 'all',
    ...overrides,
  }
}

describe('validateTips', () => {
  it('accepts an empty array', () => {
    expect(() => validateTips([])).not.toThrow()
  })

  it('throws on duplicate ids with a useful message', () => {
    const tips = [
      buildTip({ id: 'dupe' }),
      buildTip({ id: 'dupe', title: 'Different title' }),
    ]
    expect(() => validateTips(tips)).toThrow(/dupe/)
  })

  it('throws when title exceeds the max length', () => {
    const tip = buildTip({ id: 'long-title', title: 'a'.repeat(TITLE_MAX_LENGTH + 1) })
    expect(() => validateTips([tip])).toThrow(/title/i)
    expect(() => validateTips([tip])).toThrow(new RegExp(String(TITLE_MAX_LENGTH)))
  })

  it('throws when body exceeds the max length', () => {
    const tip = buildTip({ id: 'long-body', body: 'a'.repeat(BODY_MAX_LENGTH + 1) })
    expect(() => validateTips([tip])).toThrow(/body/i)
    expect(() => validateTips([tip])).toThrow(new RegExp(String(BODY_MAX_LENGTH)))
  })

  it('throws when starter=true but starterPriority is missing', () => {
    const tip = buildTip({ id: 'no-priority', starter: true })
    expect(() => validateTips([tip])).toThrow(/starterPriority/)
  })

  it('throws when two starter tips share a priority within the same category', () => {
    const tips = [
      buildTip({ id: 'first', category: 'bookmarks', starter: true, starterPriority: 1 }),
      buildTip({ id: 'second', category: 'bookmarks', starter: true, starterPriority: 1 }),
    ]
    expect(() => validateTips(tips)).toThrow(/priority 1/)
    expect(() => validateTips(tips)).toThrow(/bookmarks/)
  })

  it('allows two starter tips to share a priority across different categories', () => {
    const tips = [
      buildTip({ id: 'a', category: 'bookmarks', starter: true, starterPriority: 1 }),
      buildTip({ id: 'b', category: 'notes', starter: true, starterPriority: 1 }),
    ]
    expect(() => validateTips(tips)).not.toThrow()
  })

  it('allows non-starter tips to omit starterPriority', () => {
    const tip = buildTip({ id: 'plain', starter: false })
    expect(() => validateTips([tip])).not.toThrow()
  })
})

describe('seed corpus schema sanity', () => {
  it('every seed tip has the required fields', () => {
    for (const tip of allTips) {
      expect(tip.id).toMatch(/^[a-z0-9][a-z0-9-]*$/)
      expect(typeof tip.title).toBe('string')
      expect(tip.title.length).toBeGreaterThan(0)
      expect(typeof tip.body).toBe('string')
      expect(tip.body.length).toBeGreaterThan(0)
      expect(VALID_CATEGORIES.has(tip.category)).toBe(true)
      expect(['beginner', 'power', 'all']).toContain(tip.audience)
    }
  })

  it('seed corpus passes validateTips at module load', () => {
    // Importing this file triggered validateTips(allTips) — re-run for explicitness.
    expect(() => validateTips(allTips)).not.toThrow()
  })
})

describe('getTipsByCategory', () => {
  it('returns only tips of the requested category', () => {
    const result = getTipsByCategory('bookmarks')
    expect(result.length).toBeGreaterThan(0)
    for (const tip of result) {
      expect(tip.category).toBe('bookmarks')
    }
  })

  it('returns an empty array for a category with no tips', () => {
    expect(getTipsByCategory('cli')).toEqual([])
  })
})

describe('getTipsByArea', () => {
  it('returns tips whose areas exactly match the path', () => {
    // search-quoted-phrase has areas: ['/app/content']
    const result = getTipsByArea('/app/content')
    expect(result.map((tip) => tip.id)).toContain('search-quoted-phrase')
  })

  it('returns tips whose areas are a prefix of the path', () => {
    // /app/content/* should pick up tips with areas: ['/app/content']
    const result = getTipsByArea('/app/content/filters/abc')
    expect(result.map((tip) => tip.id)).toContain('search-quoted-phrase')
  })

  it('does not return tips with no areas field', () => {
    // bookmark-paste-url has no areas → never matched by area lookup.
    const result = getTipsByArea('/app/content')
    expect(result.map((tip) => tip.id)).not.toContain('bookmark-paste-url')
  })

  it('returns an empty array when no tip area covers the path', () => {
    expect(getTipsByArea('/some/unrelated/route')).toEqual([])
  })

  it('strips query string and hash before matching', () => {
    const result = getTipsByArea('/app/content?ref=palette#tip-1')
    expect(result.map((tip) => tip.id)).toContain('search-quoted-phrase')
  })

  it('matches multi-area tips on any of their areas', () => {
    // shortcut-select-next-occurrence has areas: ['/app/notes', '/app/prompts']
    expect(getTipsByArea('/app/notes/123').map((tip) => tip.id))
      .toContain('shortcut-select-next-occurrence')
    expect(getTipsByArea('/app/prompts/456').map((tip) => tip.id))
      .toContain('shortcut-select-next-occurrence')
  })
})

describe('getStarterTips', () => {
  it('returns only starter tips, sorted by starterPriority ascending', () => {
    const starters = getStarterTips()
    expect(starters.length).toBeGreaterThan(0)
    for (const tip of starters) {
      expect(tip.starter).toBe(true)
    }
    for (let i = 1; i < starters.length; i++) {
      const prev = starters[i - 1].starterPriority!
      const curr = starters[i].starterPriority!
      expect(prev).toBeLessThanOrEqual(curr)
    }
  })

  it('scopes to a category when one is given', () => {
    const result = getStarterTips('bookmarks')
    expect(result.length).toBeGreaterThan(0)
    for (const tip of result) {
      expect(tip.category).toBe('bookmarks')
      expect(tip.starter).toBe(true)
    }
  })

  it('returns an empty array for a category with no starter tips', () => {
    expect(getStarterTips('cli')).toEqual([])
  })
})

describe('pickStarterTipsForContentTypes', () => {
  // These tests pin exact ids against the seed corpus. If the seed corpus is
  // reordered or its starter set changes, these tests SHOULD fail — that's the
  // regression flag for "this would silently change starter-tip UI."

  it('returns starter tips for a single content type, ordered by priority', () => {
    const result = pickStarterTipsForContentTypes(['bookmark'], 3)
    expect(result.map((tip) => tip.id)).toEqual(['bookmark-paste-url'])
  })

  it('returns one tip per type, in ALL_CONTENT_TYPES order, capped at limit', () => {
    const result = pickStarterTipsForContentTypes(['note', 'bookmark', 'prompt'], 3)
    // Cross-type order pinned to ALL_CONTENT_TYPES (bookmark → note → prompt),
    // not to the input order.
    expect(result.map((tip) => tip.id)).toEqual([
      'bookmark-paste-url',
      'note-slash-commands',
      'prompt-template-arguments',
    ])
  })

  it('respects limit when it is smaller than available tips', () => {
    const result = pickStarterTipsForContentTypes(['bookmark', 'note', 'prompt'], 2)
    expect(result.map((tip) => tip.id)).toEqual([
      'bookmark-paste-url',
      'note-slash-commands',
    ])
  })

  it('returns an empty array for limit ≤ 0', () => {
    expect(pickStarterTipsForContentTypes(['bookmark'], 0)).toEqual([])
    expect(pickStarterTipsForContentTypes(['bookmark'], -1)).toEqual([])
  })

  it('returns an empty array when no types are requested', () => {
    expect(pickStarterTipsForContentTypes([], 3)).toEqual([])
  })

  it('produces deterministic ordering across repeated calls', () => {
    const first = pickStarterTipsForContentTypes(['bookmark', 'note', 'prompt'], 3)
    const second = pickStarterTipsForContentTypes(['bookmark', 'note', 'prompt'], 3)
    expect(first.map((tip) => tip.id)).toEqual(second.map((tip) => tip.id))
  })
})

describe('pickStarterTipsFromCorpus — pure helper edge cases', () => {
  // Cases the live corpus can't currently express. These pin the algorithm's
  // contract: round-robin distribution, "fill from others when one is empty",
  // and tie-breaking by id within a category.

  function makeStarter(id: string, category: TipCategory, priority: number): Tip {
    return {
      id,
      title: `Title for ${id}`,
      body: `Body for ${id}.`,
      category,
      audience: 'all',
      starter: true,
      starterPriority: priority,
    }
  }

  it('skips a content type with zero starters and fills the limit from others', () => {
    // bookmark has 2 starters, note has 0, prompt has 1.
    // Limit 3 → all 3 slots filled; note contributes 0; bookmark fills its
    // slot first round, then absorbs note's vacancy in round 2.
    const corpus: Tip[] = [
      makeStarter('b1', 'bookmarks', 1),
      makeStarter('b2', 'bookmarks', 2),
      makeStarter('p1', 'prompts', 1),
    ]
    const result = pickStarterTipsFromCorpus(corpus, ['bookmark', 'note', 'prompt'], 3)
    // Round 1: bookmark→b1, note→(skip), prompt→p1.
    // Round 2: bookmark→b2, note→(skip), prompt→(empty).
    expect(result.map((tip) => tip.id)).toEqual(['b1', 'p1', 'b2'])
  })

  it('lets a single populated type absorb every slot when others are empty', () => {
    const corpus: Tip[] = [
      makeStarter('b1', 'bookmarks', 1),
      makeStarter('b2', 'bookmarks', 2),
      makeStarter('b3', 'bookmarks', 3),
      makeStarter('b4', 'bookmarks', 4),
    ]
    const result = pickStarterTipsFromCorpus(corpus, ['bookmark', 'note', 'prompt'], 3)
    expect(result.map((tip) => tip.id)).toEqual(['b1', 'b2', 'b3'])
  })

  it('preserves round-robin order when multiple types each have multiple starters', () => {
    const corpus: Tip[] = [
      makeStarter('b1', 'bookmarks', 1),
      makeStarter('b2', 'bookmarks', 2),
      makeStarter('n1', 'notes', 1),
      makeStarter('n2', 'notes', 2),
    ]
    const result = pickStarterTipsFromCorpus(corpus, ['bookmark', 'note'], 4)
    // Round 1 fills b1, n1; round 2 fills b2, n2 — strictly interleaved.
    expect(result.map((tip) => tip.id)).toEqual(['b1', 'n1', 'b2', 'n2'])
  })

  it('breaks priority ties within a category by id (ascending)', () => {
    const corpus: Tip[] = [
      makeStarter('b-zebra', 'bookmarks', 1),
      makeStarter('b-alpha', 'bookmarks', 1),
    ]
    // Validation forbids this in the live corpus (duplicate priority within a
    // category), but the comparator must still be deterministic if a fixture
    // ever bypasses validation. Pin the tiebreaker.
    const result = pickStarterTipsFromCorpus(corpus, ['bookmark'], 2)
    expect(result.map((tip) => tip.id)).toEqual(['b-alpha', 'b-zebra'])
  })

  it('orders cross-type output by ALL_CONTENT_TYPES regardless of input order', () => {
    const corpus: Tip[] = [
      makeStarter('b1', 'bookmarks', 1),
      makeStarter('n1', 'notes', 1),
      makeStarter('p1', 'prompts', 1),
    ]
    // Input order is reversed; output must still be bookmark → note → prompt.
    const result = pickStarterTipsFromCorpus(corpus, ['prompt', 'note', 'bookmark'], 3)
    expect(result.map((tip) => tip.id)).toEqual(['b1', 'n1', 'p1'])
  })

  it('returns empty when the corpus has no starters at all', () => {
    const corpus: Tip[] = [
      {
        id: 'plain',
        title: 't',
        body: 'b',
        category: 'bookmarks',
        audience: 'all',
      },
    ]
    expect(pickStarterTipsFromCorpus(corpus, ['bookmark'], 3)).toEqual([])
  })
})

describe('searchTips', () => {
  it('matches case-insensitively on title', () => {
    // bookmark-paste-url has "Save a bookmark by pasting its URL"
    const result = searchTips('PASTING')
    expect(result.map((tip) => tip.id)).toContain('bookmark-paste-url')
  })

  it('matches case-insensitively on body', () => {
    // note-slash-commands body mentions "callouts"
    const result = searchTips('callouts')
    expect(result.map((tip) => tip.id)).toContain('note-slash-commands')
  })

  it('returns an empty array for an empty query', () => {
    expect(searchTips('')).toEqual([])
    expect(searchTips('   ')).toEqual([])
  })

  it('returns an empty array when nothing matches', () => {
    expect(searchTips('xyzzy-no-such-tip')).toEqual([])
  })

  it('trims whitespace before matching', () => {
    const trimmed = searchTips('pasting')
    const padded = searchTips('  pasting  ')
    expect(padded.map((tip) => tip.id)).toEqual(trimmed.map((tip) => tip.id))
  })
})
