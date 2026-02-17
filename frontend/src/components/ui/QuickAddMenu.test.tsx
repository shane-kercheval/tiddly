/**
 * Tests for QuickAddMenu component.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QuickAddMenu } from './QuickAddMenu'

describe('QuickAddMenu', () => {
  const defaultProps = {
    onAddBookmark: vi.fn(),
    onAddNote: vi.fn(),
    onAddPrompt: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('default behavior (both content types)', () => {
    it('renders dropdown trigger button', () => {
      render(<QuickAddMenu {...defaultProps} />)

      const trigger = screen.getByTestId('quick-add-menu-trigger')
      expect(trigger).toBeInTheDocument()
      expect(trigger).toHaveAttribute('aria-label', 'Add new item')
    })

    it('dropdown is closed initially', () => {
      render(<QuickAddMenu {...defaultProps} />)

      expect(screen.queryByTestId('quick-add-menu-dropdown')).not.toBeInTheDocument()
    })

    it('opens dropdown on click', () => {
      render(<QuickAddMenu {...defaultProps} />)

      fireEvent.click(screen.getByTestId('quick-add-menu-trigger'))

      expect(screen.getByTestId('quick-add-menu-dropdown')).toBeInTheDocument()
      expect(screen.getByTestId('quick-add-bookmark')).toBeInTheDocument()
      expect(screen.getByTestId('quick-add-note')).toBeInTheDocument()
    })

    it('closes dropdown on second click', () => {
      render(<QuickAddMenu {...defaultProps} />)

      const trigger = screen.getByTestId('quick-add-menu-trigger')
      fireEvent.click(trigger) // Open
      fireEvent.click(trigger) // Close

      expect(screen.queryByTestId('quick-add-menu-dropdown')).not.toBeInTheDocument()
    })

    it('calls onAddBookmark and closes dropdown when bookmark option clicked', () => {
      const onAddBookmark = vi.fn()
      render(<QuickAddMenu {...defaultProps} onAddBookmark={onAddBookmark} />)

      fireEvent.click(screen.getByTestId('quick-add-menu-trigger'))
      fireEvent.click(screen.getByTestId('quick-add-bookmark'))

      expect(onAddBookmark).toHaveBeenCalledTimes(1)
      expect(screen.queryByTestId('quick-add-menu-dropdown')).not.toBeInTheDocument()
    })

    it('calls onAddNote and closes dropdown when note option clicked', () => {
      const onAddNote = vi.fn()
      render(<QuickAddMenu {...defaultProps} onAddNote={onAddNote} />)

      fireEvent.click(screen.getByTestId('quick-add-menu-trigger'))
      fireEvent.click(screen.getByTestId('quick-add-note'))

      expect(onAddNote).toHaveBeenCalledTimes(1)
      expect(screen.queryByTestId('quick-add-menu-dropdown')).not.toBeInTheDocument()
    })

    it('sets aria-expanded correctly', () => {
      render(<QuickAddMenu {...defaultProps} />)

      const trigger = screen.getByTestId('quick-add-menu-trigger')
      expect(trigger).toHaveAttribute('aria-expanded', 'false')

      fireEvent.click(trigger)
      expect(trigger).toHaveAttribute('aria-expanded', 'true')
    })
  })

  describe('explicit contentTypes with both types', () => {
    it('shows both options when contentTypes includes both', () => {
      render(<QuickAddMenu {...defaultProps} contentTypes={['bookmark', 'note']} />)

      fireEvent.click(screen.getByTestId('quick-add-menu-trigger'))

      expect(screen.getByTestId('quick-add-bookmark')).toBeInTheDocument()
      expect(screen.getByTestId('quick-add-note')).toBeInTheDocument()
    })
  })

  describe('single content type: bookmark only', () => {
    it('renders direct button without dropdown', () => {
      render(<QuickAddMenu {...defaultProps} contentTypes={['bookmark']} />)

      expect(screen.getByTestId('quick-add-single')).toBeInTheDocument()
      expect(screen.queryByTestId('quick-add-menu-trigger')).not.toBeInTheDocument()
    })

    it('has correct title for bookmark', () => {
      render(<QuickAddMenu {...defaultProps} contentTypes={['bookmark']} />)

      expect(screen.getByTestId('quick-add-single')).toHaveAttribute('title', 'Add bookmark')
    })

    it('calls onAddBookmark directly on click', () => {
      const onAddBookmark = vi.fn()
      render(<QuickAddMenu {...defaultProps} onAddBookmark={onAddBookmark} contentTypes={['bookmark']} />)

      fireEvent.click(screen.getByTestId('quick-add-single'))

      expect(onAddBookmark).toHaveBeenCalledTimes(1)
    })

    it('does not call onAddNote', () => {
      const onAddNote = vi.fn()
      render(<QuickAddMenu {...defaultProps} onAddNote={onAddNote} contentTypes={['bookmark']} />)

      fireEvent.click(screen.getByTestId('quick-add-single'))

      expect(onAddNote).not.toHaveBeenCalled()
    })
  })

  describe('single content type: note only', () => {
    it('renders direct button without dropdown', () => {
      render(<QuickAddMenu {...defaultProps} contentTypes={['note']} />)

      expect(screen.getByTestId('quick-add-single')).toBeInTheDocument()
      expect(screen.queryByTestId('quick-add-menu-trigger')).not.toBeInTheDocument()
    })

    it('has correct title for note', () => {
      render(<QuickAddMenu {...defaultProps} contentTypes={['note']} />)

      expect(screen.getByTestId('quick-add-single')).toHaveAttribute('title', 'Add note')
    })

    it('calls onAddNote directly on click', () => {
      const onAddNote = vi.fn()
      render(<QuickAddMenu {...defaultProps} onAddNote={onAddNote} contentTypes={['note']} />)

      fireEvent.click(screen.getByTestId('quick-add-single'))

      expect(onAddNote).toHaveBeenCalledTimes(1)
    })

    it('does not call onAddBookmark', () => {
      const onAddBookmark = vi.fn()
      render(<QuickAddMenu {...defaultProps} onAddBookmark={onAddBookmark} contentTypes={['note']} />)

      fireEvent.click(screen.getByTestId('quick-add-single'))

      expect(onAddBookmark).not.toHaveBeenCalled()
    })
  })

  describe('keyboard interaction', () => {
    it('closes dropdown on Escape key', () => {
      render(<QuickAddMenu {...defaultProps} />)

      fireEvent.click(screen.getByTestId('quick-add-menu-trigger'))
      expect(screen.getByTestId('quick-add-menu-dropdown')).toBeInTheDocument()

      fireEvent.keyDown(document, { key: 'Escape' })

      expect(screen.queryByTestId('quick-add-menu-dropdown')).not.toBeInTheDocument()
    })
  })

  describe('click outside', () => {
    it('closes dropdown when clicking outside', () => {
      render(
        <div>
          <QuickAddMenu {...defaultProps} />
          <button data-testid="outside">Outside</button>
        </div>
      )

      fireEvent.click(screen.getByTestId('quick-add-menu-trigger'))
      expect(screen.getByTestId('quick-add-menu-dropdown')).toBeInTheDocument()

      fireEvent.mouseDown(screen.getByTestId('outside'))

      expect(screen.queryByTestId('quick-add-menu-dropdown')).not.toBeInTheDocument()
    })
  })
})
