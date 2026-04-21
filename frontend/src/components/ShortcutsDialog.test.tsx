/**
 * Tests for ShortcutsDialog component.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ShortcutsDialog } from './ShortcutsDialog'

describe('ShortcutsDialog', () => {
  it('should render when isOpen is true', () => {
    render(<ShortcutsDialog isOpen={true} onClose={vi.fn()} />)

    expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument()
  })

  it('should not render when isOpen is false', () => {
    render(<ShortcutsDialog isOpen={false} onClose={vi.fn()} />)

    expect(screen.queryByText('Keyboard Shortcuts')).not.toBeInTheDocument()
  })

  // Wiring smoke test: verifies onClose is plumbed through to Modal.
  // Does NOT test Modal's dismissal mechanism — that lives in Modal.test.tsx.
  it('forwards dismissal to the onClose prop', () => {
    const onClose = vi.fn()
    render(<ShortcutsDialog isOpen={true} onClose={onClose} />)

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('should display shortcut groups', () => {
    render(<ShortcutsDialog isOpen={true} onClose={vi.fn()} />)

    // Left column groups
    expect(screen.getByText('Actions')).toBeInTheDocument()
    expect(screen.getByText('Navigation')).toBeInTheDocument()
    expect(screen.getByText('View')).toBeInTheDocument()
    // Right column groups
    expect(screen.getByText('Markdown Editor')).toBeInTheDocument()
  })

  it('should display individual shortcuts', () => {
    render(<ShortcutsDialog isOpen={true} onClose={vi.fn()} />)

    expect(screen.getByText('Paste URL to add bookmark')).toBeInTheDocument()
    expect(screen.getByText('Search')).toBeInTheDocument()
    expect(screen.getByText('Toggle full-width layout')).toBeInTheDocument()
    expect(screen.getByText('Bold')).toBeInTheDocument()
  })

  it('should display save and close shortcut', () => {
    render(<ShortcutsDialog isOpen={true} onClose={vi.fn()} />)

    expect(screen.getByText('Save')).toBeInTheDocument()
    expect(screen.getByText('Save and close')).toBeInTheDocument()
  })
})
