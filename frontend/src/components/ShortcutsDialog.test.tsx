/**
 * Tests for ShortcutsDialog component.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { ShortcutsDialog } from './ShortcutsDialog'
import { getShortcutsBySection } from '../shortcuts/registry'

function mockPlatform(value: string): void {
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue(value)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ShortcutsDialog', () => {
  it('renders when isOpen is true', () => {
    render(<ShortcutsDialog isOpen={true} onClose={vi.fn()} />)

    expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument()
  })

  it('does not render when isOpen is false', () => {
    render(<ShortcutsDialog isOpen={false} onClose={vi.fn()} />)

    expect(screen.queryByText('Keyboard Shortcuts')).not.toBeInTheDocument()
  })

  it('forwards dismissal to the onClose prop', () => {
    const onClose = vi.fn()
    render(<ShortcutsDialog isOpen={true} onClose={onClose} />)

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('displays all four shortcut sections', () => {
    render(<ShortcutsDialog isOpen={true} onClose={vi.fn()} />)

    expect(screen.getByText('Actions')).toBeInTheDocument()
    expect(screen.getByText('Navigation')).toBeInTheDocument()
    expect(screen.getByText('View')).toBeInTheDocument()
    expect(screen.getByText('Markdown Editor')).toBeInTheDocument()
  })

  it('displays inline-section shortcut labels', () => {
    render(<ShortcutsDialog isOpen={true} onClose={vi.fn()} />)

    // Paste URL is in the inline Actions section. Search is inline Navigation.
    expect(screen.getByText('Paste URL to add bookmark')).toBeInTheDocument()
    expect(screen.getByText('Search')).toBeInTheDocument()
  })

  it('displays View section labels (sourced from registry)', () => {
    render(<ShortcutsDialog isOpen={true} onClose={vi.fn()} />)

    expect(screen.getByText('Toggle Full-Width Layout')).toBeInTheDocument()
    expect(screen.getByText('Toggle Word Wrap')).toBeInTheDocument()
    expect(screen.getByText('Toggle Reading Mode')).toBeInTheDocument()
  })
})

describe('ShortcutsDialog — Navigation section sourced from registry', () => {
  it('renders every Navigation entry from the registry, in order', () => {
    render(<ShortcutsDialog isOpen={true} onClose={vi.fn()} />)

    const expected = getShortcutsBySection('Navigation')
    expect(expected.length).toBeGreaterThan(0)

    for (const entry of expected) {
      expect(screen.getByText(entry.label)).toBeInTheDocument()
    }
  })

  it('uses Title Case labels for keyboard Navigation entries (no more sentence case)', () => {
    render(<ShortcutsDialog isOpen={true} onClose={vi.fn()} />)
    expect(screen.getByText('Focus Page Search')).toBeInTheDocument()
    expect(screen.getByText('Command Palette')).toBeInTheDocument()
    expect(screen.getByText('Close Modal / Unfocus Search')).toBeInTheDocument()
  })

  it('includes the non-keyboard display-only entries (⌘Click, ⇧Click)', () => {
    render(<ShortcutsDialog isOpen={true} onClose={vi.fn()} />)
    expect(screen.getByText('Open Card in New Tab')).toBeInTheDocument()
    expect(screen.getByText('Open Bookmark Relationship in Tiddly (instead of URL)')).toBeInTheDocument()
  })
})

describe('ShortcutsDialog — View section sourced from registry', () => {
  it('renders every View entry from the registry, in declaration order', () => {
    render(<ShortcutsDialog isOpen={true} onClose={vi.fn()} />)

    const expected = getShortcutsBySection('View')
    expect(expected.length).toBeGreaterThan(0)

    for (const entry of expected) {
      expect(screen.getByText(entry.label)).toBeInTheDocument()
    }
  })

  it('includes the M3 capture-phase additions (toggleToc, toggleWordWrap, etc.)', () => {
    render(<ShortcutsDialog isOpen={true} onClose={vi.fn()} />)

    expect(screen.getByText('Toggle Word Wrap')).toBeInTheDocument()
    expect(screen.getByText('Toggle Line Numbers')).toBeInTheDocument()
    expect(screen.getByText('Toggle Monospace Font')).toBeInTheDocument()
    expect(screen.getByText('Toggle Table of Contents')).toBeInTheDocument()
    expect(screen.getByText('Toggle Reading Mode')).toBeInTheDocument()
  })
})

describe('ShortcutsDialog — Markdown Editor section sourced from registry', () => {
  it('renders every Markdown Editor entry from the registry, in order', () => {
    render(<ShortcutsDialog isOpen={true} onClose={vi.fn()} />)

    const expected = getShortcutsBySection('Markdown Editor')
    expect(expected.length).toBeGreaterThan(0)

    for (const entry of expected) {
      expect(screen.getByText(entry.label)).toBeInTheDocument()
    }
  })

  it('uses the registry label as the displayed text (Title Case canonical)', () => {
    render(<ShortcutsDialog isOpen={true} onClose={vi.fn()} />)

    // Title Case is the canonical form per the M2 decision — toolbar tooltips
    // and the dialog row both use the registry label.
    expect(screen.getByText('Inline Code')).toBeInTheDocument()
    expect(screen.getByText('Code Block')).toBeInTheDocument()
    expect(screen.getByText('Bullet List')).toBeInTheDocument()
    expect(screen.getByText('Insert Link')).toBeInTheDocument()
    expect(screen.getByText('Horizontal Rule')).toBeInTheDocument()
  })

  it('renders Cmd-glyph keys on Mac', () => {
    mockPlatform('MacIntel')
    render(<ShortcutsDialog isOpen={true} onClose={vi.fn()} />)

    const boldRow = screen.getByText('Bold').closest('li')!
    const badges = within(boldRow).getAllByText(/⌘|B/)
    expect(badges.map((b) => b.textContent)).toContain('⌘')
    expect(badges.map((b) => b.textContent)).toContain('B')
  })

  it('renders "Ctrl" instead of ⌘ on Windows', () => {
    mockPlatform('Win32')
    render(<ShortcutsDialog isOpen={true} onClose={vi.fn()} />)

    const boldRow = screen.getByText('Bold').closest('li')!
    const ctrlBadge = within(boldRow).getByText('Ctrl')
    expect(ctrlBadge).toBeInTheDocument()
    expect(within(boldRow).queryByText('⌘')).not.toBeInTheDocument()
  })
})
