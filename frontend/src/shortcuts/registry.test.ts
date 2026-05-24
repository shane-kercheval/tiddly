import { describe, it, expect } from 'vitest'
import {
  SHORTCUTS,
  SHORTCUT_IDS,
  getShortcut,
  getShortcutsBySection,
  getAllShortcuts,
  isShortcutId,
  validateShortcutsData,
  type ShortcutId,
} from './registry'

describe('registry selectors', () => {
  it('getShortcut returns the entry by id', () => {
    const entry = getShortcut('app.showShortcuts')
    expect(entry.id).toBe('app.showShortcuts')
    expect(entry.keys).toEqual(['Mod', 'Shift', '/'])
  })

  it('getShortcut throws on unknown id', () => {
    // Unknown ids are programming errors. Type system catches typos at compile
    // time; this is the runtime backstop.
    expect(() => getShortcut('app.nonexistent' as ShortcutId)).toThrow(
      /Unknown shortcut id/,
    )
  })

  it('getShortcutsBySection filters by section AND preserves declaration order', () => {
    // Order is load-bearing: dialog rows render in registry order within each section.
    const navigation = getShortcutsBySection('Navigation')
    expect(navigation.map((s) => s.id)).toEqual([
      'app.focusSearch',
      'app.focusPageSearch',
      'app.commandPalette',
      'app.escape',
      'card.openInNewTab',
      'relationship.openInTiddly',
    ])
  })

  it('getAllShortcuts returns the full registry in declaration order', () => {
    const all = getAllShortcuts()
    expect(all.length).toBe(SHORTCUTS.length)
    expect(all[0].id).toBe(SHORTCUTS[0].id)
  })

  describe('isShortcutId', () => {
    it('returns true for known ids', () => {
      expect(isShortcutId('app.showShortcuts')).toBe(true)
      expect(isShortcutId('editor.bold')).toBe(true)
    })

    it('returns false for unknown ids (narrows string → ShortcutId)', () => {
      expect(isShortcutId('not.a.real.id')).toBe(false)
      expect(isShortcutId('heading-1')).toBe(false) // editorCommands local id
      expect(isShortcutId('save-and-close')).toBe(false) // editorCommands local id
    })
  })
})

describe('display tokens derived from match', () => {
  // `keys` is derived from `match` in registry.ts (no stored display to drift).
  // These exact-output cases lock the derivation rules: modifier-first ordering,
  // letter case (uppercase with a modifier, lowercase when bare to signal
  // "no Shift"), physical-code → symbol, and special key names.
  it.each([
    ['editor.bold', ['Mod', 'B']], // modifier + letter → uppercase
    ['editor.toggleReadingMode', ['Mod', 'Shift', 'M']], // code KeyM → M
    ['editor.toggleWordWrap', ['Alt', 'Z']], // code KeyZ → Z
    ['app.focusPageSearch', ['s']], // bare letter → lowercase
    ['app.toggleWidth', ['w']], // bare letter → lowercase
    ['app.focusSearch', ['/']], // bare punctuation key
    ['app.escape', ['Esc']], // special key name
    ['app.commandPalette', ['Mod', 'Shift', 'P']], // modifier ordering
    ['app.toggleSidebarMaxWidth', ['Mod', 'Alt', '\\']], // code Backslash → \
    ['editor.commandMenu', ['Mod', '/']], // code Slash → /
    ['editor.bulletList', ['Mod', 'Shift', '7']], // digit key
  ])('%s derives to %j', (id, expected) => {
    expect(getShortcut(id as ShortcutId).keys).toEqual(expected)
  })

  it('display-only entries use their explicit display tokens (no matcher)', () => {
    expect(getShortcut('card.openInNewTab').match).toBeUndefined()
    expect(getShortcut('card.openInNewTab').keys).toEqual(['Mod', 'Click'])
    expect(getShortcut('bookmark.pasteUrl').keys).toEqual(['Mod', 'V'])
  })

  it('every entry has modifiers before the non-modifier token', () => {
    for (const shortcut of getAllShortcuts()) {
      const lastModifier = shortcut.keys.reduce(
        (acc, k, i) => (['Mod', 'Alt', 'Shift'].includes(k) ? i : acc),
        -1,
      )
      const modifierCount = shortcut.keys.filter((k) => ['Mod', 'Alt', 'Shift'].includes(k)).length
      expect(lastModifier).toBe(modifierCount - 1)
    }
  })
})

