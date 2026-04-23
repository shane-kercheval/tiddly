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

  it('leaves indented list items alone (not at column 0 — treated as nested content)', () => {
    // Regex is anchored to line start and does not allow leading whitespace,
    // so indented bullets are treated as plain text (prefix prepended).
    expect(runToggle('  - nested', BULLET).text).toBe('-   - nested')
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

  it('normalizes a reverse selection (head < anchor) after the change', () => {
    // CodeMirror permits backward selections; pin current behavior.
    // The implementation reads from/to (always min/max) and dispatches
    // anchor=newSelectionStart, head=newSelectionEnd — so the resulting
    // selection ends up forward-oriented. This test documents that so a
    // future change to preserve directionality is caught rather than
    // silently breaking callers that depend on it.
    const result = runToggle('- hello', BULLET, { anchor: 5, head: 0 })
    expect(result.text).toBe('hello')
    expect(result.anchor).toBe(0)
    expect(result.head).toBe(3)
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
