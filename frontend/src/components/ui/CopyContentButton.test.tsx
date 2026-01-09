/**
 * Tests for CopyContentButton component.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { CopyContentButton } from './CopyContentButton'

// Mock the hooks
const mockFetchNote = vi.fn()
const mockFetchPrompt = vi.fn()

vi.mock('../../hooks/useNotes', () => ({
  useNotes: () => ({
    fetchNote: mockFetchNote,
  }),
}))

vi.mock('../../hooks/usePrompts', () => ({
  usePrompts: () => ({
    fetchPrompt: mockFetchPrompt,
  }),
}))

// Mock clipboard API
const mockWriteText = vi.fn()
Object.assign(navigator, {
  clipboard: {
    writeText: mockWriteText,
  },
})

// Helper to flush promises and advance timers
async function flushPromisesAndTimers(ms: number = 0): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    if (ms > 0) {
      vi.advanceTimersByTime(ms)
    }
  })
}

describe('CopyContentButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockWriteText.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('initial state', () => {
    it('renders copy icon for notes', () => {
      render(<CopyContentButton contentType="note" id="123" />)

      const button = screen.getByRole('button')
      expect(button).toBeInTheDocument()
      expect(button).toHaveAttribute('title', 'Copy note content')
    })

    it('renders copy icon for prompts', () => {
      render(<CopyContentButton contentType="prompt" id="456" />)

      const button = screen.getByRole('button')
      expect(button).toHaveAttribute('title', 'Copy prompt content')
    })

    it('applies custom className', () => {
      render(<CopyContentButton contentType="note" id="123" className="ml-4" />)

      expect(screen.getByRole('button').className).toContain('ml-4')
    })
  })

  describe('fetching and copying note content', () => {
    it('fetches note and copies content to clipboard', async () => {
      mockFetchNote.mockResolvedValue({ content: 'Test note content' })

      render(<CopyContentButton contentType="note" id="note-123" />)

      fireEvent.click(screen.getByRole('button'))
      await flushPromisesAndTimers()

      expect(mockFetchNote).toHaveBeenCalledWith('note-123')
      expect(mockWriteText).toHaveBeenCalledWith('Test note content')
    })

    it('shows success state after copying', async () => {
      mockFetchNote.mockResolvedValue({ content: 'Test content' })

      render(<CopyContentButton contentType="note" id="123" />)

      fireEvent.click(screen.getByRole('button'))
      await flushPromisesAndTimers()

      expect(screen.getByRole('button')).toHaveAttribute('title', 'Copied!')
    })
  })

  describe('fetching and copying prompt content', () => {
    it('fetches prompt and copies content to clipboard', async () => {
      mockFetchPrompt.mockResolvedValue({ content: 'Test prompt content' })

      render(<CopyContentButton contentType="prompt" id="prompt-456" />)

      fireEvent.click(screen.getByRole('button'))
      await flushPromisesAndTimers()

      expect(mockFetchPrompt).toHaveBeenCalledWith('prompt-456')
      expect(mockWriteText).toHaveBeenCalledWith('Test prompt content')
    })
  })

  describe('loading state', () => {
    it('shows loading state during fetch', async () => {
      // Create a promise that we can control
      let resolvePromise: (value: { content: string }) => void
      mockFetchNote.mockReturnValue(
        new Promise((resolve) => {
          resolvePromise = resolve
        })
      )

      render(<CopyContentButton contentType="note" id="123" />)

      fireEvent.click(screen.getByRole('button'))

      // Should show loading immediately
      expect(screen.getByRole('button')).toHaveAttribute('title', 'Copying...')
      expect(screen.getByRole('button')).toBeDisabled()

      // Resolve and cleanup
      resolvePromise!({ content: 'test' })
      await flushPromisesAndTimers()
    })

    it('prevents double-clicks during loading', async () => {
      let resolvePromise: (value: { content: string }) => void
      mockFetchNote.mockReturnValue(
        new Promise((resolve) => {
          resolvePromise = resolve
        })
      )

      render(<CopyContentButton contentType="note" id="123" />)

      fireEvent.click(screen.getByRole('button'))
      fireEvent.click(screen.getByRole('button'))
      fireEvent.click(screen.getByRole('button'))

      // Should only fetch once
      expect(mockFetchNote).toHaveBeenCalledTimes(1)

      // Cleanup
      resolvePromise!({ content: 'test' })
      await flushPromisesAndTimers()
    })
  })

  describe('error states', () => {
    it('shows error state when fetch fails', async () => {
      mockFetchNote.mockRejectedValue(new Error('Network error'))

      render(<CopyContentButton contentType="note" id="123" />)

      fireEvent.click(screen.getByRole('button'))
      await flushPromisesAndTimers()

      expect(screen.getByRole('button')).toHaveAttribute('title', 'Failed to copy')
    })

    it('shows error state when content is null', async () => {
      mockFetchNote.mockResolvedValue({ content: null })

      render(<CopyContentButton contentType="note" id="123" />)

      fireEvent.click(screen.getByRole('button'))
      await flushPromisesAndTimers()

      expect(screen.getByRole('button')).toHaveAttribute('title', 'Failed to copy')
      expect(mockWriteText).not.toHaveBeenCalled()
    })

    it('shows error state when clipboard write fails', async () => {
      mockFetchNote.mockResolvedValue({ content: 'Test content' })
      mockWriteText.mockRejectedValue(new Error('Clipboard error'))

      render(<CopyContentButton contentType="note" id="123" />)

      fireEvent.click(screen.getByRole('button'))
      await flushPromisesAndTimers()

      expect(screen.getByRole('button')).toHaveAttribute('title', 'Failed to copy')
    })
  })

  describe('state reset', () => {
    it('resets to idle after success feedback duration', async () => {
      mockFetchNote.mockResolvedValue({ content: 'Test content' })

      render(<CopyContentButton contentType="note" id="123" />)

      fireEvent.click(screen.getByRole('button'))
      await flushPromisesAndTimers()

      expect(screen.getByRole('button')).toHaveAttribute('title', 'Copied!')

      // Fast-forward past feedback duration (2000ms)
      await flushPromisesAndTimers(2001)

      expect(screen.getByRole('button')).toHaveAttribute('title', 'Copy note content')
    })

    it('resets to idle after error feedback duration', async () => {
      mockFetchNote.mockRejectedValue(new Error('Network error'))

      render(<CopyContentButton contentType="note" id="123" />)

      fireEvent.click(screen.getByRole('button'))
      await flushPromisesAndTimers()

      expect(screen.getByRole('button')).toHaveAttribute('title', 'Failed to copy')

      // Fast-forward past feedback duration
      await flushPromisesAndTimers(2001)

      expect(screen.getByRole('button')).toHaveAttribute('title', 'Copy note content')
    })
  })

  describe('event propagation', () => {
    it('stops click propagation to parent elements', async () => {
      mockFetchNote.mockResolvedValue({ content: 'Test content' })
      const parentClickHandler = vi.fn()

      render(
        <div onClick={parentClickHandler}>
          <CopyContentButton contentType="note" id="123" />
        </div>
      )

      fireEvent.click(screen.getByRole('button'))
      await flushPromisesAndTimers()

      expect(parentClickHandler).not.toHaveBeenCalled()
    })
  })
})
