/**
 * Tests for ConflictDialog component.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConflictDialog } from './ConflictDialog'

describe('ConflictDialog', () => {
  const defaultProps = {
    isOpen: true,
    currentContent: 'My local content that should not be lost',
    onLoadServerVersion: vi.fn(),
    onSaveMyVersion: vi.fn(),
    onDoNothing: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('rendering', () => {
    it('should render dialog when isOpen is true', () => {
      render(<ConflictDialog {...defaultProps} />)

      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByText('Save Conflict')).toBeInTheDocument()
    })

    it('should not render dialog when isOpen is false', () => {
      render(<ConflictDialog {...defaultProps} isOpen={false} />)

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('should render all four action buttons', () => {
      render(<ConflictDialog {...defaultProps} />)

      expect(screen.getByRole('button', { name: 'Copy My Content' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Load Server Version' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Save My Version' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Do Nothing' })).toBeInTheDocument()
    })

    it('should show conflict warning message', () => {
      render(<ConflictDialog {...defaultProps} />)

      expect(screen.getByText(/Your changes could not be saved/)).toBeInTheDocument()
    })
  })

  describe('Copy My Content button', () => {
    it('should copy content to clipboard and show checkmark when clicked', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const writeTextMock = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: writeTextMock },
        writable: true,
        configurable: true,
      })

      render(<ConflictDialog {...defaultProps} />)

      await user.click(screen.getByRole('button', { name: 'Copy My Content' }))

      await waitFor(() => {
        expect(writeTextMock).toHaveBeenCalledWith('My local content that should not be lost')
      })
      // Should show "Copied!" text (checkmark animation)
      expect(screen.getByText('Copied!')).toBeInTheDocument()
    })

    it('should show Failed text when clipboard fails', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const writeTextMock = vi.fn().mockRejectedValue(new Error('Clipboard error'))
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: writeTextMock },
        writable: true,
        configurable: true,
      })

      render(<ConflictDialog {...defaultProps} />)

      await user.click(screen.getByRole('button', { name: 'Copy My Content' }))

      await waitFor(() => {
        expect(screen.getByText('Failed')).toBeInTheDocument()
      })
    })
  })

  describe('Load Server Version button', () => {
    it('should call onLoadServerVersion when clicked', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const onLoadServerVersion = vi.fn()
      render(<ConflictDialog {...defaultProps} onLoadServerVersion={onLoadServerVersion} />)

      await user.click(screen.getByRole('button', { name: 'Load Server Version' }))

      expect(onLoadServerVersion).toHaveBeenCalledTimes(1)
    })
  })

  describe('Save My Version button (requires confirmation)', () => {
    it('should show confirmation text on first click', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      render(<ConflictDialog {...defaultProps} />)

      await user.click(screen.getByRole('button', { name: 'Save My Version' }))

      expect(screen.getByRole('button', { name: 'Confirm Overwrite?' })).toBeInTheDocument()
    })

    it('should call onSaveMyVersion on second click (confirmation)', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const onSaveMyVersion = vi.fn()
      render(<ConflictDialog {...defaultProps} onSaveMyVersion={onSaveMyVersion} />)

      // First click - show confirmation
      await user.click(screen.getByRole('button', { name: 'Save My Version' }))
      expect(onSaveMyVersion).not.toHaveBeenCalled()

      // Second click - execute save
      await user.click(screen.getByRole('button', { name: 'Confirm Overwrite?' }))
      expect(onSaveMyVersion).toHaveBeenCalledTimes(1)
    })

    it('should reset confirmation after timeout', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      render(<ConflictDialog {...defaultProps} />)

      // First click - show confirmation
      await user.click(screen.getByRole('button', { name: 'Save My Version' }))
      expect(screen.getByRole('button', { name: 'Confirm Overwrite?' })).toBeInTheDocument()

      // Wait for timeout (3 seconds)
      await act(async () => {
        vi.advanceTimersByTime(3100)
      })

      // Should reset to original state
      expect(screen.getByRole('button', { name: 'Save My Version' })).toBeInTheDocument()
    })

    it('should reset confirmation when clicking outside save button', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const writeTextMock = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: writeTextMock },
        writable: true,
        configurable: true,
      })
      render(<ConflictDialog {...defaultProps} />)

      // First click - show confirmation
      await user.click(screen.getByRole('button', { name: 'Save My Version' }))
      expect(screen.getByRole('button', { name: 'Confirm Overwrite?' })).toBeInTheDocument()

      // Click on "Copy My Content" which doesn't close the dialog
      await user.click(screen.getByRole('button', { name: 'Copy My Content' }))

      // Should reset to original state (not confirming anymore)
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Save My Version' })).toBeInTheDocument()
      })
    })

    it('should have warning styling when in confirmation state', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      render(<ConflictDialog {...defaultProps} />)

      await user.click(screen.getByRole('button', { name: 'Save My Version' }))

      const button = screen.getByRole('button', { name: 'Confirm Overwrite?' })
      expect(button.className).toContain('text-red-600')
      expect(button.className).toContain('bg-red-50')
    })
  })

  describe('Do Nothing button', () => {
    it('should call onDoNothing when clicked', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const onDoNothing = vi.fn()
      render(<ConflictDialog {...defaultProps} onDoNothing={onDoNothing} />)

      await user.click(screen.getByRole('button', { name: 'Do Nothing' }))

      expect(onDoNothing).toHaveBeenCalledTimes(1)
    })

    it('should have disabled close button (canClose=false)', () => {
      render(<ConflictDialog {...defaultProps} />)

      // Modal's close button should be disabled
      const closeButton = screen.getByRole('button', { name: 'Close' })
      expect(closeButton).toBeDisabled()
    })

    it('should not call onDoNothing when Escape key is pressed (canClose=false)', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const onDoNothing = vi.fn()
      render(<ConflictDialog {...defaultProps} onDoNothing={onDoNothing} />)

      await user.keyboard('{Escape}')

      // Escape should NOT close the dialog
      expect(onDoNothing).not.toHaveBeenCalled()
    })
  })

  describe('helper text', () => {
    it('should show helper text for Copy My Content', () => {
      render(<ConflictDialog {...defaultProps} />)

      expect(screen.getByText('Copy your current content to clipboard before choosing an action')).toBeInTheDocument()
    })

    it('should show helper text for Load Server Version', () => {
      render(<ConflictDialog {...defaultProps} />)

      expect(screen.getByText('Discard your changes and load the latest version')).toBeInTheDocument()
    })

    it('should show helper text for Save My Version', () => {
      render(<ConflictDialog {...defaultProps} />)

      expect(screen.getByText('Overwrite server changes with your version')).toBeInTheDocument()
    })

    it('should show helper text for Do Nothing', () => {
      render(<ConflictDialog {...defaultProps} />)

      expect(screen.getByText('Close this dialog and continue editing (changes remain unsaved)')).toBeInTheDocument()
    })
  })

  describe('button types', () => {
    it('should have type="button" on all buttons to prevent form submission', () => {
      render(<ConflictDialog {...defaultProps} />)

      const copyButton = screen.getByRole('button', { name: 'Copy My Content' })
      const loadButton = screen.getByRole('button', { name: 'Load Server Version' })
      const saveButton = screen.getByRole('button', { name: 'Save My Version' })
      const doNothingButton = screen.getByRole('button', { name: 'Do Nothing' })

      expect(copyButton).toHaveAttribute('type', 'button')
      expect(loadButton).toHaveAttribute('type', 'button')
      expect(saveButton).toHaveAttribute('type', 'button')
      expect(doNothingButton).toHaveAttribute('type', 'button')
    })
  })

  describe('button styling', () => {
    it('should have primary styling on Load Server Version button', () => {
      render(<ConflictDialog {...defaultProps} />)

      const button = screen.getByRole('button', { name: 'Load Server Version' })
      expect(button.className).toContain('btn-primary')
    })

    it('should have secondary styling on other buttons', () => {
      render(<ConflictDialog {...defaultProps} />)

      const copyButton = screen.getByRole('button', { name: 'Copy My Content' })
      const saveButton = screen.getByRole('button', { name: 'Save My Version' })
      const doNothingButton = screen.getByRole('button', { name: 'Do Nothing' })

      expect(copyButton.className).toContain('btn-secondary')
      expect(saveButton.className).toContain('btn-secondary')
      expect(doNothingButton.className).toContain('btn-secondary')
    })
  })

  describe('confirmation state reset', () => {
    it('should reset confirmation state when dialog closes', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const { rerender } = render(<ConflictDialog {...defaultProps} />)

      // Enter confirmation state
      await user.click(screen.getByRole('button', { name: 'Save My Version' }))
      expect(screen.getByRole('button', { name: 'Confirm Overwrite?' })).toBeInTheDocument()

      // Close dialog
      rerender(<ConflictDialog {...defaultProps} isOpen={false} />)

      // Reopen dialog
      rerender(<ConflictDialog {...defaultProps} isOpen={true} />)

      // Should be reset to original state
      expect(screen.getByRole('button', { name: 'Save My Version' })).toBeInTheDocument()
    })
  })
})
