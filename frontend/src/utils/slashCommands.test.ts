import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { CompletionContext } from '@codemirror/autocomplete'
import type { CompletionResult } from '@codemirror/autocomplete'
import { createSlashCommandSource, _testExports } from './slashCommands'

const { buildCommands, isInsideCodeBlock } = _testExports

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a CompletionContext for the given document text and cursor position. */
function makeContext(doc: string, pos: number): CompletionContext {
  const state = EditorState.create({ doc })
  return new CompletionContext(state, pos, false)
}

/** Shorthand: create source and call it with the given doc/pos. Our source is synchronous. */
function querySource(doc: string, pos: number): CompletionResult | null {
  const source = createSlashCommandSource(false)
  return source(makeContext(doc, pos)) as CompletionResult | null
}

// ---------------------------------------------------------------------------
// buildCommands
// ---------------------------------------------------------------------------

describe('buildCommands', () => {
  it('test__buildCommands__returns_10_commands_without_jinja', () => {
    const commands = buildCommands(false)
    expect(commands).toHaveLength(10)
  })

  it('test__buildCommands__returns_13_commands_with_jinja', () => {
    const commands = buildCommands(true)
    expect(commands).toHaveLength(13)
  })

  it('test__buildCommands__has_6_basic_4_advanced_sections', () => {
    const commands = buildCommands(false)
    const basic = commands.filter(
      (c) => typeof c.section === 'object' && 'name' in c.section && c.section.name === 'Basic blocks',
    )
    const advanced = commands.filter(
      (c) => typeof c.section === 'object' && 'name' in c.section && c.section.name === 'Advanced',
    )
    expect(basic).toHaveLength(6)
    expect(advanced).toHaveLength(4)
  })

  it('test__buildCommands__has_3_jinja_commands_when_enabled', () => {
    const commands = buildCommands(true)
    const jinja = commands.filter(
      (c) => typeof c.section === 'object' && 'name' in c.section && c.section.name === 'Jinja2',
    )
    expect(jinja).toHaveLength(3)
  })

  it('test__buildCommands__all_commands_have_detail_and_apply', () => {
    const commands = buildCommands(true)
    for (const cmd of commands) {
      expect(cmd.detail, `${cmd.label} should have detail`).toBeTruthy()
      expect(typeof cmd.apply, `${cmd.label} should have apply function`).toBe('function')
    }
  })

  it('test__buildCommands__section_ranks_are_ascending', () => {
    const commands = buildCommands(true)
    const ranks = commands.map((c) => {
      const section = c.section as { rank: number }
      return section.rank
    })
    for (let i = 1; i < ranks.length; i++) {
      expect(ranks[i], `rank at index ${i} should be >= rank at index ${i - 1}`).toBeGreaterThanOrEqual(
        ranks[i - 1],
      )
    }
  })

  it('test__buildCommands__labels_match_expected_set_without_jinja', () => {
    const commands = buildCommands(false)
    const labels = commands.map((c) => c.label)
    expect(labels).toEqual([
      'Heading 1',
      'Heading 2',
      'Heading 3',
      'Bulleted list',
      'Numbered list',
      'To-do list',
      'Code block',
      'Blockquote',
      'Link',
      'Horizontal rule',
    ])
  })

  it('test__buildCommands__labels_match_expected_set_with_jinja', () => {
    const commands = buildCommands(true)
    const labels = commands.map((c) => c.label)
    expect(labels).toEqual([
      'Variable',
      'If block',
      'If block (trim)',
      'Heading 1',
      'Heading 2',
      'Heading 3',
      'Bulleted list',
      'Numbered list',
      'To-do list',
      'Code block',
      'Blockquote',
      'Link',
      'Horizontal rule',
    ])
  })

  it('test__buildCommands__boost_values_descend_within_each_section', () => {
    const commands = buildCommands(true)
    const sections = ['Basic blocks', 'Advanced', 'Jinja2']
    for (const sectionName of sections) {
      const sectionCommands = commands.filter(
        (c) => typeof c.section === 'object' && 'name' in c.section && c.section.name === sectionName,
      )
      const boosts = sectionCommands.map((c) => c.boost ?? 0)
      for (let i = 1; i < boosts.length; i++) {
        expect(boosts[i], `boost should descend in ${sectionName} at index ${i}`).toBeLessThan(boosts[i - 1])
      }
    }
  })
})

// ---------------------------------------------------------------------------
// createSlashCommandSource — trigger conditions
// ---------------------------------------------------------------------------

