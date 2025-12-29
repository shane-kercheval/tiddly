/**
 * Tests for ConfirmDeleteButton component.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { ConfirmDeleteButton } from './ConfirmDeleteButton'

describe('ConfirmDeleteButton', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('initial state', () => {
    it('renders trash icon by default', () => {
      render(<ConfirmDeleteButton onConfirm={vi.fn()} />)

      const button = screen.getByRole('button')
      expect(button).toBeInTheDocument()
      expect(button).toHaveAttribute('title', 'Delete')
      // Should contain SVG (trash icon), not "Delete?" text
      expect(screen.queryByText('Delete?')).not.toBeInTheDocument()
    })

    it('uses custom title when provided', () => {
      render(<ConfirmDeleteButton onConfirm={vi.fn()} title="Delete item" />)

      expect(screen.getByRole('button')).toHaveAttribute('title', 'Delete item')
    })
  })

  describe('two-click confirmation', () => {
    it('shows Delete? text after first click', () => {
      render(<ConfirmDeleteButton onConfirm={vi.fn()} />)

      const button = screen.getByRole('button')
      fireEvent.click(button)

      expect(screen.getByText('Delete?')).toBeInTheDocument()
      expect(button).toHaveAttribute('title', 'Click again to confirm')
    })

    it('does NOT call onConfirm on first click', () => {
      const onConfirm = vi.fn()
      render(<ConfirmDeleteButton onConfirm={onConfirm} />)

      fireEvent.click(screen.getByRole('button'))

      expect(onConfirm).not.toHaveBeenCalled()
    })

    it('calls onConfirm on second click', () => {
      const onConfirm = vi.fn()
      render(<ConfirmDeleteButton onConfirm={onConfirm} />)

      const button = screen.getByRole('button')
      fireEvent.click(button) // First click - show confirm
      fireEvent.click(button) // Second click - execute

      expect(onConfirm).toHaveBeenCalledTimes(1)
    })

    it('resets to initial state after confirming', () => {
      const onConfirm = vi.fn()
      render(<ConfirmDeleteButton onConfirm={onConfirm} />)

      const button = screen.getByRole('button')
      fireEvent.click(button) // First click
      fireEvent.click(button) // Second click - confirm

      // Should be back to initial state (no "Delete?" text)
      expect(screen.queryByText('Delete?')).not.toBeInTheDocument()
    })
  })

  describe('timeout reset', () => {
    it('resets to initial state after timeout', () => {
      render(<ConfirmDeleteButton onConfirm={vi.fn()} timeout={3000} />)

      const button = screen.getByRole('button')
      fireEvent.click(button)

      expect(screen.getByText('Delete?')).toBeInTheDocument()

      // Fast-forward past timeout
      act(() => {
        vi.advanceTimersByTime(3001)
      })

      expect(screen.queryByText('Delete?')).not.toBeInTheDocument()
    })

    it('uses custom timeout value', () => {
      render(<ConfirmDeleteButton onConfirm={vi.fn()} timeout={1000} />)

      const button = screen.getByRole('button')
      fireEvent.click(button)

      // Should still be confirming at 999ms
      act(() => {
        vi.advanceTimersByTime(999)
      })
      expect(screen.getByText('Delete?')).toBeInTheDocument()

      // Should reset after 1000ms
      act(() => {
        vi.advanceTimersByTime(2)
      })
      expect(screen.queryByText('Delete?')).not.toBeInTheDocument()
    })
  })

  describe('click outside reset', () => {
    it('resets when clicking outside the button', () => {
      render(
        <div>
          <ConfirmDeleteButton onConfirm={vi.fn()} />
          <button data-testid="other">Other</button>
        </div>
      )

      const confirmButton = screen.getByTitle('Delete')
      fireEvent.click(confirmButton)

      expect(screen.getByText('Delete?')).toBeInTheDocument()

      // Click outside
      fireEvent.mouseDown(screen.getByTestId('other'))

      expect(screen.queryByText('Delete?')).not.toBeInTheDocument()
    })
  })

  describe('disabled state', () => {
    it('is disabled when isDeleting is true', () => {
      render(<ConfirmDeleteButton onConfirm={vi.fn()} isDeleting={true} />)

      expect(screen.getByRole('button')).toBeDisabled()
    })

    it('does not respond to clicks when isDeleting', () => {
      const onConfirm = vi.fn()
      render(<ConfirmDeleteButton onConfirm={onConfirm} isDeleting={true} />)

      const button = screen.getByRole('button')
      fireEvent.click(button)
      fireEvent.click(button)

      expect(onConfirm).not.toHaveBeenCalled()
      expect(screen.queryByText('Delete?')).not.toBeInTheDocument()
    })
  })

  describe('styling', () => {
    it('applies confirm styling when in confirm state', () => {
      render(<ConfirmDeleteButton onConfirm={vi.fn()} />)

      const button = screen.getByRole('button')
      fireEvent.click(button)

      expect(button.className).toContain('bg-red-100')
      expect(button.className).toContain('text-red-600')
    })

    it('applies custom className', () => {
      render(<ConfirmDeleteButton onConfirm={vi.fn()} className="ml-4" />)

      expect(screen.getByRole('button').className).toContain('ml-4')
    })
  })
})
