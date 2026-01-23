/**
 * Tests for StaleDialog and DeletedDialog components.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StaleDialog, DeletedDialog } from './StaleDialog'

describe('StaleDialog', () => {
  const defaultProps = {
    isOpen: true,
    isDirty: false,
    entityType: 'note' as const,
    onLoadServerVersion: vi.fn(),
    onContinueEditing: vi.fn(),
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
      render(<StaleDialog {...defaultProps} />)

      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByText('This note was modified')).toBeInTheDocument()
    })

    it('should not render dialog when isOpen is false', () => {
      render(<StaleDialog {...defaultProps} isOpen={false} />)

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('should render Load Server Version and Continue Editing buttons', () => {
      render(<StaleDialog {...defaultProps} />)

      expect(screen.getByRole('button', { name: 'Load Server Version' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Continue Editing' })).toBeInTheDocument()
    })

    it('should show newer version message', () => {
      render(<StaleDialog {...defaultProps} />)

      expect(screen.getByText('A newer version was detected on the server.')).toBeInTheDocument()
    })

    it('should show entity type in header for note', () => {
      render(<StaleDialog {...defaultProps} entityType="note" />)

      expect(screen.getByText('This note was modified')).toBeInTheDocument()
    })

    it('should show entity type in header for bookmark', () => {
      render(<StaleDialog {...defaultProps} entityType="bookmark" />)

      expect(screen.getByText('This bookmark was modified')).toBeInTheDocument()
    })

    it('should show entity type in header for prompt', () => {
      render(<StaleDialog {...defaultProps} entityType="prompt" />)

      expect(screen.getByText('This prompt was modified')).toBeInTheDocument()
    })
  })

  describe('dirty warning', () => {
    it('should show dirty warning when isDirty is true', () => {
      render(<StaleDialog {...defaultProps} isDirty={true} />)

      expect(screen.getByText(/You have unsaved changes/)).toBeInTheDocument()
    })

    it('should not show dirty warning when isDirty is false', () => {
      render(<StaleDialog {...defaultProps} isDirty={false} />)

      expect(screen.queryByText(/You have unsaved changes/)).not.toBeInTheDocument()
    })
  })

  describe('Copy My Content button', () => {
    it('should show Copy My Content button when isDirty and currentContent provided', () => {
      render(<StaleDialog {...defaultProps} isDirty={true} currentContent="My local content" />)

      expect(screen.getByRole('button', { name: 'Copy My Content' })).toBeInTheDocument()
    })

    it('should not show Copy My Content button when isDirty is false', () => {
      render(<StaleDialog {...defaultProps} isDirty={false} currentContent="My local content" />)

      expect(screen.queryByRole('button', { name: 'Copy My Content' })).not.toBeInTheDocument()
    })

    it('should not show Copy My Content button when currentContent is not provided', () => {
      render(<StaleDialog {...defaultProps} isDirty={true} />)

      expect(screen.queryByRole('button', { name: 'Copy My Content' })).not.toBeInTheDocument()
    })

    it('should copy content to clipboard and show checkmark when clicked', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const writeTextMock = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: writeTextMock },
        writable: true,
        configurable: true,
      })

      render(<StaleDialog {...defaultProps} isDirty={true} currentContent="My local content" />)

      await user.click(screen.getByRole('button', { name: 'Copy My Content' }))

      await waitFor(() => {
        expect(writeTextMock).toHaveBeenCalledWith('My local content')
      })
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

      render(<StaleDialog {...defaultProps} isDirty={true} currentContent="My local content" />)

      await user.click(screen.getByRole('button', { name: 'Copy My Content' }))

      await waitFor(() => {
        expect(screen.getByText('Failed')).toBeInTheDocument()
      })
    })
  })

  describe('interactions', () => {
    it('should call onLoadServerVersion when Load Server Version button is clicked', async () => {
      const onLoadServerVersion = vi.fn()
      render(<StaleDialog {...defaultProps} onLoadServerVersion={onLoadServerVersion} />)

      await userEvent.click(screen.getByRole('button', { name: 'Load Server Version' }))

      expect(onLoadServerVersion).toHaveBeenCalledTimes(1)
    })

    it('should call onContinueEditing when Continue Editing button is clicked', async () => {
      const onContinueEditing = vi.fn()
      render(<StaleDialog {...defaultProps} onContinueEditing={onContinueEditing} />)

      await userEvent.click(screen.getByRole('button', { name: 'Continue Editing' }))

      expect(onContinueEditing).toHaveBeenCalledTimes(1)
    })

    it('should not show close button (user must choose an action)', () => {
      render(<StaleDialog {...defaultProps} />)

      // Modal's close button should not be rendered
      expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
    })

    it('should not call onContinueEditing when Escape key is pressed', async () => {
      const onContinueEditing = vi.fn()
      render(<StaleDialog {...defaultProps} onContinueEditing={onContinueEditing} />)

      await userEvent.keyboard('{Escape}')

      expect(onContinueEditing).not.toHaveBeenCalled()
    })
  })

  describe('button styling', () => {
    it('should have primary styling on Load Server Version button', () => {
      render(<StaleDialog {...defaultProps} />)

      const button = screen.getByRole('button', { name: 'Load Server Version' })
      expect(button.className).toContain('btn-primary')
    })

    it('should have secondary styling on Continue Editing button', () => {
      render(<StaleDialog {...defaultProps} />)

      const button = screen.getByRole('button', { name: 'Continue Editing' })
      expect(button.className).toContain('btn-secondary')
    })
  })

  describe('button types', () => {
    it('should have type="button" on all buttons to prevent form submission', () => {
      render(<StaleDialog {...defaultProps} />)

      const loadButton = screen.getByRole('button', { name: 'Load Server Version' })
      const continueButton = screen.getByRole('button', { name: 'Continue Editing' })

      expect(loadButton).toHaveAttribute('type', 'button')
      expect(continueButton).toHaveAttribute('type', 'button')
    })
  })

  describe('helper text', () => {
    it('should show helper text for Load Server Version', () => {
      render(<StaleDialog {...defaultProps} />)

      expect(screen.getByText('Discard your changes and load the latest version')).toBeInTheDocument()
    })

    it('should show helper text for Continue Editing', () => {
      render(<StaleDialog {...defaultProps} />)

      expect(screen.getByText('Keep your current content and continue editing')).toBeInTheDocument()
    })
  })
})

describe('DeletedDialog', () => {
  const defaultProps = {
    isOpen: true,
    entityType: 'note' as const,
    onGoBack: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('should render dialog when isOpen is true', () => {
      render(<DeletedDialog {...defaultProps} />)

      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByText('This note was deleted')).toBeInTheDocument()
    })

    it('should not render dialog when isOpen is false', () => {
      render(<DeletedDialog {...defaultProps} isOpen={false} />)

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('should render Go Back button', () => {
      render(<DeletedDialog {...defaultProps} />)

      expect(screen.getByRole('button', { name: 'Go Back' })).toBeInTheDocument()
    })

    it('should show entity type in header for note', () => {
      render(<DeletedDialog {...defaultProps} entityType="note" />)

      expect(screen.getByText('This note was deleted')).toBeInTheDocument()
    })

    it('should show entity type in header for bookmark', () => {
      render(<DeletedDialog {...defaultProps} entityType="bookmark" />)

      expect(screen.getByText('This bookmark was deleted')).toBeInTheDocument()
    })

    it('should show entity type in header for prompt', () => {
      render(<DeletedDialog {...defaultProps} entityType="prompt" />)

      expect(screen.getByText('This prompt was deleted')).toBeInTheDocument()
    })

    it('should show description text', () => {
      render(<DeletedDialog {...defaultProps} />)

      expect(screen.getByText('This note was deleted in another tab or device.')).toBeInTheDocument()
    })
  })

  describe('interactions', () => {
    it('should call onGoBack when Go Back button is clicked', async () => {
      const onGoBack = vi.fn()
      render(<DeletedDialog {...defaultProps} onGoBack={onGoBack} />)

      await userEvent.click(screen.getByRole('button', { name: 'Go Back' }))

      expect(onGoBack).toHaveBeenCalledTimes(1)
    })

    it('should call onGoBack when close button is clicked', async () => {
      const onGoBack = vi.fn()
      render(<DeletedDialog {...defaultProps} onGoBack={onGoBack} />)

      // Modal's close button
      await userEvent.click(screen.getByRole('button', { name: 'Close' }))

      expect(onGoBack).toHaveBeenCalledTimes(1)
    })

    it('should call onGoBack when Escape key is pressed', async () => {
      const onGoBack = vi.fn()
      render(<DeletedDialog {...defaultProps} onGoBack={onGoBack} />)

      await userEvent.keyboard('{Escape}')

      expect(onGoBack).toHaveBeenCalledTimes(1)
    })
  })

  describe('button styling', () => {
    it('should have primary styling on Go Back button', () => {
      render(<DeletedDialog {...defaultProps} />)

      const button = screen.getByRole('button', { name: 'Go Back' })
      expect(button.className).toContain('btn-primary')
    })
  })
})
