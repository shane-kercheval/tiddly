/**
 * Tests for editorFormatting utilities.
 *
 * Focus: toggleLinePrefix — the block-level line prefix toggler used by
 * markdown shortcuts (⌘⇧7/8/9/.), the toolbar buttons, and the slash menu.
 *
 * The main correctness property under test is that any block prefix
 * (heading, blockquote, bullet, numbered, checklist) can be toggled off
 * or swapped for any other without leaving residue.
 */
import { describe, it, expect } from 'vitest'
import { EditorState, EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { toggleLinePrefix, LINE_PREFIXES, type BlockLinePrefix } from './editorFormatting'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ToggleResult {
  text: string
  anchor: number
  head: number
}

/**
 * Build an EditorView with the given doc and selection, apply
 * toggleLinePrefix with the target prefix, and return the resulting
 * document text plus selection endpoints.
 *
 * `selection` defaults to the end of the document (a collapsed cursor).
 */
function runToggle(
  doc: string,
  prefix: BlockLinePrefix,
  selection?: { anchor: number; head?: number },
): ToggleResult {
  const anchor = selection?.anchor ?? doc.length
  const head = selection?.head ?? anchor
  const parent = document.createElement('div')
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.single(anchor, head),
    }),
    parent,
  })

  try {
    toggleLinePrefix(view, prefix)
    return {
      text: view.state.doc.toString(),
      anchor: view.state.selection.main.anchor,
      head: view.state.selection.main.head,
    }
  } finally {
    view.destroy()
  }
}

// Shortcuts into the exported constants so test tables stay compact.
// Using the real constants means any future rename drift in CodeMirrorEditor
// or editorCommands is caught here too.
const BULLET = LINE_PREFIXES.bulletList
const NUMBERED = LINE_PREFIXES.numberedList
const CHECKLIST = LINE_PREFIXES.checklist
const BLOCKQUOTE = LINE_PREFIXES.blockquote
const H1 = LINE_PREFIXES.h1
const H2 = LINE_PREFIXES.h2
const H3 = LINE_PREFIXES.h3

// ---------------------------------------------------------------------------
// Toggle off (same prefix) — removes the prefix
// ---------------------------------------------------------------------------

describe('toggleLinePrefix — toggle off (same kind)', () => {
  it('removes bullet prefix when toggling bullet', () => {
    expect(runToggle('- hello', BULLET).text).toBe('hello')
  })

  it('removes numbered prefix when toggling numbered (matching digit)', () => {
    expect(runToggle('1. hello', NUMBERED).text).toBe('hello')
  })

  it('removes numbered prefix regardless of actual number (multi-digit)', () => {
    expect(runToggle('42. hello', NUMBERED).text).toBe('hello')
  })

  it('removes unchecked checklist prefix when toggling checklist', () => {
    expect(runToggle('- [ ] hello', CHECKLIST).text).toBe('hello')
  })

  it('removes CHECKED checklist prefix when toggling checklist', () => {
    expect(runToggle('- [x] done', CHECKLIST).text).toBe('done')
  })

  it('removes CHECKED (uppercase X) checklist prefix when toggling checklist', () => {
    expect(runToggle('- [X] done', CHECKLIST).text).toBe('done')
  })

  it('removes blockquote prefix when toggling blockquote', () => {
    expect(runToggle('> quoted', BLOCKQUOTE).text).toBe('quoted')
  })

  it('removes h1 prefix when toggling h1', () => {
    expect(runToggle('# title', H1).text).toBe('title')
  })

  it('removes h2 prefix when toggling h2', () => {
    expect(runToggle('## sub', H2).text).toBe('sub')
  })

  it('removes h3 prefix when toggling h3', () => {
    expect(runToggle('### sub-sub', H3).text).toBe('sub-sub')
  })
})

// ---------------------------------------------------------------------------
// Add prefix (no existing prefix) — prepends
// ---------------------------------------------------------------------------

describe('toggleLinePrefix — add (no existing prefix)', () => {
  it.each([
    [BULLET, '- hello'],
    [NUMBERED, '1. hello'],
    [CHECKLIST, '- [ ] hello'],
    [BLOCKQUOTE, '> hello'],
    [H1, '# hello'],
    [H2, '## hello'],
    [H3, '### hello'],
  ])('prepends %j to a plain line', (prefix: BlockLinePrefix, expected: string) => {
    expect(runToggle('hello', prefix).text).toBe(expected)
  })

  it('adds a prefix to an empty line', () => {
    expect(runToggle('', BULLET).text).toBe('- ')
  })
})

