import { describe, it, expect, vi, afterEach } from 'vitest'
import { tooltipFor } from './format'

function mockPlatform(value: string): void {
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue(value)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('tooltipFor', () => {
  it('formats `Label (⌘B)` on Mac', () => {
    mockPlatform('MacIntel')
    expect(tooltipFor('editor.bold')).toBe('Bold (⌘B)')
  })

  it('formats `Label (Ctrl+B)` on Windows/Linux', () => {
    mockPlatform('Win32')
    expect(tooltipFor('editor.bold')).toBe('Bold (Ctrl+B)')
  })

  it('handles multi-modifier shortcuts', () => {
    mockPlatform('MacIntel')
    expect(tooltipFor('editor.codeBlock.cm')).toBe('Code Block (⌘⇧E)')
  })

  it('handles non-letter punctuation keys', () => {
    mockPlatform('Win32')
    expect(tooltipFor('editor.horizontalRule')).toBe('Horizontal Rule (Ctrl+Shift+-)')
  })

  it('uses the registry label as the leading text (Title Case canonical)', () => {
    mockPlatform('MacIntel')
    // The registry's label IS the toolbar tooltip text — single canonical form.
    expect(tooltipFor('editor.inlineCode')).toMatch(/^Inline Code/)
    expect(tooltipFor('editor.bulletList')).toMatch(/^Bullet List/)
  })
})
