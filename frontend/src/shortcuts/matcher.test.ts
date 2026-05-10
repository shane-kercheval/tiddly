import { describe, it, expect } from 'vitest'
import { matches, findMatchingShortcut } from './matcher'
import type { Shortcut, ShortcutMatch } from './types'

function ev(init: Partial<KeyboardEventInit> & { key?: string; code?: string }): KeyboardEvent {
  return new KeyboardEvent('keydown', init)
}

describe('matches — modifier strictness', () => {
  it('mod: true requires meta or ctrl', () => {
    const m: ShortcutMatch = { mod: true, key: 'b' }
    expect(matches(ev({ key: 'b', metaKey: true }), m)).toBe(true)
    expect(matches(ev({ key: 'b', ctrlKey: true }), m)).toBe(true)
    expect(matches(ev({ key: 'b' }), m)).toBe(false)
  })

  it('mod: undefined means modifier MUST NOT be pressed', () => {
    const m: ShortcutMatch = { key: '/' }
    expect(matches(ev({ key: '/' }), m)).toBe(true)
    expect(matches(ev({ key: '/', metaKey: true }), m)).toBe(false)
    expect(matches(ev({ key: '/', ctrlKey: true }), m)).toBe(false)
  })

  it('shift undefined means shift MUST NOT be pressed (Cmd+\\ vs Cmd+Shift+\\)', () => {
    const cmdBackslash: ShortcutMatch = { mod: true, key: '\\' }
    expect(matches(ev({ key: '\\', metaKey: true }), cmdBackslash)).toBe(true)
    expect(matches(ev({ key: '\\', metaKey: true, shiftKey: true }), cmdBackslash)).toBe(false)

    const cmdShiftBackslash: ShortcutMatch = { mod: true, shift: true, key: '\\' }
    expect(matches(ev({ key: '\\', metaKey: true, shiftKey: true }), cmdShiftBackslash)).toBe(true)
    expect(matches(ev({ key: '\\', metaKey: true }), cmdShiftBackslash)).toBe(false)
  })

  it('alt: true requires altKey', () => {
    const m: ShortcutMatch = { alt: true, code: 'KeyZ' }
    expect(matches(ev({ code: 'KeyZ', altKey: true }), m)).toBe(true)
    expect(matches(ev({ code: 'KeyZ' }), m)).toBe(false)
  })
})

describe('matches — key vs code', () => {
  it('returns false on key mismatch', () => {
    expect(matches(ev({ key: 'b', metaKey: true }), { mod: true, key: 'i' })).toBe(false)
  })

  it('returns false on code mismatch', () => {
    expect(matches(ev({ code: 'KeyZ', altKey: true }), { alt: true, code: 'KeyL' })).toBe(false)
  })

  it('compares single-letter key case-insensitively', () => {
    // Browsers may report 'P' or 'p' for Cmd+Shift+P depending on platform.
    const m: ShortcutMatch = { mod: true, shift: true, key: 'p' }
    expect(matches(ev({ key: 'P', metaKey: true, shiftKey: true }), m)).toBe(true)
    expect(matches(ev({ key: 'p', metaKey: true, shiftKey: true }), m)).toBe(true)
  })

  it('compares non-alpha keys exactly', () => {
    expect(matches(ev({ key: '/', metaKey: true, shiftKey: true }), { mod: true, shift: true, key: '/' })).toBe(true)
    expect(matches(ev({ key: 'Escape' }), { key: 'Escape' })).toBe(true)
    expect(matches(ev({ key: 'escape' }), { key: 'Escape' })).toBe(false)
  })

  it('matches on code (independent of event.key)', () => {
    // Mac reports event.key = 'Ω' for Option+Z but code = 'KeyZ'.
    const m: ShortcutMatch = { alt: true, code: 'KeyZ' }
    expect(matches(ev({ key: 'Ω', code: 'KeyZ', altKey: true }), m)).toBe(true)
  })
})

describe('findMatchingShortcut', () => {
  const shortcuts: Shortcut[] = [
    {
      id: 'a',
      label: 'A',
      section: 'Test',
      keys: ['⌘', 'A'],
      match: { mod: true, key: 'a' },
    },
    {
      id: 'b',
      label: 'B',
      section: 'Test',
      keys: ['⌘', 'B'],
      match: { mod: true, key: 'b' },
    },
    {
      id: 'display-only',
      label: 'No match',
      section: 'Test',
      keys: ['⌘', 'Click'],
      // no match — display only
    },
  ]

  it('returns the matching entry', () => {
    const matched = findMatchingShortcut(ev({ key: 'b', metaKey: true }), shortcuts)
    expect(matched?.id).toBe('b')
  })

  it('returns undefined when nothing matches', () => {
    const matched = findMatchingShortcut(ev({ key: 'q', metaKey: true }), shortcuts)
    expect(matched).toBeUndefined()
  })

  it('skips display-only entries (no match)', () => {
    // Cmd+Click can't fire as a keydown event, but defensively assert we don't
    // consider entries without a match shape.
    const matched = findMatchingShortcut(ev({ key: 'Click', metaKey: true }), shortcuts)
    expect(matched).toBeUndefined()
  })

  it('returns the first byte-equal match in iteration order', () => {
    // Documents the order-dependence behavior. In real usage, this case is
    // prevented at hook-mount time by useGlobalShortcuts.assertNoDuplicateMatchShapes;
    // the matcher itself remains a pure first-wins walk.
    const colliding: Shortcut[] = [
      { id: 'first', label: 'First', section: 'Test', keys: ['⌘', 'B'], match: { mod: true, key: 'b' } },
      { id: 'second', label: 'Second', section: 'Test', keys: ['⌘', 'B'], match: { mod: true, key: 'b' } },
    ]
    const matched = findMatchingShortcut(ev({ key: 'b', metaKey: true }), colliding)
    expect(matched?.id).toBe('first')
  })
})