// ---------------------------------------------------------------------------
// Cross-family swap — the bug KAN-128 is about
// ---------------------------------------------------------------------------

describe('toggleLinePrefix — cross-family swap (KAN-128)', () => {
  // Exact scenarios from the Jira ticket description.
  it('KAN-128: checklist → bullet does not leave `[ ]` residue', () => {
    expect(runToggle('- [ ] My List', BULLET).text).toBe('- My List')
  })

  it('KAN-128: bullet → checklist does not leave duplicate `- `', () => {
    expect(runToggle('- My List', CHECKLIST).text).toBe('- [ ] My List')
  })

  // Full pairwise matrix of block-type swaps. Each entry is:
  //   [startingLine, targetPrefix, expectedLine]
  it.each([
    // bullet → X
    ['- x', NUMBERED, '1. x'],
    ['- x', CHECKLIST, '- [ ] x'],
    ['- x', BLOCKQUOTE, '> x'],
    ['- x', H1, '# x'],
    ['- x', H2, '## x'],
    // numbered → X
    ['1. x', BULLET, '- x'],
    ['1. x', CHECKLIST, '- [ ] x'],
    ['1. x', BLOCKQUOTE, '> x'],
    ['1. x', H1, '# x'],
    ['99. x', BULLET, '- x'],
    ['99. x', CHECKLIST, '- [ ] x'],
    // checklist (unchecked) → X
    ['- [ ] x', BULLET, '- x'],
    ['- [ ] x', NUMBERED, '1. x'],
    ['- [ ] x', BLOCKQUOTE, '> x'],
    ['- [ ] x', H1, '# x'],
    ['- [ ] x', H3, '### x'],
    // checklist (checked) → X — checked state is discarded when converting
    ['- [x] x', BULLET, '- x'],
    ['- [x] x', NUMBERED, '1. x'],
    ['- [x] x', BLOCKQUOTE, '> x'],
    ['- [X] x', BULLET, '- x'],
    // blockquote → X
    ['> x', BULLET, '- x'],
    ['> x', NUMBERED, '1. x'],
    ['> x', CHECKLIST, '- [ ] x'],
    ['> x', H1, '# x'],
    ['> x', H2, '## x'],
    // heading → X
    ['# x', BULLET, '- x'],
    ['# x', NUMBERED, '1. x'],
    ['# x', CHECKLIST, '- [ ] x'],
    ['# x', BLOCKQUOTE, '> x'],
    ['## x', BULLET, '- x'],
    ['### x', CHECKLIST, '- [ ] x'],
    // h4-h6 are not exposed as *targets* but must still be *detected* on
    // existing content so that hand-typed deep headings swap cleanly.
    ['#### x', BULLET, '- x'],
    ['##### x', BULLET, '- x'],
    ['###### x', BULLET, '- x'],
    ['#### x', H1, '# x'],
    ['##### x', H2, '## x'],
    ['###### x', CHECKLIST, '- [ ] x'],
  ])('swaps %j with target %j → %j', (input: string, prefix: BlockLinePrefix, expected: string) => {
    expect(runToggle(input, prefix).text).toBe(expected)
  })
})

// ---------------------------------------------------------------------------
// Intra-family swap — heading level changes
// ---------------------------------------------------------------------------

describe('toggleLinePrefix — heading level swap', () => {
  it.each([
    ['# x', H2, '## x'],
    ['# x', H3, '### x'],
    ['## x', H1, '# x'],
    ['## x', H3, '### x'],
    ['### x', H1, '# x'],
    ['### x', H2, '## x'],
  ])('swaps heading %j → %j (%j)', (input: string, prefix: BlockLinePrefix, expected: string) => {
    expect(runToggle(input, prefix).text).toBe(expected)
  })
})

// ---------------------------------------------------------------------------
// Multi-line selection
// ---------------------------------------------------------------------------

