/**
 * Tests for the DocsShortcuts page.
 *
 * Covers the M2 migration: the Markdown Editor table reads from the registry.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DocsShortcuts } from './DocsShortcuts'
import { getShortcutsBySection } from '../../shortcuts/registry'

function mockPlatform(value: string): void {
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue(value)
}

afterEach(() => {
  vi.restoreAllMocks()
})

function renderPage(): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <DocsShortcuts />
    </MemoryRouter>,
  )
}

describe('DocsShortcuts', () => {
  it('renders the page heading and all section headings', () => {
    renderPage()

    expect(screen.getByRole('heading', { name: 'Keyboard Shortcuts' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Navigation' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Actions' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'View' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Markdown Editor' })).toBeInTheDocument()
  })

  it('Markdown Editor table sources every row from the registry', () => {
    renderPage()

    const expected = getShortcutsBySection('Markdown Editor')
    expect(expected.length).toBeGreaterThan(0)

    for (const entry of expected) {
      expect(screen.getByText(entry.label)).toBeInTheDocument()
    }
  })

  it('uses Title Case canonical labels in the Markdown Editor section', () => {
    renderPage()
    expect(screen.getByText('Inline Code')).toBeInTheDocument()
    expect(screen.getByText('Code Block')).toBeInTheDocument()
    expect(screen.getByText('Horizontal Rule')).toBeInTheDocument()
  })

  it('View table sources every row from the registry (M3 migration)', () => {
    renderPage()

    const expected = getShortcutsBySection('View')
    expect(expected.length).toBeGreaterThan(0)

    for (const entry of expected) {
      expect(screen.getByText(entry.label)).toBeInTheDocument()
    }
  })

  it('includes the new capture-phase entries in the View table', () => {
    renderPage()
    expect(screen.getByText('Toggle Word Wrap')).toBeInTheDocument()
    expect(screen.getByText('Toggle Line Numbers')).toBeInTheDocument()
    expect(screen.getByText('Toggle Monospace Font')).toBeInTheDocument()
    expect(screen.getByText('Toggle Table of Contents')).toBeInTheDocument()
    expect(screen.getByText('Toggle Reading Mode')).toBeInTheDocument()
  })

  it('localizes Cmd-glyph keys to Ctrl on Windows', () => {
    mockPlatform('Win32')
    renderPage()

    const boldRow = screen.getByText('Bold').closest('tr')!
    expect(within(boldRow).getByText('Ctrl')).toBeInTheDocument()
    expect(within(boldRow).queryByText('⌘')).not.toBeInTheDocument()
  })

  it('preserves Cmd-glyph keys on Mac', () => {
    mockPlatform('MacIntel')
    renderPage()

    const boldRow = screen.getByText('Bold').closest('tr')!
    expect(within(boldRow).getByText('⌘')).toBeInTheDocument()
  })

  it('Navigation table sources every row from the registry (M3 migration)', () => {
    renderPage()
    const expected = getShortcutsBySection('Navigation')
    expect(expected.length).toBeGreaterThan(0)
    for (const entry of expected) {
      expect(screen.getByText(entry.label)).toBeInTheDocument()
    }
  })

  it('includes the non-keyboard Navigation entries (Cmd+Click, Shift+Click)', () => {
    renderPage()
    expect(screen.getByText('Open Card in New Tab')).toBeInTheDocument()
    expect(screen.getByText('Open Bookmark Relationship in Tiddly (instead of URL)')).toBeInTheDocument()
  })
})
