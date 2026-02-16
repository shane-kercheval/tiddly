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

  it('should call onClose when Escape is pressed', () => {
    const onClose = vi.fn()
    render(<ShortcutsDialog isOpen={true} onClose={onClose} />)

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('should prevent Escape from reaching other handlers (capture phase + stopImmediatePropagation)', () => {
    const onClose = vi.fn()
    const otherHandler = vi.fn()

    // Add another document-level event listener BEFORE rendering the dialog
    // This simulates a component like Note that was mounted first
    // Using bubbling phase (default) - this is how Note.tsx adds its listener
    document.addEventListener('keydown', otherHandler)

    render(<ShortcutsDialog isOpen={true} onClose={onClose} />)

    // Create and dispatch a real KeyboardEvent
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    document.dispatchEvent(event)

    // Dialog should close
    expect(onClose).toHaveBeenCalledTimes(1)

    // The other handler should NOT be called because:
    // 1. Dialog uses capture phase (runs first)
    // 2. Dialog calls stopImmediatePropagation (prevents bubbling phase)
    expect(otherHandler).not.toHaveBeenCalled()

    document.removeEventListener('keydown', otherHandler)
  })

  it('should call onClose when close button is clicked', () => {
    const onClose = vi.fn()
    render(<ShortcutsDialog isOpen={true} onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: /close dialog/i }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('should call onClose when backdrop is clicked', () => {
    const onClose = vi.fn()
    render(<ShortcutsDialog isOpen={true} onClose={onClose} />)

    // Click on the backdrop (the outer div with modal-backdrop class)
    fireEvent.click(screen.getByRole('dialog'))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('should not close when clicking inside the dialog content', () => {
    const onClose = vi.fn()
    render(<ShortcutsDialog isOpen={true} onClose={onClose} />)

    // Click on the dialog content (not the backdrop)
    fireEvent.click(screen.getByText('Keyboard Shortcuts'))

    expect(onClose).not.toHaveBeenCalled()
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

    expect(screen.getByText('New bookmark')).toBeInTheDocument()
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
