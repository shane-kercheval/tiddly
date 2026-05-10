/**
 * End-to-end behavior tests for CodeMirrorEditor's registry-driven keymap.
 *
 * Verifies the wire-up between the registry, the CodeMirror adapter, and the
 * editor: a keypress reaches the right handler and the editor's content
 * updates accordingly.
 *
 * Toolbar tooltip text is verified at the helper level (`shortcuts/format.test.ts`)
 * since the Tooltip component is portal-rendered and only appears on hover —
 * jsdom's `canHover()` returns false, so the rendered tooltip is never in the
 * DOM during tests.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { CodeMirrorEditor } from './CodeMirrorEditor'

afterEach(() => {
  vi.restoreAllMocks()
})

function mountEditor(initialValue: string): {
  contentDOM: HTMLElement
  onChange: ReturnType<typeof vi.fn>
} {
  const onChange = vi.fn()
  const { container } = render(<CodeMirrorEditor value={initialValue} onChange={onChange} />)
  const contentDOM = container.querySelector('.cm-content') as HTMLElement
  expect(contentDOM).toBeTruthy()
  contentDOM.focus()
  return { contentDOM, onChange }
}

describe('CodeMirrorEditor — registry-driven keymap fires', () => {
  // jsdom reports a non-Mac platform, so CodeMirror's "Mod" maps to ctrlKey.
  // The translation table is verified independently in
  // `shortcuts/adapters/codemirror.test.ts`; here we just need the wire-up
  // to fire something through.

  it('Mod+B inserts bold markers via editor.bold handler', () => {
    const { contentDOM, onChange } = mountEditor('hello')

    contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true, cancelable: true }),
    )

    expect(onChange).toHaveBeenCalled()
    const updatedValues = onChange.mock.calls.map((c) => c[0] as string)
    expect(updatedValues.some((v) => v.includes('**'))).toBe(true)
  })

  it('Mod+I inserts italic markers via editor.italic handler', () => {
    const { contentDOM, onChange } = mountEditor('hello')

    contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'i', ctrlKey: true, bubbles: true, cancelable: true }),
    )

    expect(onChange).toHaveBeenCalled()
    const updatedValues = onChange.mock.calls.map((c) => c[0] as string)
    expect(updatedValues.some((v) => /\*[^*]*\*/.test(v))).toBe(true)
  })

  it('Mod+Shift+. (blockquote) fires the editor.blockquote handler', () => {
    // Spot-checks the Shift-modifier path at the consumer level. We pick a
    // punctuation key that has no non-shift sibling binding in CM_KEYMAP_IDS,
    // so the test isn't ambiguous about which binding fired (vs. picking,
    // say, Mod+Shift+E where CM's shift-fall-through logic in jsdom can drop
    // the Shift modifier and match Mod-e / inlineCode instead).
    const { contentDOM, onChange } = mountEditor('hello')

    contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: '.',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    )

    expect(onChange).toHaveBeenCalled()
    const updatedValues = onChange.mock.calls.map((c) => c[0] as string)
    // toggleLinePrefix for blockquote inserts '> ' at line start.
    expect(updatedValues.some((v) => v.startsWith('> '))).toBe(true)
  })

  // Note on the Mod+Shift+/ passthrough integration test:
  // We deliberately test this chain at two levels rather than as an
  // end-to-end integration test inside CodeMirrorEditor:
  //   - `shortcuts/dispatch.test.ts` verifies dispatchRegistryShortcut emits
  //     the correct synthetic event (with mocked guards for the throw paths).
  //   - `shortcuts/adapters/codemirror.test.ts` verifies the adapter installs
  //     the Mod-Shift-/ binding into a real EditorView and it fires.
  //
  // A 30-min spike investigation found that round-tripping Mod+Shift+/ through
  // a React-mounted CodeMirrorEditor + basicSetup environment in jsdom doesn't
  // reach the keymap binding (it does reach Mod-b — that test passes). The
  // bare-EditorView adapter test fires the same binding without issue, so the
  // gap is environmental (jsdom + basicSetup + how synthetic Shift+punctuation
  // events normalize), not a wire-up bug. Production behavior is unchanged
  // from the prior implementation, which used the same 'Mod-Shift-/' binding
  // string.
})
