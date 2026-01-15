/**
 * Tests for the unified Prompt component.
 *
 * Uses shared test factory for common content component behaviors,
 * plus Prompt-specific tests for unique functionality.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Prompt } from './Prompt'
import { createContentComponentTests } from './__tests__/createContentComponentTests'
import type { Prompt as PromptType, TagCount } from '../types'

// Mock CodeMirrorEditor - now the default editor
vi.mock('./CodeMirrorEditor', () => ({
  CodeMirrorEditor: ({ value, onChange, placeholder, disabled }: {
    value: string
    onChange: (value: string) => void
    placeholder?: string
    disabled?: boolean
  }) => (
    <textarea
      data-testid="content-editor"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
    />
  ),
}))

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key]
    }),
    clear: vi.fn(() => {
      store = {}
    }),
  }
})()
Object.defineProperty(window, 'localStorage', { value: localStorageMock })

// Mock prompt data
const mockPrompt: PromptType = {
  id: 'prompt-1',
  name: 'test-prompt',
  title: 'Test Prompt',
  description: 'Test description',
  content: '# Hello World\n\nThis is a test prompt.',
  arguments: [],
  tags: ['test', 'example'],
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-02T00:00:00Z',
  last_used_at: '2024-01-02T00:00:00Z',
  deleted_at: null,
  archived_at: null,
}

const mockDeletedPrompt: PromptType = {
  ...mockPrompt,
  deleted_at: '2024-01-03T00:00:00Z',
}

const mockArchivedPrompt: PromptType = {
  ...mockPrompt,
  archived_at: '2024-01-03T00:00:00Z',
}

const mockTagSuggestions: TagCount[] = [
  { name: 'test', count: 5 },
  { name: 'example', count: 3 },
  { name: 'javascript', count: 10 },
]

// Run shared content component tests
createContentComponentTests({
  componentName: 'Prompt',
  Component: Prompt,
  mockItem: mockPrompt,
  mockDeletedItem: mockDeletedPrompt,
  mockArchivedItem: mockArchivedPrompt,
  mockTagSuggestions,
  placeholders: {
    primaryField: 'prompt-name',
  },
  getPrimaryFieldValue: (prompt) => prompt.name,
  buildProps: ({ item, onSave, onClose, onArchive, onUnarchive, onDelete, viewState, isSaving }) => ({
    prompt: item,
    tagSuggestions: mockTagSuggestions,
    onSave,
    onClose,
    onArchive,
    onUnarchive,
    onDelete,
    viewState,
    isSaving,
  }),
  // Prompt derives dirty state from props, so we need to simulate parent update after save
  createUpdatedItem: (prompt, newName) => ({ ...prompt, name: newName }),
  // Prompt names must be lowercase-hyphen format (no spaces or uppercase)
  testUpdateValue: 'updated-value',
})

// Prompt-specific tests
describe('Prompt component - specific behaviors', () => {
  const mockOnSave = vi.fn()
  const mockOnClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMock.clear()
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('name field', () => {
    it('should render prompt name', () => {
      render(
        <Prompt
          prompt={mockPrompt}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      expect(screen.getByDisplayValue('test-prompt')).toBeInTheDocument()
    })

    it('should auto-lowercase name input', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      render(
        <Prompt
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      await user.type(screen.getByPlaceholderText('prompt-name'), 'MY-PROMPT')

      expect(screen.getByDisplayValue('my-prompt')).toBeInTheDocument()
    })

    it('should disable Create button when name format is invalid', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      render(
        <Prompt
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      // Enter invalid name (underscores not allowed, must use hyphens)
      await user.type(screen.getByPlaceholderText('prompt-name'), 'invalid_name')

      // Enter content
      const contentEditor = screen.getByTestId('content-editor')
      await user.clear(contentEditor)
      await user.type(contentEditor, 'Some content')

      // Create button should be disabled because name is invalid
      expect(screen.getByText('Create').closest('button')).toBeDisabled()
    })
  })

  describe('title field (optional)', () => {
    it('should render prompt title', () => {
      render(
        <Prompt
          prompt={mockPrompt}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      expect(screen.getByDisplayValue('Test Prompt')).toBeInTheDocument()
    })

    it('should show title placeholder', () => {
      render(
        <Prompt
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      expect(screen.getByPlaceholderText('Display title (optional)')).toBeInTheDocument()
    })
  })

  describe('content field (required)', () => {
    it('should require content for new prompts', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      render(
        <Prompt
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      // Enter name but leave content empty
      await user.type(screen.getByPlaceholderText('prompt-name'), 'my-prompt')

      // Clear default content
      const contentEditor = screen.getByTestId('content-editor')
      await user.clear(contentEditor)

      // Create button should be disabled (content required)
      expect(screen.getByText('Create').closest('button')).toBeDisabled()
    })
  })

  describe('timestamps', () => {
    it('should not show timestamps for new prompt', () => {
      render(
        <Prompt
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      expect(screen.queryByText(/Created/)).not.toBeInTheDocument()
      expect(screen.queryByText(/Updated/)).not.toBeInTheDocument()
    })

    it('should show timestamps for existing prompt', () => {
      render(
        <Prompt
          prompt={mockPrompt}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      expect(screen.getByText(/Created/)).toBeInTheDocument()
      expect(screen.getByText(/Updated/)).toBeInTheDocument()
    })
  })

  describe('arguments', () => {
    it('should render arguments builder', () => {
      render(
        <Prompt
          prompt={mockPrompt}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      // Arguments section should be present
      expect(screen.getByText('Arguments')).toBeInTheDocument()
    })

    it('should show existing arguments', () => {
      const promptWithArgs: PromptType = {
        ...mockPrompt,
        arguments: [
          { name: 'code_to_review', description: 'The code to review', required: true },
        ],
      }

      render(
        <Prompt
          prompt={promptWithArgs}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      expect(screen.getByDisplayValue('code_to_review')).toBeInTheDocument()
    })
  })

  describe('tags', () => {
    it('should render prompt tags', () => {
      render(
        <Prompt
          prompt={mockPrompt}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      expect(screen.getByText('test')).toBeInTheDocument()
      expect(screen.getByText('example')).toBeInTheDocument()
    })

    it('should populate initial tags from props', () => {
      render(
        <Prompt
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
          initialTags={['preset-tag']}
        />
      )

      expect(screen.getByText('preset-tag')).toBeInTheDocument()
    })
  })

  describe('save with only changed fields', () => {
    it('should call onSave with only changed fields for existing prompt', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      mockOnSave.mockResolvedValue(undefined)

      render(
        <Prompt
          prompt={mockPrompt}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      await user.clear(screen.getByDisplayValue('test-prompt'))
      await user.type(screen.getByPlaceholderText('prompt-name'), 'updated-prompt')

      await user.click(screen.getByText('Save'))

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith({
          name: 'updated-prompt',
        })
      })
    })
  })

  describe('fullWidth prop', () => {
    it('should apply max-w-4xl when fullWidth is false', () => {
      const { container } = render(
        <Prompt
          prompt={mockPrompt}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
          fullWidth={false}
        />
      )

      expect(container.querySelector('form')).toHaveClass('max-w-4xl')
    })

    it('should not apply max-w-4xl when fullWidth is true', () => {
      const { container } = render(
        <Prompt
          prompt={mockPrompt}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
          fullWidth={true}
        />
      )

      expect(container.querySelector('form')).not.toHaveClass('max-w-4xl')
    })
  })
})