describe('toggleLinePrefix — multi-line selection', () => {
  it('adds the prefix to every line when none are prefixed', () => {
    const doc = 'alpha\nbeta\ngamma'
    const result = runToggle(doc, BULLET, { anchor: 0, head: doc.length })
    expect(result.text).toBe('- alpha\n- beta\n- gamma')
  })

  it('toggles off on every line when all are already that prefix', () => {
    const doc = '- alpha\n- beta\n- gamma'
    const result = runToggle(doc, BULLET, { anchor: 0, head: doc.length })
    expect(result.text).toBe('alpha\nbeta\ngamma')
  })

  it('swaps mixed block types all to the target (checklist)', () => {
    // Three different block types — all should become checklist items.
    const doc = '- alpha\n1. beta\n> gamma'
    const result = runToggle(doc, CHECKLIST, { anchor: 0, head: doc.length })
    expect(result.text).toBe('- [ ] alpha\n- [ ] beta\n- [ ] gamma')
  })

  it('per-line independence: lines already on target toggle off, others get added', () => {
    // Middle line is already a bullet; outer lines are plain text.
    // Per-line toggle semantics preserved from the original implementation.
    const doc = 'alpha\n- beta\ngamma'
    const result = runToggle(doc, BULLET, { anchor: 0, head: doc.length })
    expect(result.text).toBe('- alpha\nbeta\n- gamma')
  })

  it('adds prefix to blank lines included in the selection (preserves prior behavior)', () => {
    const doc = 'alpha\n\nbeta'
    const result = runToggle(doc, BULLET, { anchor: 0, head: doc.length })
    expect(result.text).toBe('- alpha\n- \n- beta')
  })

  it('handles 6-line heterogeneous selection in a single transaction', () => {
    const doc = [
      '# title',      // h1 → becomes h2
      '## sub',       // h2 → toggles off
      '### deeper',   // h3 → becomes h2
      '- bullet',     // bullet → becomes h2
      '- [ ] task',   // checklist → becomes h2
      '1. numbered',  // numbered → becomes h2
    ].join('\n')
    const result = runToggle(doc, H2, { anchor: 0, head: doc.length })
    expect(result.text).toBe(
      ['## title', 'sub', '## deeper', '## bullet', '## task', '## numbered'].join('\n'),
    )
  })
})

// ---------------------------------------------------------------------------
// Inline formatting preserved
// ---------------------------------------------------------------------------

describe('toggleLinePrefix — inline formatting is untouched', () => {
  it('preserves bold inside content when toggling bullet on', () => {
    expect(runToggle('hello **bold** text', BULLET).text).toBe('- hello **bold** text')
  })

  it('preserves bold when swapping list types', () => {
    expect(runToggle('- hello **bold** text', CHECKLIST).text).toBe('- [ ] hello **bold** text')
  })

  it('preserves links when swapping blockquote → bullet', () => {
    expect(runToggle('> see [docs](https://x.com/a)', BULLET).text).toBe(
      '- see [docs](https://x.com/a)',
    )
  })

  it('does not misinterpret leading `**` as a list marker', () => {
    // Line begins with bold. Regex should NOT match anything; bullet should
    // be prepended cleanly, leaving the bold intact.
    expect(runToggle('**bold** at start', BULLET).text).toBe('- **bold** at start')
  })

})

// ---------------------------------------------------------------------------
// Edge cases on the line content itself
// ---------------------------------------------------------------------------

describe('toggleLinePrefix — line-content edge cases', () => {
  it('toggles off a prefix-only line (no content after the prefix)', () => {
    expect(runToggle('- ', BULLET).text).toBe('')
  })

  it('swaps a prefix-only line to a different type', () => {
    expect(runToggle('- ', CHECKLIST).text).toBe('- [ ] ')
  })

  it('leaves numbered-looking text that lacks the trailing space untouched', () => {
    // `1.foo` (no space) is not a numbered list item in CommonMark; our
    // regex requires the trailing space, so bullet is simply prepended.
    expect(runToggle('1.foo', BULLET).text).toBe('- 1.foo')
  })

  it('leaves h7 (7 hashes) alone — not a valid heading, treated as content', () => {
    expect(runToggle('####### x', BULLET).text).toBe('- ####### x')
  })

  it('treats h6 as the deepest valid heading', () => {
    expect(runToggle('###### x', BULLET).text).toBe('- x')
  })
})

// ---------------------------------------------------------------------------
// Selection / cursor adjustment
// ---------------------------------------------------------------------------

