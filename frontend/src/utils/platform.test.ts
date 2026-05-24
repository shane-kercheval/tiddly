import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatShortcut, isMac, localizeKey, localizeKeys } from './platform'

function mockPlatform(value: string): void {
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue(value)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('isMac', () => {
  it('returns true for MacIntel', () => {
    mockPlatform('MacIntel')
    expect(isMac()).toBe(true)
  })

  it('returns true for arm-based Mac', () => {
    mockPlatform('MacARM')
    expect(isMac()).toBe(true)
  })

  it('returns true for iPhone', () => {
    mockPlatform('iPhone')
    expect(isMac()).toBe(true)
  })

  it('returns true for iPad', () => {
    mockPlatform('iPad')
    expect(isMac()).toBe(true)
  })

  it('returns true for iPod', () => {
    mockPlatform('iPod')
    expect(isMac()).toBe(true)
  })

  it('returns false for Win32', () => {
    mockPlatform('Win32')
    expect(isMac()).toBe(false)
  })

  it('returns false for Linux x86_64', () => {
    mockPlatform('Linux x86_64')
    expect(isMac()).toBe(false)
  })
})

describe('localizeKey', () => {
  it('renders modifier tokens as Mac glyphs on Mac', () => {
    mockPlatform('MacIntel')
    expect(localizeKey('Mod')).toBe('⌘')
    expect(localizeKey('Alt')).toBe('⌥')
    expect(localizeKey('Shift')).toBe('⇧')
  })

  it('renders modifier tokens as text words on Windows/Linux', () => {
    mockPlatform('Win32')
    expect(localizeKey('Mod')).toBe('Ctrl')
    expect(localizeKey('Alt')).toBe('Alt')
    expect(localizeKey('Shift')).toBe('Shift')
  })

  it('passes non-modifier tokens through unchanged', () => {
    mockPlatform('Win32')
    expect(localizeKey('B')).toBe('B')
    expect(localizeKey('Click')).toBe('Click')
    expect(localizeKey('Esc')).toBe('Esc')
    expect(localizeKey('/')).toBe('/')
  })
})

describe('localizeKeys', () => {
  it('localizes each token in an array', () => {
    mockPlatform('Win32')
    expect(localizeKeys(['Mod', 'Shift', 'B'])).toEqual(['Ctrl', 'Shift', 'B'])
  })
})

describe('formatShortcut', () => {
  it('joins with no separator on Mac', () => {
    mockPlatform('MacIntel')
    expect(formatShortcut(['Mod', 'B'])).toBe('⌘B')
    expect(formatShortcut(['Mod', 'Shift', 'X'])).toBe('⌘⇧X')
  })

  it('joins with + on Windows and renders modifier words', () => {
    mockPlatform('Win32')
    expect(formatShortcut(['Mod', 'B'])).toBe('Ctrl+B')
    expect(formatShortcut(['Mod', 'Shift', 'X'])).toBe('Ctrl+Shift+X')
    expect(formatShortcut(['Alt', 'Z'])).toBe('Alt+Z')
  })
})
