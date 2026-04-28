import { describe, it, expect } from 'vitest'
import {
  allTips,
  byPriorityThenId,
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
    categories: ['editor'],
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

  it('throws when the categories array is empty', () => {
    const tip = buildTip({ id: 'no-cats', categories: [] })
    expect(() => validateTips([tip])).toThrow(/empty categories/)
  })

  it('throws when starter=true but starterPriority is missing', () => {
    const tip = buildTip({ id: 'no-priority', starter: true })
    expect(() => validateTips([tip])).toThrow(/starterPriority/)
  })

  it('throws when two starter tips share a priority within the same category', () => {
    const tips = [
      buildTip({ id: 'first', categories: ['bookmarks'], starter: true, starterPriority: 1 }),
      buildTip({ id: 'second', categories: ['bookmarks'], starter: true, starterPriority: 1 }),
    ]
    expect(() => validateTips(tips)).toThrow(/priority 1/)
    expect(() => validateTips(tips)).toThrow(/bookmarks/)
  })

  it('allows two starter tips to share a priority across different categories', () => {
    const tips = [
      buildTip({ id: 'a', categories: ['bookmarks'], starter: true, starterPriority: 1 }),
      buildTip({ id: 'b', categories: ['notes'], starter: true, starterPriority: 1 }),
    ]
    expect(() => validateTips(tips)).not.toThrow()
  })

  it('detects a multi-category starter colliding via any of its categories', () => {
    // A tip claiming ['notes', 'prompts'] with priority 1 must not collide
    // with another priority-1 starter in EITHER 'notes' OR 'prompts'.
    const tips = [
      buildTip({ id: 'multi', categories: ['notes', 'prompts'], starter: true, starterPriority: 1 }),
      buildTip({ id: 'prompts-only', categories: ['prompts'], starter: true, starterPriority: 1 }),
    ]
    expect(() => validateTips(tips)).toThrow(/priority 1/)
    expect(() => validateTips(tips)).toThrow(/prompts/)
  })

  it('allows non-starter tips to omit starterPriority', () => {
    const tip = buildTip({ id: 'plain', starter: false })
    expect(() => validateTips([tip])).not.toThrow()
  })
})

describe('byPriorityThenId', () => {
  it('sorts by priority ascending', () => {
    const tips = [
      buildTip({ id: 'b', priority: 20 }),
      buildTip({ id: 'a', priority: 10 }),
    ].sort(byPriorityThenId)
    expect(tips.map((tip) => tip.id)).toEqual(['a', 'b'])
  })

  it('sorts tips without priority to the bottom', () => {
    const tips = [
      buildTip({ id: 'no-priority' }),
      buildTip({ id: 'has-priority', priority: 100 }),
    ].sort(byPriorityThenId)
    expect(tips.map((tip) => tip.id)).toEqual(['has-priority', 'no-priority'])
  })

  it('breaks priority ties by id (ascending)', () => {
    const tips = [
      buildTip({ id: 'zebra', priority: 1 }),
      buildTip({ id: 'alpha', priority: 1 }),
    ].sort(byPriorityThenId)
    expect(tips.map((tip) => tip.id)).toEqual(['alpha', 'zebra'])
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
      expect(tip.categories.length).toBeGreaterThan(0)
      for (const category of tip.categories) {
        expect(VALID_CATEGORIES.has(category)).toBe(true)
      }
      expect(['beginner', 'power', 'all']).toContain(tip.audience)
    }
  })

  it('seed corpus passes validateTips at module load', () => {
    expect(() => validateTips(allTips)).not.toThrow()
  })
})

describe('getTipsByCategory', () => {
  it('returns only tips that claim the requested category', () => {
    const result = getTipsByCategory('bookmarks')
    expect(result.length).toBeGreaterThan(0)
    for (const tip of result) {
      expect(tip.categories).toContain('bookmarks')
    }
  })

  it('returns multi-category tips under each category they claim', () => {
    // note-slash-commands has categories: ['notes', 'prompts']
    expect(getTipsByCategory('notes').map((tip) => tip.id))
      .toContain('note-slash-commands')
    expect(getTipsByCategory('prompts').map((tip) => tip.id))
      .toContain('note-slash-commands')
  })

  it('orders results by priority ascending', () => {
    // 'prompts' contains note-slash-commands (priority 10) and
    // prompt-template-arguments (priority 20).
    expect(getTipsByCategory('prompts').map((tip) => tip.id)).toEqual([
      'note-slash-commands',
      'prompt-template-arguments',
    ])
  })

  it('returns an empty array for a category with no tips', () => {
    expect(getTipsByCategory('cli')).toEqual([])
  })
})