describe('createSlashCommandSource', () => {
  describe('triggers correctly', () => {
    it('test__slashSource__triggers_on_slash_at_start_of_empty_line', () => {
      const result = querySource('/', 1)
      expect(result).not.toBeNull()
      expect(result!.options.length).toBeGreaterThan(0)
    })

    it('test__slashSource__triggers_on_slash_at_start_of_first_line', () => {
      const result = querySource('/h', 2)
      expect(result).not.toBeNull()
    })

    it('test__slashSource__triggers_on_slash_after_blank_line', () => {
      const doc = 'some text\n/'
      const result = querySource(doc, doc.length)
      expect(result).not.toBeNull()
    })

    it('test__slashSource__triggers_on_indented_slash', () => {
      const doc = '  /'
      const result = querySource(doc, doc.length)
      expect(result).not.toBeNull()
    })

    it('test__slashSource__triggers_mid_line_after_space', () => {
      const doc = 'some text /'
      const result = querySource(doc, doc.length)
      expect(result).not.toBeNull()
    })

    it('test__slashSource__triggers_mid_line_with_filter_text', () => {
      const doc = 'some text /head'
      const result = querySource(doc, doc.length)
      expect(result).not.toBeNull()
    })

    it('test__slashSource__triggers_after_tab', () => {
      const doc = '\t/'
      const result = querySource(doc, doc.length)
      expect(result).not.toBeNull()
    })
  })

  describe('does not trigger', () => {
    it('test__slashSource__no_trigger_without_slash', () => {
      const result = querySource('hello', 5)
      expect(result).toBeNull()
    })

    it('test__slashSource__no_trigger_on_slash_after_non_space_char', () => {
      const doc = 'word/'
      const result = querySource(doc, doc.length)
      expect(result).toBeNull()
    })

    it('test__slashSource__no_trigger_on_slash_in_url', () => {
      const doc = 'https://example.com/'
      const result = querySource(doc, doc.length)
      expect(result).toBeNull()
    })

    it('test__slashSource__no_trigger_on_slash_after_punctuation', () => {
      const doc = 'end./'
      const result = querySource(doc, doc.length)
      expect(result).toBeNull()
    })

    it('test__slashSource__no_trigger_on_empty_document', () => {
      const result = querySource('', 0)
      expect(result).toBeNull()
    })

    it('test__slashSource__no_trigger_with_non_word_chars_after_slash', () => {
      // e.g. typing `/foo bar` — the space after "foo" breaks the match
      const doc = '/foo '
      const result = querySource(doc, doc.length)
      expect(result).toBeNull()
    })
  })

  describe('from position', () => {
    it('test__slashSource__from_is_after_the_slash_for_filtering', () => {
      const result = querySource('/', 1)
      expect(result).not.toBeNull()
      expect(result!.from).toBe(1) // after the `/`
    })

    it('test__slashSource__from_accounts_for_leading_text', () => {
      const doc = 'text /head'
      const result = querySource(doc, doc.length)
      expect(result).not.toBeNull()
      expect(result!.from).toBe(6) // after the `/` in "text /"
    })

    it('test__slashSource__from_accounts_for_indentation', () => {
      const doc = '  /code'
      const result = querySource(doc, doc.length)
      expect(result).not.toBeNull()
      expect(result!.from).toBe(3) // after the `/` in "  /"
    })
  })
})

// ---------------------------------------------------------------------------
// isInsideCodeBlock
// ---------------------------------------------------------------------------

describe('isInsideCodeBlock', () => {
  it('test__isInsideCodeBlock__false_on_normal_line', () => {
    const ctx = makeContext('hello\n/', 7)
    expect(isInsideCodeBlock(ctx)).toBe(false)
  })

  it('test__isInsideCodeBlock__true_inside_open_fence', () => {
    const doc = '```\nsome code\n/'
    const ctx = makeContext(doc, doc.length)
    expect(isInsideCodeBlock(ctx)).toBe(true)
  })

  it('test__isInsideCodeBlock__false_after_closed_fence', () => {
    const doc = '```\ncode\n```\n/'
    const ctx = makeContext(doc, doc.length)
    expect(isInsideCodeBlock(ctx)).toBe(false)
  })

  it('test__isInsideCodeBlock__true_inside_second_open_fence', () => {
    const doc = '```\ncode\n```\n\n```\ninside again\n/'
    const ctx = makeContext(doc, doc.length)
    expect(isInsideCodeBlock(ctx)).toBe(true)
  })

  it('test__isInsideCodeBlock__false_with_no_fences', () => {
    const doc = 'just text\nmore text\n/'
    const ctx = makeContext(doc, doc.length)
    expect(isInsideCodeBlock(ctx)).toBe(false)
  })

  it('test__isInsideCodeBlock__handles_indented_fences', () => {
    const doc = '  ```\ncode\n/'
    const ctx = makeContext(doc, doc.length)
    expect(isInsideCodeBlock(ctx)).toBe(true)
  })

  it('test__isInsideCodeBlock__handles_fence_with_language', () => {
    const doc = '```python\ncode\n/'
    const ctx = makeContext(doc, doc.length)
    expect(isInsideCodeBlock(ctx)).toBe(true)
  })

  it('test__slashSource__does_not_trigger_inside_code_block', () => {
    const doc = '```\n/'
    const result = querySource(doc, doc.length)
    expect(result).toBeNull()
  })

  it('test__slashSource__triggers_after_closed_code_block', () => {
    const doc = '```\ncode\n```\n/'
    const result = querySource(doc, doc.length)
    expect(result).not.toBeNull()
  })
})
