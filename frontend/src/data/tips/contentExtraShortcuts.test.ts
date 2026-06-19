import { describe, it, expect } from 'vitest'
import {
  isContentShortcutId,
  resolveContentShortcut,
  SHORTCUT_TOKEN_RE,
  SHORTCUT_TOKEN_SCAN_RE,
  CONTENT_EXTRA_SHORTCUTS,
} from './contentExtraShortcuts'
import { PAGE_SCOPED_SAVE_KEYS, PAGE_SCOPED_SAVE_AND_CLOSE_KEYS } from '../../shortcuts/pageScoped'

describe('resolveContentShortcut', () => {
  it('resolves a registry-backed id to its keys', () => {
    // app.commandPalette → ['Mod', 'Shift', 'P'] per registry.ts.
    expect(resolveContentShortcut('app.commandPalette')).toEqual(['Mod', 'Shift', 'P'])
  })

  it('resolves an extras-backed page.save id from pageScoped constants', () => {
    expect(resolveContentShortcut('page.save')).toEqual(PAGE_SCOPED_SAVE_KEYS)
  })

  it('resolves page.saveAndClose from pageScoped constants', () => {
    expect(resolveContentShortcut('page.saveAndClose')).toEqual(PAGE_SCOPED_SAVE_AND_CLOSE_KEYS)
  })

  it('resolves the Chrome extension popup id', () => {
    expect(resolveContentShortcut('extension.openPopup')).toEqual(['Alt', 'Shift', 'S'])
  })

  it('resolves the CodeMirror editor chords to OS-agnostic tokens', () => {
    expect(resolveContentShortcut('editor.find')).toEqual(['Mod', 'F'])
    expect(resolveContentShortcut('editor.findNext')).toEqual(['Mod', 'G'])
    expect(resolveContentShortcut('editor.findPrevious')).toEqual(['Mod', 'Shift', 'G'])
    expect(resolveContentShortcut('editor.goToLine')).toEqual(['Mod', 'Alt', 'G'])
    expect(resolveContentShortcut('editor.addCursorAboveBelow')).toEqual(['Mod', 'Alt', '↑/↓'])
    expect(resolveContentShortcut('editor.openLinkModifier')).toEqual(['Mod'])
  })

  it('resolves editor.selectAllOccurrences through the keyboard registry', () => {
    // Lives in shortcuts.json (display-only), not the extras module — its sibling
    // editor.selectNextOccurrence is in the help dialog, so this one is too.
    expect(resolveContentShortcut('editor.selectAllOccurrences')).toEqual(['Mod', 'Shift', 'L'])
  })

  it('throws on an unknown id with the id in the message', () => {
    expect(() => resolveContentShortcut('nope.notreal')).toThrow(/nope\.notreal/)
  })

  it('throws on an empty string', () => {
    expect(() => resolveContentShortcut('')).toThrow(/Unknown content shortcut id/)
  })

  // Object.prototype defenses — `in` operator would walk the prototype chain
  // and accept these. `Object.hasOwn` rejects them.
  it('throws on inherited Object.prototype member "toString"', () => {
    expect(() => resolveContentShortcut('toString')).toThrow(/Unknown content shortcut id/)
  })

  it('throws on inherited Object.prototype member "constructor"', () => {
    expect(() => resolveContentShortcut('constructor')).toThrow(/Unknown content shortcut id/)
  })

  it('throws on inherited Object.prototype member "hasOwnProperty"', () => {
    expect(() => resolveContentShortcut('hasOwnProperty')).toThrow(/Unknown content shortcut id/)
  })
})