describe('getTipsByArea', () => {
  it('returns tips whose areas exactly match the path', () => {
    const result = getTipsByArea('/app/content')
    expect(result.map((tip) => tip.id)).toContain('search-quoted-phrase')
  })

  it('returns tips whose areas are a prefix of the path', () => {
    const result = getTipsByArea('/app/content/filters/abc')
    expect(result.map((tip) => tip.id)).toContain('search-quoted-phrase')
  })

  it('does not return tips with no areas field', () => {
    const result = getTipsByArea('/some/unrelated/route')
    expect(result).toEqual([])
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
      expect(tip.categories).toContain('bookmarks')
      expect(tip.starter).toBe(true)
    }
  })

  it('returns multi-category starters under each of their categories', () => {
    // note-slash-commands is a starter claiming both 'notes' and 'prompts'.
    expect(getStarterTips('notes').map((tip) => tip.id))
      .toContain('note-slash-commands')
    expect(getStarterTips('prompts').map((tip) => tip.id))
      .toContain('note-slash-commands')
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
    // Round 1: bookmark→paste-url (added), note→slash-commands (added),
    //          prompt→slash-commands (deduped, cursor still advances).
    // Round 2: prompt→prompt-template-arguments (added).
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
  function makeStarter(
    id: string,
    categories: TipCategory[],
    priority: number,
  ): Tip {
    return {
      id,
      title: `Title for ${id}`,
      body: `Body for ${id}.`,
      categories,
      audience: 'all',
      starter: true,
      starterPriority: priority,
    }
  }

  it('skips a content type with zero starters and fills the limit from others', () => {
    // bookmark has 2 starters, note has 0, prompt has 1.
    const corpus: Tip[] = [
      makeStarter('b1', ['bookmarks'], 1),
      makeStarter('b2', ['bookmarks'], 2),
      makeStarter('p1', ['prompts'], 1),
    ]
    const result = pickStarterTipsFromCorpus(corpus, ['bookmark', 'note', 'prompt'], 3)
    expect(result.map((tip) => tip.id)).toEqual(['b1', 'p1', 'b2'])
  })

  it('lets a single populated type absorb every slot when others are empty', () => {
    const corpus: Tip[] = [
      makeStarter('b1', ['bookmarks'], 1),
      makeStarter('b2', ['bookmarks'], 2),
      makeStarter('b3', ['bookmarks'], 3),
      makeStarter('b4', ['bookmarks'], 4),
    ]
    const result = pickStarterTipsFromCorpus(corpus, ['bookmark', 'note', 'prompt'], 3)
    expect(result.map((tip) => tip.id)).toEqual(['b1', 'b2', 'b3'])
  })

  it('preserves round-robin order when multiple types each have multiple starters', () => {
    const corpus: Tip[] = [
      makeStarter('b1', ['bookmarks'], 1),
      makeStarter('b2', ['bookmarks'], 2),
      makeStarter('n1', ['notes'], 1),
      makeStarter('n2', ['notes'], 2),
    ]
    const result = pickStarterTipsFromCorpus(corpus, ['bookmark', 'note'], 4)
    expect(result.map((tip) => tip.id)).toEqual(['b1', 'n1', 'b2', 'n2'])
  })

  it('breaks priority ties within a category by id (ascending)', () => {
    const corpus: Tip[] = [
      makeStarter('b-zebra', ['bookmarks'], 1),
      makeStarter('b-alpha', ['bookmarks'], 1),
    ]
    // Validation forbids duplicate priorities in a real corpus; this asserts
    // the comparator's deterministic tiebreaker for fixture-driven tests.
    const result = pickStarterTipsFromCorpus(corpus, ['bookmark'], 2)
    expect(result.map((tip) => tip.id)).toEqual(['b-alpha', 'b-zebra'])
  })

  it('orders cross-type output by ALL_CONTENT_TYPES regardless of input order', () => {
    const corpus: Tip[] = [
      makeStarter('b1', ['bookmarks'], 1),
      makeStarter('n1', ['notes'], 1),
      makeStarter('p1', ['prompts'], 1),
    ]
    const result = pickStarterTipsFromCorpus(corpus, ['prompt', 'note', 'bookmark'], 3)
    expect(result.map((tip) => tip.id)).toEqual(['b1', 'n1', 'p1'])
  })

  it('dedupes a multi-category tip that maps to two requested content types', () => {
    // A tip claiming ['notes', 'prompts'] is in both note and prompt starter
    // pools. Without dedupe-by-id it would render twice when both content
    // types are requested. The dedupe is load-bearing here, not defensive.
    const corpus: Tip[] = [
      makeStarter('multi', ['notes', 'prompts'], 1),
      makeStarter('p-extra', ['prompts'], 2),
    ]
    const result = pickStarterTipsFromCorpus(corpus, ['note', 'prompt'], 3)
    // multi appears once (deduped on the prompt side); the prompt cursor
    // still advances past the deduped pick, so p-extra fills round 2.
    expect(result.map((tip) => tip.id)).toEqual(['multi', 'p-extra'])
  })

  it('returns empty when the corpus has no starters at all', () => {
    const corpus: Tip[] = [
      {
        id: 'plain',
        title: 't',
        body: 'b',
        categories: ['bookmarks'],
        audience: 'all',
      },
    ]
    expect(pickStarterTipsFromCorpus(corpus, ['bookmark'], 3)).toEqual([])
  })
})

describe('searchTips', () => {
  it('matches case-insensitively on title', () => {
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