describe('toggleLinePrefix — selection adjustment', () => {
  it('shifts cursor forward by prefix length when prepending', () => {
    // Cursor at position 3 in "hello" (between l and l).
    const result = runToggle('hello', BULLET, { anchor: 3 })
    expect(result.text).toBe('- hello')
    expect(result.anchor).toBe(5) // 3 + 2 (delta)
  })

  it('shifts cursor back by prefix length when toggling off', () => {
    // Cursor at position 5 in "- hello" (between e and l).
    const result = runToggle('- hello', BULLET, { anchor: 5 })
    expect(result.text).toBe('hello')
    expect(result.anchor).toBe(3) // 5 - 2 (delta)
  })

  it('adjusts cursor correctly on a swap that shortens the prefix', () => {
    // Cursor after "h" in "- [ ] hello" (position 7).
    // Swap checklist (6) → bullet (2), delta = -4.
    const result = runToggle('- [ ] hello', BULLET, { anchor: 7 })
    expect(result.text).toBe('- hello')
    expect(result.anchor).toBe(3)
  })

  it('adjusts cursor correctly on a swap that lengthens the prefix', () => {
    // Cursor after "h" in "- hello" (position 3).
    // Swap bullet (2) → checklist (6), delta = +4.
    const result = runToggle('- hello', CHECKLIST, { anchor: 3 })
    expect(result.text).toBe('- [ ] hello')
    expect(result.anchor).toBe(7)
  })

  it('preserves a range selection across the swap (shortening)', () => {
    // Select "hello" in "- [ ] hello" (positions 6..11).
    const result = runToggle('- [ ] hello', BULLET, { anchor: 6, head: 11 })
    expect(result.text).toBe('- hello')
    expect(result.anchor).toBe(2)
    expect(result.head).toBe(7)
  })

  it('preserves a multi-line range selection across heterogeneous swaps', () => {
    // Select everything: `# title\n- bullet` → `- title\n- bullet` via BULLET toggle.
    const doc = '# title\n- bullet'
    const result = runToggle(doc, BULLET, { anchor: 0, head: doc.length })
    expect(result.text).toBe('- title\nbullet')
    // Selection should still cover the entire resulting text.
    expect(result.anchor).toBe(0)
    expect(result.head).toBe(result.text.length)
  })

  it('clamps a negative selection start to 0 when toggling off at line start', () => {
    // Cursor at position 0 of "- hello" — there is no content before `- `.
    const result = runToggle('- hello', BULLET, { anchor: 0 })
    expect(result.text).toBe('hello')
    expect(result.anchor).toBe(0)
  })

  it('clamps head to 0 when the entire selection lies inside the deleted prefix', () => {
    // Range covers characters 2..4 of "- [ ] hello" — entirely inside the
    // checklist prefix that gets removed. Both anchor and head underflow and
    // must be clamped (this exercises Math.max(0, newSelectionEnd)).
    const result = runToggle('- [ ] hello', CHECKLIST, { anchor: 2, head: 4 })
    expect(result.text).toBe('hello')
    expect(result.anchor).toBe(0)
    expect(result.head).toBe(0)
  })

  it('preserves anchor/head across a 2-line selection that starts mid-document', () => {
    // Doc has three bullet lines. Selection starts on line 2 and ends on
    // line 3; line 1 is untouched because the loop only visits lines in
    // [startLine, endLine]. This exercises the asymmetric invariant:
    // only the start line adjusts the anchor; every line in the loop
    // adjusts the head.
    const doc = '- alpha\n- beta\n- gamma'
    // anchor at the "b" in "beta" (position 10), head at the "g" in "gamma"
    // (position 17).
    const result = runToggle(doc, BULLET, { anchor: 10, head: 17 })
    // Line 1 is preserved; lines 2 and 3 lose their `- ` prefix.
    expect(result.text).toBe('- alpha\nbeta\ngamma')
    // "beta" now starts at position 8; anchor should land on its "b".
    expect(result.anchor).toBe(8)
    // "gamma" now starts at position 13; head should land on its "g".
    expect(result.head).toBe(13)
  })

  it('preserves a reverse selection (head < anchor) across the change', () => {
    // CodeMirror permits backward selections. The toggle dispatches the
    // changes without an explicit selection, letting CodeMirror map the
    // current selection through them — which preserves direction. So an
    // anchor=5, head=0 selection over `- hello` ends up anchor=3, head=0
    // (still backward) after the `- ` is removed.
    const result = runToggle('- hello', BULLET, { anchor: 5, head: 0 })
    expect(result.text).toBe('hello')
    expect(result.anchor).toBe(3)
    expect(result.head).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Nested constructs
// ---------------------------------------------------------------------------

describe('toggleLinePrefix — nested blockquote', () => {
  it('removes only the outer blockquote marker from `> > x`', () => {
    // Only the outermost `> ` matches BLOCK_PREFIX_RE, so toggling
    // blockquote off strips one level of nesting, not both.
    expect(runToggle('> > x', BLOCKQUOTE).text).toBe('> x')
  })

  it('swapping `> > x` to bullet replaces the outer marker only', () => {
    expect(runToggle('> > x', BULLET).text).toBe('- > x')
  })
})

// ---------------------------------------------------------------------------
// Indent handling (KAN-128)
//
// Sub-bullets and any other indented prefixes must be detected and toggled
// the same way as their column-0 equivalents, with leading whitespace
// preserved across swap and toggle-off.
// ---------------------------------------------------------------------------

describe('toggleLinePrefix — indent: toggle on (no existing prefix)', () => {
  it.each([
    [BULLET, '  - hello'],
    [NUMBERED, '  1. hello'],
    [CHECKLIST, '  - [ ] hello'],
    [BLOCKQUOTE, '  > hello'],
    [H1, '  # hello'],
    [H2, '  ## hello'],
    [H3, '  ### hello'],
  ])('inserts %j after a 2-space indent', (prefix: BlockLinePrefix, expected: string) => {
    expect(runToggle('  hello', prefix).text).toBe(expected)
  })

  it('preserves a 4-space indent', () => {
    expect(runToggle('    hello', BULLET).text).toBe('    - hello')
  })

  it('preserves a 1-space indent (unusual but legal)', () => {
    expect(runToggle(' hello', BULLET).text).toBe(' - hello')
  })

  it('preserves a deep 8-space indent', () => {
    expect(runToggle('        hello', CHECKLIST).text).toBe('        - [ ] hello')
  })

  it('preserves a tab indent', () => {
    expect(runToggle('\thello', BULLET).text).toBe('\t- hello')
  })

  it('preserves a mixed tab+space indent', () => {
    expect(runToggle('\t  hello', CHECKLIST).text).toBe('\t  - [ ] hello')
  })
})

describe('toggleLinePrefix — indent: toggle off (same kind preserves indent)', () => {
  it.each([
    ['  - foo', BULLET, '  foo'],
    ['  - [ ] foo', CHECKLIST, '  foo'],
    ['  - [x] foo', CHECKLIST, '  foo'],
    ['  - [X] foo', CHECKLIST, '  foo'],
    ['  1. foo', NUMBERED, '  foo'],
    ['  2. foo', NUMBERED, '  foo'],
    ['  42. foo', NUMBERED, '  foo'],
    ['  > foo', BLOCKQUOTE, '  foo'],
    ['  # foo', H1, '  foo'],
    ['  ## foo', H2, '  foo'],
    ['  ### foo', H3, '  foo'],
  ])('toggles %j off with %j → %j', (input: string, prefix: BlockLinePrefix, expected: string) => {
    expect(runToggle(input, prefix).text).toBe(expected)
  })

  it('preserves a tab indent on toggle off', () => {
    expect(runToggle('\t- foo', BULLET).text).toBe('\tfoo')
  })

  it('preserves a deep 6-space indent on toggle off', () => {
    expect(runToggle('      - [ ] foo', CHECKLIST).text).toBe('      foo')
  })
})

describe('toggleLinePrefix — indent: cross-family swap (KAN-128 ticket scenarios)', () => {
  // Exact scenarios from the reopened ticket comment: indented sub-bullets
  // must swap cleanly, not duplicate.
  it('KAN-128: indented checklist → bullet drops `[ ]` and keeps indent', () => {
    expect(runToggle('  - [ ] My List', BULLET).text).toBe('  - My List')
  })

  it('KAN-128: indented bullet → checklist does not duplicate `- ` and keeps indent', () => {
    expect(runToggle('  - My List', CHECKLIST).text).toBe('  - [ ] My List')
  })

  it('KAN-128: indented numbered → bullet keeps indent', () => {
    expect(runToggle('  1. My List', BULLET).text).toBe('  - My List')
  })

  // Full pairwise matrix at 2-space indent.
  it.each([
    ['  - x', NUMBERED, '  1. x'],
    ['  - x', CHECKLIST, '  - [ ] x'],
    ['  - x', BLOCKQUOTE, '  > x'],
    ['  - x', H1, '  # x'],
    ['  - x', H2, '  ## x'],
    ['  1. x', BULLET, '  - x'],
    ['  1. x', CHECKLIST, '  - [ ] x'],
    ['  1. x', BLOCKQUOTE, '  > x'],
    ['  - [ ] x', BULLET, '  - x'],
    ['  - [ ] x', NUMBERED, '  1. x'],
    ['  - [ ] x', BLOCKQUOTE, '  > x'],
    ['  - [ ] x', H1, '  # x'],
    ['  - [x] x', BULLET, '  - x'],
    ['  > x', BULLET, '  - x'],
    ['  > x', NUMBERED, '  1. x'],
    ['  > x', CHECKLIST, '  - [ ] x'],
    ['  # x', BULLET, '  - x'],
    ['  # x', H2, '  ## x'],
    ['  ### x', H1, '  # x'],
    ['  ###### x', BULLET, '  - x'],
  ])('swaps %j with target %j → %j', (input: string, prefix: BlockLinePrefix, expected: string) => {
    expect(runToggle(input, prefix).text).toBe(expected)
  })

  it('preserves a tab indent across a swap', () => {
    expect(runToggle('\t- foo', CHECKLIST).text).toBe('\t- [ ] foo')
  })
})

describe('toggleLinePrefix — indent: negative cases (regex must NOT detect)', () => {
  // Patterns that look list-ish but lack the required separator/character —
  // the prefix group must fail to match, so we add (not swap) and the
  // existing content stays intact behind the indent.
  it('does not treat `  1.foo` (no space) as numbered — adds bullet', () => {
    expect(runToggle('  1.foo', BULLET).text).toBe('  - 1.foo')
  })

  it('does not treat `  -foo` (no space) as bullet — adds bullet', () => {
    expect(runToggle('  -foo', BULLET).text).toBe('  - -foo')
  })

  it('does not treat 7 hashes as a heading — adds bullet', () => {
    expect(runToggle('  ####### foo', BULLET).text).toBe('  - ####### foo')
  })

  it('does not misinterpret leading `**` as a list marker', () => {
    expect(runToggle('  **bold** at start', BULLET).text).toBe('  - **bold** at start')
  })

  it('does not match a heading with no trailing space (`  #foo`)', () => {
    expect(runToggle('  #foo', BULLET).text).toBe('  - #foo')
  })
})

describe('toggleLinePrefix — indent: line-content edge cases', () => {
  it('preserves indent when toggling off a prefix-only indented line', () => {
    expect(runToggle('  - ', BULLET).text).toBe('  ')
  })

  it('preserves indent when swapping a prefix-only indented line', () => {
    expect(runToggle('  - ', CHECKLIST).text).toBe('  - [ ] ')
  })

  it('inserts the prefix after the indent on a whitespace-only line', () => {
    // Line is just three spaces — there is no content but indent is kept.
    expect(runToggle('   ', BULLET).text).toBe('   - ')
  })

  it('treats `  ###### x` (h6) as a valid heading and toggles to bullet', () => {
    expect(runToggle('  ###### x', BULLET).text).toBe('  - x')
  })
})

describe('toggleLinePrefix — indent: selection adjustment', () => {
  it('shifts cursor forward by prefix length when adding behind an indent', () => {
    // `  hello` (length 7); cursor at position 5 (between 'l' and 'l').
    // Inserting `- ` at position 2 shifts cursor by +2 → position 7.
    const result = runToggle('  hello', BULLET, { anchor: 5 })
    expect(result.text).toBe('  - hello')
    expect(result.anchor).toBe(7)
  })

  it('shifts cursor back by prefix length when toggling off with indent', () => {
    // `  - hello` (length 9); cursor at position 7 (between 'e' and 'l').
    // Removing `- ` at position 2 shifts cursor by -2 → position 5.
    const result = runToggle('  - hello', BULLET, { anchor: 7 })
    expect(result.text).toBe('  hello')
    expect(result.anchor).toBe(5)
  })

  it('snaps cursor to the start of the deletion when it lands inside the deleted prefix', () => {
    // Cursor at position 3 (inside `- `) of `  - hello`. The prefix is
    // deleted; CodeMirror maps the cursor to the start of the deletion,
    // which is also the start of the post-indent content in the new doc.
    const result = runToggle('  - hello', BULLET, { anchor: 3 })
    expect(result.text).toBe('  hello')
    expect(result.anchor).toBe(2)
  })

  it('adjusts cursor on indented swap that shortens the prefix', () => {
    // Cursor after 'h' in `  - [ ] hello` (position 9). Swap checklist→bullet,
    // delta = -4 → anchor = 5.
    const result = runToggle('  - [ ] hello', BULLET, { anchor: 9 })
    expect(result.text).toBe('  - hello')
    expect(result.anchor).toBe(5)
  })

  it('adjusts cursor on indented swap that lengthens the prefix', () => {
    // Cursor after 'h' in `  - hello` (position 5). Swap bullet→checklist,
    // delta = +4 → anchor = 9.
    const result = runToggle('  - hello', CHECKLIST, { anchor: 5 })
    expect(result.text).toBe('  - [ ] hello')
    expect(result.anchor).toBe(9)
  })

  it('preserves a range selection across the indented swap', () => {
    // Select 'hello' in `  - [ ] hello` (positions 8..13).
    const result = runToggle('  - [ ] hello', BULLET, { anchor: 8, head: 13 })
    expect(result.text).toBe('  - hello')
    expect(result.anchor).toBe(4)
    expect(result.head).toBe(9)
  })
})

// ---------------------------------------------------------------------------
// Cursor-at-line-start regression: toggle off must not pull the cursor
// onto the previous line.
//
// The previous implementation naively applied `delta` to every selection
// endpoint, which underflowed when the cursor sat at column 0 of a list
// line (or at the indent boundary just before the prefix). The cursor
// would land on the previous line, ~prefix-width characters in.
// ---------------------------------------------------------------------------

describe('toggleLinePrefix — cursor at line start (regression)', () => {
  it('keeps the cursor on its own line when toggling off at column 0 of a bullet line', () => {
    // Doc: `ABCD\n- text` (line 2 starts at position 5). Cursor at line.from
    // of line 2 — i.e., the very start of `- text`.
    const result = runToggle('ABCD\n- text', BULLET, { anchor: 5 })
    expect(result.text).toBe('ABCD\ntext')
    // Cursor must stay at position 5 (start of `text`), NOT jump back to
    // position 3 (`ABC|D`) on the previous line.
    expect(result.anchor).toBe(5)
  })

  it('keeps the cursor on its own line when toggling off at the indent of a sub-bullet', () => {
    // Doc: `ABCD\n    - text`. Cursor at line.from of line 2 (just after the
    // newline, before the indent).
    const result = runToggle('ABCD\n    - text', BULLET, { anchor: 5 })
    expect(result.text).toBe('ABCD\n    text')
    expect(result.anchor).toBe(5)
  })

  it('keeps the cursor at the indent boundary when toggling off a sub-bullet from prefixStart', () => {
    // Doc: `ABCD\n    - text`. Cursor at position 9 (`    |- text`), the
    // boundary between the indent and the `- ` prefix.
    const result = runToggle('ABCD\n    - text', BULLET, { anchor: 9 })
    expect(result.text).toBe('ABCD\n    text')
    // After `- ` is deleted at positions 9-11, the cursor at position 9
    // sits at the boundary and stays at 9 (start of `text` in the new doc).
    expect(result.anchor).toBe(9)
  })

  it('keeps the cursor on its own line when toggling off at column 0 of a checklist line', () => {
    const result = runToggle('ABCD\n- [ ] task', CHECKLIST, { anchor: 5 })
    expect(result.text).toBe('ABCD\ntask')
    expect(result.anchor).toBe(5)
  })

  it('keeps the cursor on its own line when toggling off at column 0 of a numbered line', () => {
    const result = runToggle('ABCD\n1. item', NUMBERED, { anchor: 5 })
    expect(result.text).toBe('ABCD\nitem')
    expect(result.anchor).toBe(5)
  })

  it('keeps the cursor on its own line when toggling off at column 0 of an indented checklist', () => {
    const result = runToggle('ABCD\n  - [ ] task', CHECKLIST, { anchor: 5 })
    expect(result.text).toBe('ABCD\n  task')
    expect(result.anchor).toBe(5)
  })

  it('does not pull the cursor up across a blank line', () => {
    // Cursor at column 0 of line 3 (a bullet line); line 2 is blank.
    const doc = 'ABCD\n\n- text'
    // Line 3 starts at position 6.
    const result = runToggle(doc, BULLET, { anchor: 6 })
    expect(result.text).toBe('ABCD\n\ntext')
    expect(result.anchor).toBe(6)
  })
})

// ---------------------------------------------------------------------------
// Cursor at insertion boundary on toggle-on: the cursor follows the inserted
// prefix so the user can keep typing in the content position. Selection is
// mapped with assoc=1, so a cursor sitting exactly at the insertion point
// ends up after the new marker rather than before it.
// ---------------------------------------------------------------------------

describe('toggleLinePrefix — cursor at insertion boundary (toggle-on)', () => {
  it('cursor at column 0 follows the inserted bullet marker', () => {
    // Cursor at position 0 of `hello`. Insert `- ` at 0. With assoc=1 the
    // cursor maps to position 2, leaving the user at `- |hello`.
    const result = runToggle('hello', BULLET, { anchor: 0 })
    expect(result.text).toBe('- hello')
    expect(result.anchor).toBe(2)
  })

  it('cursor at the indent boundary follows the inserted bullet marker', () => {
    // `  hello`, cursor at position 2 (between the indent and the content).
    // Insert `- ` at position 2. With assoc=1 the cursor maps to 4.
    const result = runToggle('  hello', BULLET, { anchor: 2 })
    expect(result.text).toBe('  - hello')
    expect(result.anchor).toBe(4)
  })

  it('cursor before the indent stays before the indent on toggle-on', () => {
    // assoc only affects positions exactly at the change point; a cursor at
    // column 0 (before a 2-space indent) is strictly less than the insertion
    // point at position 2, so it stays put.
    const result = runToggle('  hello', BULLET, { anchor: 0 })
    expect(result.text).toBe('  - hello')
    expect(result.anchor).toBe(0)
  })

  it('cursor at column 0 follows the inserted checklist marker', () => {
    const result = runToggle('hello', CHECKLIST, { anchor: 0 })
    expect(result.text).toBe('- [ ] hello')
    expect(result.anchor).toBe(6)
  })

  it('toggle-off behavior at boundary is unaffected by assoc=1', () => {
    // Sanity check: at a pure-delete boundary both assocs collapse to `from`,
    // so the column-0 toggle-off regression test still holds with assoc=1.
    const result = runToggle('ABCD\n- text', BULLET, { anchor: 5 })
    expect(result.text).toBe('ABCD\ntext')
    expect(result.anchor).toBe(5)
  })
})

// ---------------------------------------------------------------------------
// Intentional design choice: this command is line-based, not Markdown-AST-
// aware. CodeMirror is the source view, so toolbar/shortcut commands operate
// on whatever line the cursor sits on. A 4-space indented `- literal` (which
// CommonMark would parse as code-block content) is still treated as an
// indented bullet here — that's the right call for a source editor where
// the user explicitly invoked a list-toggle command.
// ---------------------------------------------------------------------------

describe('toggleLinePrefix — line-based semantics (not Markdown-AST aware)', () => {
  it('toggles a 4-space indented `- literal` as an indented bullet (not as code)', () => {
    // In rendered Markdown a 4-space indent could mean a code block. We
    // intentionally do not consult the parsed syntax tree — line-based
    // toggling is the contract. If this assumption changes, this test is
    // the canary.
    expect(runToggle('    - literal', BULLET).text).toBe('    literal')
  })
})

describe('toggleLinePrefix — indent: multi-line selection with heterogeneous indents', () => {
  it('toggles a mix of unindented and indented lines independently', () => {
    // Three lines: column-0 bullet, 2-space indented bullet, 4-space indented bullet.
    // All are bullet-kind, so toggling bullet should remove the prefix on each
    // while preserving each line's own indent.
    const doc = '- a\n  - b\n    - c'
    const result = runToggle(doc, BULLET, { anchor: 0, head: doc.length })
    expect(result.text).toBe('a\n  b\n    c')
  })

  it('swaps a heterogeneous mix to checklist while preserving each indent', () => {
    const doc = '- a\n  1. b\n    > c'
    const result = runToggle(doc, CHECKLIST, { anchor: 0, head: doc.length })
    expect(result.text).toBe('- [ ] a\n  - [ ] b\n    - [ ] c')
  })

  it('accumulates selection-end delta correctly across heterogeneous indents', () => {
    // Doc: `- a\n  - b` → select all → toggle bullet off.
    // Line 1 delta = -2 (removes `- `). Line 2 delta = -2 (removes `- ` after indent).
    // Resulting text: `a\n  b` (length 5). Head should land at end (5).
    const doc = '- a\n  - b'
    const result = runToggle(doc, BULLET, { anchor: 0, head: doc.length })
    expect(result.text).toBe('a\n  b')
    expect(result.anchor).toBe(0)
    expect(result.head).toBe(5)
  })
})