describe('isContentShortcutId', () => {
  it('returns true for a registry-backed id', () => {
    expect(isContentShortcutId('editor.bold')).toBe(true)
  })

  it('returns true for an extras-backed id', () => {
    expect(isContentShortcutId('page.save')).toBe(true)
    expect(isContentShortcutId('extension.openPopup')).toBe(true)
  })

  it('returns false for an unknown id', () => {
    expect(isContentShortcutId('definitely.notreal')).toBe(false)
  })

  it('returns false for the empty string', () => {
    expect(isContentShortcutId('')).toBe(false)
  })

  // Same prototype-chain defense as `resolveContentShortcut`.
  it('returns false for inherited Object.prototype members', () => {
    expect(isContentShortcutId('toString')).toBe(false)
    expect(isContentShortcutId('constructor')).toBe(false)
    expect(isContentShortcutId('hasOwnProperty')).toBe(false)
  })
})

describe('CONTENT_EXTRA_SHORTCUTS', () => {
  it('exposes exactly the documented entries', () => {
    expect(Object.keys(CONTENT_EXTRA_SHORTCUTS).sort()).toEqual(
      [
        'editor.addCursorAboveBelow',
        'editor.find',
        'editor.findNext',
        'editor.findPrevious',
        'editor.goToLine',
        'editor.openLinkModifier',
        'extension.openPopup',
        'page.save',
        'page.saveAndClose',
      ],
    )
  })
})

describe('SHORTCUT_TOKEN_RE', () => {
  it('matches a token that is the entire string', () => {
    const match = '{{shortcut:app.commandPalette}}'.match(SHORTCUT_TOKEN_RE)
    expect(match?.[1]).toBe('app.commandPalette')
  })

  it('matches a camelCase id', () => {
    const match = '{{shortcut:bookmark.pasteUrl}}'.match(SHORTCUT_TOKEN_RE)
    expect(match?.[1]).toBe('bookmark.pasteUrl')
  })

  it('matches a kebab-style id with hyphens (defensive — extras module currently has none)', () => {
    const match = '{{shortcut:some-thing}}'.match(SHORTCUT_TOKEN_RE)
    expect(match?.[1]).toBe('some-thing')
  })

  it('does not match a token with leading text', () => {
    expect('Press {{shortcut:app.commandPalette}}'.match(SHORTCUT_TOKEN_RE)).toBeNull()
  })

  it('does not match a token with trailing text', () => {
    expect('{{shortcut:app.commandPalette}} now'.match(SHORTCUT_TOKEN_RE)).toBeNull()
  })

  it('does not match an empty id body', () => {
    expect('{{shortcut:}}'.match(SHORTCUT_TOKEN_RE)).toBeNull()
  })

  // Pin: `$` in JS regex (without the `m` flag) anchors to the very end of
  // input, NOT to a position before a trailing newline. This is the
  // load-bearing property that prevents fenced-block content (which arrives
  // through the `code` override with a trailing `\n`) from being mistaken
  // for an inline token. If someone ever adds the `m` flag, this test fails.
  it('does not match a string with a trailing newline', () => {
    expect('{{shortcut:app.commandPalette}}\n'.match(SHORTCUT_TOKEN_RE)).toBeNull()
  })

  it('does not match a string with a trailing carriage return', () => {
    expect('{{shortcut:app.commandPalette}}\r'.match(SHORTCUT_TOKEN_RE)).toBeNull()
  })
})

describe('SHORTCUT_TOKEN_SCAN_RE', () => {
  it('finds every token in a string', () => {
    const text = 'First `{{shortcut:app.escape}}` and second `{{shortcut:page.save}}` here.'
    const ids = Array.from(text.matchAll(SHORTCUT_TOKEN_SCAN_RE)).map((m) => m[1])
    expect(ids).toEqual(['app.escape', 'page.save'])
  })

  it('finds a single token', () => {
    const ids = Array.from(
      '`{{shortcut:editor.bold}}`'.matchAll(SHORTCUT_TOKEN_SCAN_RE),
    ).map((m) => m[1])
    expect(ids).toEqual(['editor.bold'])
  })

  it('returns an empty iterator for a body with no tokens', () => {
    const ids = Array.from(
      'No tokens here at all.'.matchAll(SHORTCUT_TOKEN_SCAN_RE),
    ).map((m) => m[1])
    expect(ids).toEqual([])
  })
})
