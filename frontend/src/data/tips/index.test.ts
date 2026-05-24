import { describe, it, expect } from 'vitest'
import { findMatchingRoute } from '../../routePrefetch'
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

  describe('shortcut fields', () => {
    it('throws when both shortcutId and shortcut are set on the same tip', () => {
      const tip = buildTip({
        id: 'conflict',
        shortcutId: 'app.commandPalette',
        shortcut: ['Mod', 'P'],
      })
      expect(() => validateTips([tip])).toThrow(/both shortcutId and shortcut/)
      expect(() => validateTips([tip])).toThrow(/conflict/)
    })

    it('throws when shortcutId is set to an unknown id', () => {
      const tip = buildTip({
        id: 'bad-id',
        // Cast through string because the type union doesn't admit unknown ids.
        shortcutId: 'app.notARealId' as never,
      })
      expect(() => validateTips([tip])).toThrow(/unknown shortcutId/)
      expect(() => validateTips([tip])).toThrow(/bad-id/)
    })

    it('accepts a registry-backed shortcutId', () => {
      const tip = buildTip({ id: 'ok-registry', shortcutId: 'app.commandPalette' })
      expect(() => validateTips([tip])).not.toThrow()
    })

    it('accepts an extras-module shortcutId', () => {
      const tip = buildTip({ id: 'ok-extras', shortcutId: 'page.save' })
      expect(() => validateTips([tip])).not.toThrow()
    })

    it('throws when shortcut is set but empty', () => {
      const tip = buildTip({ id: 'empty-shortcut', shortcut: [] })
      expect(() => validateTips([tip])).toThrow(/empty shortcut array/)
    })

    it('accepts a non-empty literal shortcut array of OS-agnostic tokens', () => {
      const tip = buildTip({ id: 'ok-literal', shortcut: ['Mod', 'V'] })
      expect(() => validateTips([tip])).not.toThrow()
    })

    it('throws when a literal shortcut uses a Mac glyph (must be OS-agnostic)', () => {
      const tip = buildTip({ id: 'glyph-shortcut', shortcut: ['⌘', 'V'] })
      expect(() => validateTips([tip])).toThrow(/Mac glyph/)
      expect(() => validateTips([tip])).toThrow(/glyph-shortcut/)
    })
  })

  describe('body shortcut tokens', () => {
    it('throws on a body token whose id is unknown', () => {
      const tip = buildTip({
        id: 'bad-body-token',
        body: 'Press `{{shortcut:app.notARealId}}` to do something.',
      })
      expect(() => validateTips([tip])).toThrow(/unknown shortcut token/)
      expect(() => validateTips([tip])).toThrow(/bad-body-token/)
      expect(() => validateTips([tip])).toThrow(/app\.notARealId/)
    })

    it('accepts a body token whose id resolves via the registry', () => {
      const tip = buildTip({
        id: 'ok-body-registry',
        body: 'Press `{{shortcut:app.commandPalette}}` to open the palette.',
      })
      expect(() => validateTips([tip])).not.toThrow()
    })

    it('accepts a body token whose id resolves via the extras module', () => {
      const tip = buildTip({
        id: 'ok-body-extras',
        body: 'Press `{{shortcut:page.saveAndClose}}` to close.',
      })
      expect(() => validateTips([tip])).not.toThrow()
    })

    it('catches all tokens, not just the first, when multiple appear', () => {
      // Token 1 is valid; token 2 is bogus. The validator must throw on token 2.
      const tip = buildTip({
        id: 'multi-token',
        body:
          'First `{{shortcut:app.commandPalette}}` then `{{shortcut:bogus.id}}` last.',
      })
      expect(() => validateTips([tip])).toThrow(/bogus\.id/)
    })

    it('flags a token even when it appears outside a code span', () => {
      // The render-time override only fires inside inline code, but a stale
      // token reference in prose is still worth catching at validation time.
      const tip = buildTip({
        id: 'token-in-prose',
        body: 'See {{shortcut:unknown.thing}} for details.',
      })
      expect(() => validateTips([tip])).toThrow(/unknown\.thing/)
    })

    // Backtick-wrapping enforcement — a valid id used bare in prose would
    // render as literal `{{shortcut:X}}` text (the render-time override only
    // fires inside `code` nodes). The validator must catch this.
    it('rejects a valid-id token that is not wrapped in backticks', () => {
      const tip = buildTip({
        id: 'bare-valid-token',
        body: 'Press {{shortcut:app.commandPalette}} to open.',
      })
      expect(() => validateTips([tip])).toThrow(/must be wrapped in an inline code span/)
      expect(() => validateTips([tip])).toThrow(/bare-valid-token/)
    })

    it('rejects a token at position 0 of the body (no preceding backtick)', () => {
      const tip = buildTip({
        id: 'token-at-start',
        body: '{{shortcut:app.commandPalette}} appears first.',
      })
      expect(() => validateTips([tip])).toThrow(/must be wrapped in an inline code span/)
    })

    it('rejects a token at the very end of the body (no trailing backtick)', () => {
      const tip = buildTip({
        id: 'token-at-end',
        body: 'Ends with {{shortcut:app.commandPalette}}',
      })
      expect(() => validateTips([tip])).toThrow(/must be wrapped in an inline code span/)
    })

    it('rejects a token with only a leading backtick', () => {
      const tip = buildTip({
        id: 'leading-backtick-only',
        body: 'Half-wrapped: `{{shortcut:app.commandPalette}} oops.',
      })
      expect(() => validateTips([tip])).toThrow(/must be wrapped in an inline code span/)
    })

    it('rejects a token with only a trailing backtick', () => {
      const tip = buildTip({
        id: 'trailing-backtick-only',
        body: 'Half-wrapped: {{shortcut:app.commandPalette}}` oops.',
      })
      expect(() => validateTips([tip])).toThrow(/must be wrapped in an inline code span/)
    })

    it('accepts a token wrapped in double backticks', () => {
      // CommonMark: matching backtick runs of equal length form an inline
      // code span. Render hits the same code override regardless of run
      // length, so the validator must accept this as a valid wrap.
      const tip = buildTip({
        id: 'double-backtick',
        body: 'See ``{{shortcut:app.commandPalette}}`` for details.',
      })
      expect(() => validateTips([tip])).not.toThrow()
    })

    it('rejects a token inside a fenced code block (newline-adjacent)', () => {
      // Fenced blocks produce a `code` element with `\n`-adjacent text; the
      // render-time override doesn't fire on them, so a token authored in a
      // fenced block would render literally. The validator should reject.
      const tip = buildTip({
        id: 'token-in-fence',
        body: '```\n{{shortcut:app.commandPalette}}\n```',
      })
      expect(() => validateTips([tip])).toThrow(/must be wrapped in an inline code span/)
    })
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

  // No explicit empty-category regression test: `getTipsByCategory` reads
  // `allTips` directly, every TipCategory has at least one tip in the v1
  // corpus, and adding corpus-injection just to test `Array.filter` returning
  // `[]` would expand the API surface for negligible gain. If a new
  // TipCategory ever lands without tips, the filter will simply return `[]`.

  it('returns the requested category\'s tips in ascending-priority, then ascending-id order', () => {
    // Walk the result and assert the sort comparator held — independent of
    // which specific tips happen to be in the corpus today.
    const result = getTipsByCategory('shortcuts')
    expect(result.length).toBeGreaterThan(0)
    for (let i = 1; i < result.length; i++) {
      const prev = result[i - 1]
      const curr = result[i]
      const prevPriority = prev.priority ?? Number.POSITIVE_INFINITY
      const currPriority = curr.priority ?? Number.POSITIVE_INFINITY
      if (prevPriority === currPriority) {
        expect(prev.id.localeCompare(curr.id)).toBeLessThanOrEqual(0)
      } else {
        expect(prevPriority).toBeLessThan(currPriority)
      }
    }
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
    // Round 2: note→reading-mode-toggle (added, hits limit before prompt).
    expect(result.map((tip) => tip.id)).toEqual([
      'bookmark-paste-url',
      'note-slash-commands',
      'reading-mode-toggle',
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

describe('corpus invariants (M5)', () => {
  // Each content type's empty-state needs at least one starter to surface in
  // the new-user empty state — without this guarantee, a fresh user landing
  // on (say) the bookmarks view would see no starter tips at all.
  it('has at least one starter tip per major content type', () => {
    expect(getStarterTips('bookmarks').length).toBeGreaterThan(0)
    expect(getStarterTips('notes').length).toBeGreaterThan(0)
    expect(getStarterTips('prompts').length).toBeGreaterThan(0)
  })

  // Drift guard: a tip's `relatedDocs` paths must resolve through
  // `findMatchingRoute` — same matcher PrefetchLink uses. If a tip references
  // a route the prefetcher doesn't know about, add it to routePrefetch.ts
  // first (so the link prefetches on hover), then the test passes.
  it('every relatedDocs path resolves via findMatchingRoute', () => {
    const failures: string[] = []
    for (const tip of allTips) {
      if (tip.relatedDocs === undefined) continue
      for (const doc of tip.relatedDocs) {
        if (findMatchingRoute(doc.path) === undefined) {
          failures.push(`Tip "${tip.id}" relatedDocs path "${doc.path}" is not in routePrefetch.ts`)
        }
      }
    }
    expect(failures).toEqual([])
  })
})