describe('schema invariants', () => {
  it('every entry with `match` set has exactly one of key or code', () => {
    // Backstop for the discriminated union — catches any malformed entry that
    // somehow survives the type check (e.g., an `as ShortcutMatch` cast).
    for (const shortcut of getAllShortcuts()) {
      if (!shortcut.match) continue
      const hasKey = shortcut.match.key !== undefined
      const hasCode = shortcut.match.code !== undefined
      expect(hasKey !== hasCode).toBe(true) // XOR
    }
  })

  it('all shortcut ids are unique', () => {
    // Duplicate ids are caught at module load (registry.ts throws when
    // building SHORTCUTS_BY_ID), but assert here so the contract is testable.
    const ids = SHORTCUTS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('SHORTCUT_IDS stays in sync with shortcuts.json', () => {
    // TypeScript can't derive the ShortcutId union from a runtime JSON import,
    // so SHORTCUT_IDS is hand-maintained. This asserts it matches the data file
    // exactly — add/remove a shortcut in shortcuts.json without updating the
    // union (in registry.ts) and this fails loudly.
    const jsonIds = SHORTCUTS.map((s) => s.id).sort()
    const unionIds = [...SHORTCUT_IDS].sort()
    expect(unionIds).toEqual(jsonIds)
  })
})

describe('validateShortcutsData (load-time validation)', () => {
  const base = { id: 'test.entry', label: 'Test', section: 'View' as const }

  it('accepts a well-formed keyboard entry', () => {
    expect(() => validateShortcutsData([{ ...base, match: { mod: true, key: 'x' } }])).not.toThrow()
  })

  it('rejects a non-array root', () => {
    expect(() => validateShortcutsData({ id: 'x' })).toThrow(/must be an array/)
  })

  it('rejects a typo\'d modifier field on match (excess-property safety)', () => {
    expect(() => validateShortcutsData([{ ...base, match: { shfit: true, key: 'x' } }])).toThrow(
      /unknown field 'shfit'/,
    )
  })

  it('rejects a non-boolean modifier flag (would desync display from dispatch)', () => {
    expect(() => validateShortcutsData([{ ...base, match: { mod: 'true', key: 'x' } }])).toThrow(
      /match\.mod must be a boolean/,
    )
  })

  it('rejects a non-string key', () => {
    expect(() => validateShortcutsData([{ ...base, match: { mod: true, key: 1 } }])).toThrow(
      /match\.key must be a string/,
    )
  })

  it('rejects an entry with neither match nor display', () => {
    expect(() => validateShortcutsData([{ ...base }])).toThrow(/exactly one of 'match' .* or 'display'/)
  })

  it('rejects an entry with both match and display', () => {
    expect(() =>
      validateShortcutsData([{ ...base, match: { key: 'x' }, display: ['Mod', 'X'] }]),
    ).toThrow(/exactly one of 'match' .* or 'display'/)
  })

  it('rejects a non-boolean dispatch flag', () => {
    expect(() =>
      validateShortcutsData([{ ...base, match: { key: 'x' }, allowInInputs: 'yes' }]),
    ).toThrow(/allowInInputs must be a boolean/)
  })

  it('rejects a Mac glyph in a display-only entry', () => {
    expect(() => validateShortcutsData([{ ...base, display: ['⌘', 'V'] }])).toThrow(/Mac glyph/)
  })
})

describe('global-shortcut policy invariants', () => {
  it('Escape uses preventDefault: false to preserve native target behavior', () => {
    // Today's code intentionally lets Escape reach native targets
    // (contenteditable, modal close, form semantics).
    const escape = getShortcut('app.escape')
    expect(escape.preventDefault).toBe(false)
  })

  it('the right ids fire even when typing in inputs', () => {
    // These match today's behavior in useKeyboardShortcuts.ts: Cmd+Shift+/,
    // Cmd+Shift+P, Cmd+\, Cmd+Shift+\, Escape all fire while inputs are focused.
    // Editor formatting shortcuts deliberately don't allowInInputs because they
    // only ever fire from inside the editor, where the editor's own keymap
    // takes over (input-focus check is irrelevant).
    const expected = new Set([
      'app.showShortcuts',
      'app.commandPalette',
      'app.toggleSidebar',
      'app.toggleHistorySidebar',
      'app.toggleSidebarMaxWidth',
      'app.escape',
    ])
    for (const shortcut of getAllShortcuts()) {
      const allow = shortcut.allowInInputs ?? false
      expect(allow).toBe(expected.has(shortcut.id))
    }
  })
})
