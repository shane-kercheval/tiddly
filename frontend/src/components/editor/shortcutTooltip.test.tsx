import { describe, it, expect, vi, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { shortcutTooltipContent } from './shortcutTooltip'

function mockPlatform(value: string): void {
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue(value)
}

afterEach(() => {
  vi.restoreAllMocks()
})

/** Render shortcutTooltipContent and return the concatenated visible text. */
function textOf(node: ReturnType<typeof shortcutTooltipContent>): string {
  const { container } = render(<>{node}</>)
  return container.textContent ?? ''
}

describe('shortcutTooltipContent', () => {
  it('renders label and shortcut on separate lines (multi-line, <br> between)', () => {
    mockPlatform('MacIntel')
    const { container } = render(<>{shortcutTooltipContent('editor.bold')}</>)
    // Multi-line layout — fixes the "(Ctrl+Shift+M)" single-line truncation
    // bug on Windows/Linux where the localized combo is long.
    expect(container.querySelector('br')).toBeTruthy()
    expect(container.textContent).toBe('Bold⌘B')
  })

  it('renders Mac glyph form for the shortcut', () => {
    mockPlatform('MacIntel')
    expect(textOf(shortcutTooltipContent('editor.bold'))).toBe('Bold⌘B')
  })

  it('renders Ctrl+ form on Windows/Linux', () => {
    mockPlatform('Win32')
    expect(textOf(shortcutTooltipContent('editor.bold'))).toBe('BoldCtrl+B')
  })

  it('handles multi-modifier shortcuts', () => {
    mockPlatform('MacIntel')
    expect(textOf(shortcutTooltipContent('editor.codeBlock'))).toBe('Code Block⌘⇧E')
  })

  it('handles non-letter punctuation keys', () => {
    mockPlatform('Win32')
    expect(textOf(shortcutTooltipContent('editor.horizontalRule'))).toBe('Horizontal RuleCtrl+Shift+-')
  })

  it('uses the registry label as the leading text (Title Case canonical)', () => {
    mockPlatform('MacIntel')
    expect(textOf(shortcutTooltipContent('editor.inlineCode'))).toMatch(/^Inline Code/)
    expect(textOf(shortcutTooltipContent('editor.bulletList'))).toMatch(/^Bullet List/)
  })

  it('long Windows/Linux combos render on a separate line', () => {
    // "Toggle Reading Mode (Ctrl+Shift+M)" gets cut off as a single-line
    // tooltip; the multi-line render lets the combo wrap to a second line.
    // Regression guard for the original bug report.
    mockPlatform('Win32')
    const { container } = render(<>{shortcutTooltipContent('editor.toggleReadingMode')}</>)
    expect(container.querySelector('br')).toBeTruthy()
    expect(container.textContent).toBe('Toggle Reading ModeCtrl+Shift+M')
  })
})
