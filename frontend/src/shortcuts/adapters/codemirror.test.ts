import { describe, it, expect, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { toCodeMirrorKeymap, matchToKeyString } from './codemirror'

describe('matchToKeyString — translation table', () => {
  // Each row: human description → match shape → expected CM keymap string.
  const rows: Array<[string, Parameters<typeof matchToKeyString>[0], string]> = [
    ['Mod + lowercase letter', { mod: true, key: 'b' }, 'Mod-b'],
    ['Mod + Shift + letter', { mod: true, shift: true, key: 'x' }, 'Mod-Shift-x'],
    ['Mod + Shift + slash', { mod: true, shift: true, key: '/' }, 'Mod-Shift-/'],
    ['Mod + Shift + digit', { mod: true, shift: true, key: '7' }, 'Mod-Shift-7'],
    ['Mod + backslash (no shift)', { mod: true, key: '\\' }, 'Mod-\\'],
    ['Mod + Shift + backslash', { mod: true, shift: true, key: '\\' }, 'Mod-Shift-\\'],
    ['Mod + Shift + period', { mod: true, shift: true, key: '.' }, 'Mod-Shift-.'],
    ['Alt + Shift + letter', { alt: true, shift: true, key: 'x' }, 'Alt-Shift-x'],
    ['bare Escape', { key: 'Escape' }, 'Escape'],
  ]

  for (const [description, match, expected] of rows) {
    it(description, () => {
      expect(matchToKeyString(match)).toBe(expected)
    })
  }

  // Explicit guard against a naive `parts.join('-')` regression.
  // Two trailing dashes is the correct CM form for a literal-dash key with
  // a Shift modifier (used by the Horizontal Rule binding).
  it("Mod + Shift + literal dash emits 'Mod-Shift--' (two dashes)", () => {
    expect(matchToKeyString({ mod: true, shift: true, key: '-' })).toBe('Mod-Shift--')
  })

  it('throws when match.code is set (capture-phase concern)', () => {
    // The schema's discriminated union forbids both being set; this is the
    // runtime backstop and mirrors toCodeMirrorKeymap's validation.
    expect(() => matchToKeyString({ alt: true, code: 'KeyZ' })).toThrow(
      /capture-phase/,
    )
  })
})

describe('toCodeMirrorKeymap', () => {
  it('builds KeyBindings from registry ids', () => {
    const handler = vi.fn(() => true)
    const bindings = toCodeMirrorKeymap(['app.toggleSidebar'] as const, {
      'app.toggleSidebar': handler,
    })
    expect(bindings).toHaveLength(1)
    expect(bindings[0].key).toBe('Mod-\\')
  })

  // The full "code-only id throws via public API" case will be covered once a
  // capture-phase entry (Alt+Z, Alt+L, etc.) exists in the registry. For now it
  // is covered at the helper level via matchToKeyString throwing on missing key
  // (above).
})

describe('toCodeMirrorKeymap — runtime fires inside EditorView', () => {
  // Hand the emitted KeyBinding to a real EditorView and dispatch a keydown.
  // If the translation is wrong, the handler simply doesn't run.
  //
  // Note: jsdom reports a non-Mac platform, so CodeMirror treats `ctrlKey`
  // (not `metaKey`) as the "Mod" modifier. Tests use ctrlKey accordingly —
  // we're verifying the translation table, not platform detection.

  function mountView(bindings: ReturnType<typeof toCodeMirrorKeymap>): EditorView {
    const state = EditorState.create({
      doc: 'hello',
      extensions: [keymap.of(bindings)],
    })
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    const view = new EditorView({ state, parent })
    view.focus()
    return view
  }

  function dispatchKey(view: EditorView, init: KeyboardEventInit): void {
    const event = new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true })
    view.contentDOM.dispatchEvent(event)
  }

  it('fires Cmd/Ctrl+\\ via the emitted keymap', () => {
    const handler = vi.fn(() => true)
    const bindings = toCodeMirrorKeymap(['app.toggleSidebar'] as const, {
      'app.toggleSidebar': handler,
    })
    const view = mountView(bindings)
    dispatchKey(view, { key: '\\', ctrlKey: true })
    expect(handler).toHaveBeenCalledTimes(1)
    view.destroy()
  })

  it('fires Cmd/Ctrl+Shift+/ via the emitted keymap', () => {
    const handler = vi.fn(() => true)
    const bindings = toCodeMirrorKeymap(['app.showShortcuts'] as const, {
      'app.showShortcuts': handler,
    })
    const view = mountView(bindings)
    dispatchKey(view, { key: '/', ctrlKey: true, shiftKey: true })
    expect(handler).toHaveBeenCalledTimes(1)
    view.destroy()
  })

  it('does not fire on a non-matching key', () => {
    const handler = vi.fn(() => true)
    const bindings = toCodeMirrorKeymap(['app.toggleSidebar'] as const, {
      'app.toggleSidebar': handler,
    })
    const view = mountView(bindings)
    dispatchKey(view, { key: 'b', ctrlKey: true })
    expect(handler).not.toHaveBeenCalled()
    view.destroy()
  })
})
