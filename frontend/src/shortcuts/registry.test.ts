import { describe, it, expect } from 'vitest'
import {
  SHORTCUTS,
  SECTION_LAYOUT,
  getShortcut,
  getShortcutsBySection,
  getAllShortcuts,
  type ShortcutId,
} from './registry'

describe('registry selectors', () => {
  it('getShortcut returns the entry by id', () => {
    const entry = getShortcut('app.showShortcuts')
    expect(entry.id).toBe('app.showShortcuts')
    expect(entry.keys).toEqual(['⌘', '⇧', '/'])
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
})

describe('keys ↔ match coherence', () => {
  // Codes for non-letter punctuation displayed as a glyph in `keys`.
  const CODE_TO_DISPLAY: Record<string, string> = {
    Slash: '/',
    Backslash: '\\',
    Minus: '-',
    Period: '.',
    Comma: ',',
    Equal: '=',
    Quote: "'",
    Semicolon: ';',
  }

  // Iterate via the widening selector so `match` types as `ShortcutMatch | undefined`
  // (SHORTCUTS itself has narrow literal types from `as const satisfies`).
  for (const shortcut of getAllShortcuts()) {
    if (!shortcut.match) continue
    const match = shortcut.match // narrow to ShortcutMatch for closure capture

    it(`'${shortcut.id}' display tokens align with match shape`, () => {
      const { keys } = shortcut

      // Modifier presence in keys must match the match flags.
      expect(keys.includes('⌘')).toBe(match.mod === true)
      expect(keys.includes('⇧')).toBe(match.shift === true)
      expect(keys.includes('⌥')).toBe(match.alt === true)

      // The non-modifier final token of keys should align with match.key/code.
      // ⌃ stays in the strip filter for forward-compat with platform.ts even
      // though no current shortcut uses it.
      const nonModifierTokens = keys.filter(
        (k) => k !== '⌘' && k !== '⇧' && k !== '⌥' && k !== '⌃',
      )
      expect(nonModifierTokens.length).toBe(1)
      const finalToken = nonModifierTokens[0]

      if (match.code !== undefined) {
        // Letter codes ('KeyZ') → last-segment letter; digit codes ('Digit7') →
        // the digit; punctuation codes via map.
        const letterMatch = match.code.match(/^Key([A-Z])$/)
        const digitMatch = match.code.match(/^Digit([0-9])$/)
        const expectedDisplay = letterMatch
          ? letterMatch[1]
          : digitMatch
            ? digitMatch[1]
            : (CODE_TO_DISPLAY[match.code] ?? match.code)
        expect(finalToken.toUpperCase()).toBe(expectedDisplay.toUpperCase())
      } else {
        // Schema XOR: when code is unset, key is set.
        // Special-named keys ('Escape', 'Backspace') display as 'Esc', 'Backspace'.
        const SPECIAL_DISPLAY: Record<string, string> = {
          Escape: 'Esc',
        }
        const expected = SPECIAL_DISPLAY[match.key] ?? match.key
        expect(finalToken.toLowerCase()).toBe(expected.toLowerCase())
      }
    })
  }
})

describe('section coverage', () => {
  it('every section in SHORTCUTS appears in SECTION_LAYOUT', () => {
    const layoutSections = new Set<string>(
      SECTION_LAYOUT.flatMap((col) => [...col.sections]),
    )
    const registrySections = new Set<string>(SHORTCUTS.map((s) => s.section))
    for (const section of registrySections) {
      expect(layoutSections.has(section)).toBe(true)
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
      'app.escape',
    ])
    for (const shortcut of getAllShortcuts()) {
      const allow = shortcut.allowInInputs ?? false
      expect(allow).toBe(expected.has(shortcut.id))
    }
  })
})
