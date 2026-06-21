/**
 * End-to-end behavior tests for CodeMirrorEditor's registry-driven keymap
 * and capture-phase listener.
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
import { EditorView, keymap as keymapFacet } from '@codemirror/view'
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

})

describe('CodeMirrorEditor — capture-phase listener (registry-driven)', () => {
  it('Alt+Z fires editor.toggleWordWrap (code-based matching)', () => {
    // Capture-phase entry uses match.code: 'KeyZ' so it matches the physical
    // key regardless of macOS Option-letter conversion (event.key='Ω').
    const onWrapTextChange = vi.fn()
    render(<CodeMirrorEditor value="hello" onChange={vi.fn()} wrapText={false} onWrapTextChange={onWrapTextChange} />)

    document.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'KeyZ', altKey: true, bubbles: true, cancelable: true }),
    )

    expect(onWrapTextChange).toHaveBeenCalledWith(true)
  })

  it('Alt+Z still matches when event.key is the special character (Ω)', () => {
    // Real macOS browsers report event.key='Ω' for Option+Z but event.code='KeyZ'.
    // The capture-phase code-based matcher must match on `code`, not `key`.
    const onWrapTextChange = vi.fn()
    render(<CodeMirrorEditor value="hello" onChange={vi.fn()} wrapText={false} onWrapTextChange={onWrapTextChange} />)

    document.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'KeyZ', key: 'Ω', altKey: true, bubbles: true, cancelable: true }),
    )

    expect(onWrapTextChange).toHaveBeenCalledWith(true)
  })

  it('Alt+L fires editor.toggleLineNumbers handler', () => {
    const onLineNumbersChange = vi.fn()
    render(<CodeMirrorEditor value="hello" onChange={vi.fn()} showLineNumbers={false} onLineNumbersChange={onLineNumbersChange} />)

    document.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'KeyL', altKey: true, bubbles: true, cancelable: true }),
    )

    expect(onLineNumbersChange).toHaveBeenCalledWith(true)
  })

  it('does NOT consume the event when the precondition fails (matcher/handler symmetry)', () => {
    // editor.toggleWordWrap handler short-circuits when onWrapTextChange is
    // undefined. With didHandle=false, the event must bubble — preserving
    // pre-registry behavior. A regression here (always-consume on match)
    // would silently swallow Alt+letter combos on pages where the optional
    // callback isn't passed, blocking native targets and other listeners.
    render(<CodeMirrorEditor value="hello" onChange={vi.fn()} wrapText={false} />)

    const event = new KeyboardEvent('keydown', {
      code: 'KeyZ',
      altKey: true,
      bubbles: true,
      cancelable: true,
    })
    document.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
  })

  it('DOES consume the event when the handler acts', () => {
    // Symmetric to the above: when the handler executes, the event is consumed.
    const onWrapTextChange = vi.fn()
    render(<CodeMirrorEditor value="hello" onChange={vi.fn()} wrapText={false} onWrapTextChange={onWrapTextChange} />)

    const event = new KeyboardEvent('keydown', {
      code: 'KeyZ',
      altKey: true,
      bubbles: true,
      cancelable: true,
    })
    document.dispatchEvent(event)

    expect(onWrapTextChange).toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(true)
  })
})

describe('CodeMirrorEditor — upstream keymap presence (Cmd+D)', () => {
  it('searchKeymap is registered (Mod-d binding present in keymap facet)', () => {
    // The `editor.selectNextOccurrence` registry entry has match omitted —
    // we don't bind it ourselves; @codemirror/search's searchKeymap does.
    // This test asserts the upstream binding is actually wired up. If a
    // future refactor removes the search() call from the extensions list,
    // Mod-d stops working and our registry row becomes a lie — this test
    // catches that.
    const { container } = render(<CodeMirrorEditor value="hello" onChange={vi.fn()} />)
    const contentDOM = container.querySelector('.cm-content') as HTMLElement
    const view = EditorView.findFromDOM(contentDOM)
    expect(view).toBeTruthy()

    const allKeymaps = view!.state.facet(keymapFacet).flat()
    const hasModD = allKeymaps.some((b) => b.key === 'Mod-d')
    expect(hasModD).toBe(true)
  })

  // The tips corpus advertises these upstream editor chords via
  // `{{shortcut:...}}` tokens (CONTENT_EXTRA_SHORTCUTS, plus
  // editor.selectAllOccurrences in the registry). None are bound by our own
  // keymap — they come from @codemirror/search's searchKeymap and
  // @codemirror/commands' defaultKeymap. If basicSetup/search() stops shipping
  // any of them, the matching tip becomes a lie; these assertions catch that.
  it('binds every advertised find/go-to-line chord in the mounted keymap', () => {
    const { container } = render(<CodeMirrorEditor value="hello" onChange={vi.fn()} />)
    const contentDOM = container.querySelector('.cm-content') as HTMLElement
    const view = EditorView.findFromDOM(contentDOM)
    expect(view).toBeTruthy()
    const bindings = view!.state.facet(keymapFacet).flat()
    const hasKey = (key: string): boolean => bindings.some((b) => b.key === key)

    // editor.find / editor.findNext / editor.goToLine / editor.selectAllOccurrences
    expect(hasKey('Mod-f')).toBe(true)
    expect(hasKey('Mod-g')).toBe(true)
    expect(hasKey('Mod-Alt-g')).toBe(true)
    expect(hasKey('Mod-Shift-l')).toBe(true)

    // editor.findPrevious is NOT a standalone key — searchKeymap attaches it as
    // the `shift` handler on the Mod-g binding. Assert that shape directly so a
    // future change that drops shift-findPrevious is caught.
    const modG = bindings.find((b) => b.key === 'Mod-g')
    expect(modG?.shift).toBeTypeOf('function')
  })

  it('binds multi-cursor add-above/below in the mounted keymap', () => {
    // editor.addCursorAboveBelow — defaultKeymap, the one chord that is NOT a
    // @codemirror/search default, so it's the most likely to silently vanish.
    const { container } = render(<CodeMirrorEditor value="a\nb\nc" onChange={vi.fn()} />)
    const contentDOM = container.querySelector('.cm-content') as HTMLElement
    const view = EditorView.findFromDOM(contentDOM)
    expect(view).toBeTruthy()
    const bindings = view!.state.facet(keymapFacet).flat()
    expect(bindings.some((b) => b.key === 'Mod-Alt-ArrowUp')).toBe(true)
    expect(bindings.some((b) => b.key === 'Mod-Alt-ArrowDown')).toBe(true)
  })
})

// Note on the Mod+Shift+/ passthrough integration test:
// We deliberately test this chain at two levels rather than as an
// end-to-end integration test inside CodeMirrorEditor:
//   - `shortcuts/dispatch.test.ts` verifies dispatchRegistryShortcut emits
//     the correct synthetic event (with mocked guards for the throw paths).
//   - `shortcuts/adapters/codemirror.test.ts` verifies the adapter installs
//     the Mod-Shift-/ binding into a real EditorView and it fires.
//
// Two spike investigations confirmed: round-tripping Mod+Shift+/
// through a React-mounted CodeMirrorEditor + basicSetup environment in jsdom
// doesn't reach the keymap binding. Tried: dispatchEvent with key='/',
// key='?' (the real US Shift+/ output), `userEvent.keyboard()` with proper
// modifier syntax. None reached the passthrough handler. Diagnostic confirms
// contentDOM is focused and the event lands on it. Mod+B in the same setup
// fires correctly — the gap is shift-modifier-on-punctuation-specific.
//
// The bare-EditorView adapter test fires the same Mod-Shift-/ binding
// without issue, so this is an environmental limit (jsdom + basicSetup +
// shift-modifier key normalization), not a wire-up bug. Production behavior
// is unchanged from the prior implementation, which used the same
// 'Mod-Shift-/' binding string and works.
