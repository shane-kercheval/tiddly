/**
 * Tests for PromptView component.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PromptView } from './PromptView'
import type { Prompt } from '../types'

const mockPrompt: Prompt = {
  id: '1',
  name: 'code-review',
  title: 'Code Review Template',
  description: 'A prompt for reviewing code',
  content: '# Review\n\nPlease review {{ code }}',
  arguments: [
    { name: 'code', description: 'The code to review', required: true },
    { name: 'language', description: 'Programming language', required: false },
  ],
  tags: ['code', 'review'],
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-02T00:00:00Z',
  last_used_at: '2024-01-03T00:00:00Z',
  deleted_at: null,
  archived_at: null,
}

describe('PromptView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('rendering', () => {
    it('should render prompt title', () => {
      render(<PromptView prompt={mockPrompt} />)

      expect(screen.getByText('Code Review Template')).toBeInTheDocument()
    })

    it('should render prompt name when different from title', () => {
      render(<PromptView prompt={mockPrompt} />)

      expect(screen.getByText('code-review')).toBeInTheDocument()
    })

    it('should render name as title when no title provided', () => {
      const promptWithoutTitle = { ...mockPrompt, title: null }
      render(<PromptView prompt={promptWithoutTitle} />)

      expect(screen.getByRole('heading', { name: 'code-review' })).toBeInTheDocument()
    })

    it('should render description', () => {
      render(<PromptView prompt={mockPrompt} />)

      expect(screen.getByText('A prompt for reviewing code')).toBeInTheDocument()
    })

    it('should render required arguments with label', () => {
      render(<PromptView prompt={mockPrompt} />)

      // Find the required argument label text within the arguments section
      expect(screen.getByText('(required)')).toBeInTheDocument()
      expect(screen.getByText('— The code to review')).toBeInTheDocument()
    })

    it('should render optional arguments with label', () => {
      render(<PromptView prompt={mockPrompt} />)

      expect(screen.getByText('language')).toBeInTheDocument()
      expect(screen.getByText('(optional)')).toBeInTheDocument()
    })

    it('should render tags', () => {
      render(<PromptView prompt={mockPrompt} />)

      // Use title attribute to find tag buttons specifically
      expect(screen.getByTitle('Filter by tag: code')).toBeInTheDocument()
      expect(screen.getByTitle('Filter by tag: review')).toBeInTheDocument()
    })

    it('should not show arguments section when no arguments', () => {
      const promptWithoutArgs = { ...mockPrompt, arguments: [] }
      render(<PromptView prompt={promptWithoutArgs} />)

      expect(screen.queryByText('Arguments:')).not.toBeInTheDocument()
    })
  })

  describe('action buttons - active view', () => {
    it('should show edit button in active view', () => {
      const onEdit = vi.fn()
      render(<PromptView prompt={mockPrompt} view="active" onEdit={onEdit} />)

      expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument()
    })

    it('should show archive button in active view', () => {
      const onArchive = vi.fn()
      render(<PromptView prompt={mockPrompt} view="active" onArchive={onArchive} />)

      expect(screen.getByRole('button', { name: /archive/i })).toBeInTheDocument()
    })

    it('should show delete button', () => {
      const onDelete = vi.fn()
      render(<PromptView prompt={mockPrompt} view="active" onDelete={onDelete} />)

      expect(screen.getByRole('button', { name: /delete$/i })).toBeInTheDocument()
    })

    it('should call onEdit when edit button clicked', async () => {
      const onEdit = vi.fn()
      const user = userEvent.setup()

      render(<PromptView prompt={mockPrompt} view="active" onEdit={onEdit} />)

      await user.click(screen.getByRole('button', { name: /edit/i }))
      expect(onEdit).toHaveBeenCalled()
    })

    it('should call onArchive when archive button clicked', async () => {
      const onArchive = vi.fn()
      const user = userEvent.setup()

      render(<PromptView prompt={mockPrompt} view="active" onArchive={onArchive} />)

      await user.click(screen.getByRole('button', { name: /archive/i }))
      expect(onArchive).toHaveBeenCalled()
    })
  })

  describe('action buttons - archived view', () => {
    it('should show restore button in archived view', () => {
      const onUnarchive = vi.fn()
      render(<PromptView prompt={mockPrompt} view="archived" onUnarchive={onUnarchive} />)

      expect(screen.getByRole('button', { name: /restore/i })).toBeInTheDocument()
    })

    it('should not show archive button in archived view', () => {
      const onArchive = vi.fn()
      render(<PromptView prompt={mockPrompt} view="archived" onArchive={onArchive} />)

      expect(screen.queryByRole('button', { name: /archive/i })).not.toBeInTheDocument()
    })

    it('should still show edit button in archived view', () => {
      const onEdit = vi.fn()
      render(<PromptView prompt={mockPrompt} view="archived" onEdit={onEdit} />)

      expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument()
    })
  })

  describe('action buttons - deleted view', () => {
    it('should show restore button in deleted view', () => {
      const onRestore = vi.fn()
      render(<PromptView prompt={mockPrompt} view="deleted" onRestore={onRestore} />)

      expect(screen.getByRole('button', { name: /restore/i })).toBeInTheDocument()
    })

    it('should not show edit button in deleted view', () => {
      const onEdit = vi.fn()
      render(<PromptView prompt={mockPrompt} view="deleted" onEdit={onEdit} />)

      expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument()
    })

    it('should show delete permanently button in deleted view', () => {
      const onDelete = vi.fn()
      render(<PromptView prompt={mockPrompt} view="deleted" onDelete={onDelete} />)

      expect(screen.getByRole('button', { name: /delete permanently/i })).toBeInTheDocument()
    })
  })

  describe('close/back button', () => {
    it('should show close button when onBack provided', () => {
      const onBack = vi.fn()
      render(<PromptView prompt={mockPrompt} onBack={onBack} />)

      expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument()
    })

    it('should call onBack when close button clicked', async () => {
      const onBack = vi.fn()
      const user = userEvent.setup()

      render(<PromptView prompt={mockPrompt} onBack={onBack} />)

      await user.click(screen.getByRole('button', { name: /close/i }))
      expect(onBack).toHaveBeenCalled()
    })
  })

  describe('tag clicks', () => {
    it('should call onTagClick when tag is clicked', async () => {
      const onTagClick = vi.fn()
      const user = userEvent.setup()

      render(<PromptView prompt={mockPrompt} onTagClick={onTagClick} />)

      await user.click(screen.getByTitle('Filter by tag: code'))
      expect(onTagClick).toHaveBeenCalledWith('code')
    })
  })

  describe('keyboard shortcuts', () => {
    it('should call onEdit when "e" is pressed', () => {
      const onEdit = vi.fn()
      render(<PromptView prompt={mockPrompt} onEdit={onEdit} />)

      fireEvent.keyDown(document, { key: 'e' })

      expect(onEdit).toHaveBeenCalled()
    })

    it('should call onBack when Escape is pressed', () => {
      const onBack = vi.fn()
      render(<PromptView prompt={mockPrompt} onBack={onBack} />)

      fireEvent.keyDown(document, { key: 'Escape' })

      expect(onBack).toHaveBeenCalled()
    })

    it('should not call onEdit when "e" is pressed with modifier', () => {
      const onEdit = vi.fn()
      render(<PromptView prompt={mockPrompt} onEdit={onEdit} />)

      fireEvent.keyDown(document, { key: 'e', metaKey: true })
      expect(onEdit).not.toHaveBeenCalled()

      fireEvent.keyDown(document, { key: 'e', ctrlKey: true })
      expect(onEdit).not.toHaveBeenCalled()

      fireEvent.keyDown(document, { key: 'e', altKey: true })
      expect(onEdit).not.toHaveBeenCalled()
    })

    it('should not trigger shortcuts when focus is in input', () => {
      const onEdit = vi.fn()
      const onBack = vi.fn()
      render(
        <div>
          <input data-testid="test-input" type="text" />
          <PromptView prompt={mockPrompt} onEdit={onEdit} onBack={onBack} />
        </div>
      )

      const input = screen.getByTestId('test-input')
      input.focus()

      // Simulate document.activeElement being the input
      Object.defineProperty(document, 'activeElement', {
        get: () => input,
        configurable: true,
      })

      fireEvent.keyDown(document, { key: 'e' })
      expect(onEdit).not.toHaveBeenCalled()

      fireEvent.keyDown(document, { key: 'Escape' })
      expect(onBack).not.toHaveBeenCalled()
    })

    it('should not trigger shortcuts when focus is in textarea', () => {
      const onEdit = vi.fn()
      render(
        <div>
          <textarea data-testid="test-textarea" />
          <PromptView prompt={mockPrompt} onEdit={onEdit} />
        </div>
      )

      const textarea = screen.getByTestId('test-textarea')
      textarea.focus()

      // Simulate document.activeElement being the textarea
      Object.defineProperty(document, 'activeElement', {
        get: () => textarea,
        configurable: true,
      })

      fireEvent.keyDown(document, { key: 'e' })
      expect(onEdit).not.toHaveBeenCalled()
    })

    it('should not call onEdit if handler not provided', () => {
      // Should not throw when onEdit is not provided
      render(<PromptView prompt={mockPrompt} />)

      expect(() => {
        fireEvent.keyDown(document, { key: 'e' })
      }).not.toThrow()
    })

    it('should not call onBack if handler not provided', () => {
      // Should not throw when onBack is not provided
      render(<PromptView prompt={mockPrompt} />)

      expect(() => {
        fireEvent.keyDown(document, { key: 'Escape' })
      }).not.toThrow()
    })
  })

  describe('layout', () => {
    it('should apply max-w-4xl by default', () => {
      const { container } = render(<PromptView prompt={mockPrompt} />)

      expect(container.firstChild).toHaveClass('max-w-4xl')
    })

    it('should not apply max-w-4xl when fullWidth is true', () => {
      const { container } = render(<PromptView prompt={mockPrompt} fullWidth />)

      expect(container.firstChild).not.toHaveClass('max-w-4xl')
    })
  })
})
