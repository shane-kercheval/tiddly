/**
 * Tests for the unified Prompt component.
 *
 * Uses shared test factory for common content component behaviors,
 * plus Prompt-specific tests for unique functionality.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { useRef } from 'react'
import userEvent from '@testing-library/user-event'
import axios from 'axios'
import { Prompt } from './Prompt'
import { createContentComponentTests } from './__tests__/createContentComponentTests'
import type { Prompt as PromptType, TagCount } from '../types'

// Mock axios.isAxiosError
vi.mock('axios', async () => {
  const actual = await vi.importActual('axios')
  return {
    ...actual,
    default: {
      ...(actual as { default: typeof axios }).default,
      isAxiosError: vi.fn(),
    },
  }
})

let editorInstanceCounter = 0

// Mock CodeMirrorEditor - now the default editor
vi.mock('./CodeMirrorEditor', () => ({
  CodeMirrorEditor: ({ value, onChange, placeholder, disabled }: {
    value: string
    onChange: (value: string) => void
    placeholder?: string
    disabled?: boolean
  }) => {
    const instanceRef = useRef<number | null>(null)
    if (instanceRef.current === null) {
      editorInstanceCounter += 1
      instanceRef.current = editorInstanceCounter
    }
    return (
      <textarea
        data-testid="content-editor"
        data-editor-instance={instanceRef.current}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
      />
    )
  },
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
  { name: 'test', content_count: 5, filter_count: 0 },
  { name: 'example', content_count: 3, filter_count: 0 },
  { name: 'javascript', content_count: 10, filter_count: 0 },
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
    editorInstanceCounter = 0
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
          expected_updated_at: '2024-01-02T00:00:00Z',
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

  describe('prop sync on refresh', () => {
    it('should update internal state when prompt prop updated_at changes', () => {
      const { rerender } = render(
        <Prompt
          prompt={mockPrompt}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      expect(screen.getByDisplayValue('test-prompt')).toBeInTheDocument()

      const updatedPrompt: PromptType = {
        ...mockPrompt,
        name: 'refreshed-prompt',
        updated_at: '2024-01-05T00:00:00Z',
      }

      rerender(
        <Prompt
          prompt={updatedPrompt}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      expect(screen.getByDisplayValue('refreshed-prompt')).toBeInTheDocument()
    })

    it('should not update internal state when prompt prop changes without updated_at change', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const { rerender } = render(
        <Prompt
          prompt={mockPrompt}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      await user.clear(screen.getByDisplayValue('test-prompt'))
      await user.type(screen.getByPlaceholderText('prompt-name'), 'my-local-edit')

      const samePrompt: PromptType = {
        ...mockPrompt,
      }

      rerender(
        <Prompt
          prompt={samePrompt}
          tagSuggestions={[]}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      expect(screen.getByDisplayValue('my-local-edit')).toBeInTheDocument()
    })

    it('should clear conflict state when prompt prop updated_at changes', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      vi.mocked(axios.isAxiosError).mockReturnValue(true)
      const error409 = new Error('Conflict') as Error & {
        response?: { status: number; data: { detail: { error: string; server_state: PromptType } } }
      }
      error409.response = {
        status: 409,
        data: {
          detail: {
            error: 'conflict',
            server_state: { ...mockPrompt, updated_at: '2024-01-03T00:00:00Z' },
          },
        },
      }
      mockOnSave.mockRejectedValue(error409)

      const { rerender } = render(
        <Prompt
          prompt={mockPrompt}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      await user.clear(screen.getByDisplayValue('test-prompt'))
      await user.type(screen.getByPlaceholderText('prompt-name'), 'my-edit')
      await user.click(screen.getByText('Save'))

      await waitFor(() => {
        expect(screen.getByText('Save Conflict')).toBeInTheDocument()
      })

      const refreshedPrompt: PromptType = {
        ...mockPrompt,
        name: 'server-prompt',
        updated_at: '2024-01-05T00:00:00Z',
      }

      rerender(
        <Prompt
          prompt={refreshedPrompt}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      expect(screen.queryByText('Save Conflict')).not.toBeInTheDocument()
      expect(screen.getByDisplayValue('server-prompt')).toBeInTheDocument()
    })
  })

  describe('load server version', () => {
    it('should remount editor when Load Server Version is clicked', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      vi.mocked(axios.isAxiosError).mockReturnValue(true)
      const error409 = new Error('Conflict') as Error & {
        response?: { status: number; data: { detail: { error: string; server_state: PromptType } } }
      }
      error409.response = {
        status: 409,
        data: {
          detail: {
            error: 'conflict',
            server_state: { ...mockPrompt, updated_at: '2024-01-03T00:00:00Z' },
          },
        },
      }
      mockOnSave.mockRejectedValue(error409)

      const refreshedPrompt: PromptType = {
        ...mockPrompt,
        content: 'Server content',
        updated_at: mockPrompt.updated_at,
      }
      const mockOnRefresh = vi.fn().mockResolvedValue(refreshedPrompt)

      render(
        <Prompt
          prompt={mockPrompt}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
          onRefresh={mockOnRefresh}
        />
      )

      const initialEditor = screen.getByTestId('content-editor')
      const initialInstance = initialEditor.getAttribute('data-editor-instance')

      await user.clear(screen.getByDisplayValue('test-prompt'))
      await user.type(screen.getByPlaceholderText('prompt-name'), 'my-edit')
      await user.click(screen.getByText('Save'))

      await waitFor(() => {
        expect(screen.getByText('Save Conflict')).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: 'Load Server Version' }))

      await waitFor(() => {
        expect(screen.getByDisplayValue('Server content')).toBeInTheDocument()
      })

      const refreshedEditor = screen.getByTestId('content-editor')
      const refreshedInstance = refreshedEditor.getAttribute('data-editor-instance')
      expect(refreshedInstance).not.toBe(initialInstance)
    })
  })

  describe('editor focus on save', () => {
    it('should keep focus on editor after Cmd+S save', async () => {
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

      const editor = screen.getByTestId('content-editor')
      editor.focus()
      expect(document.activeElement).toBe(editor)

      await user.type(editor, 'x')

      fireEvent.keyDown(document, { key: 's', metaKey: true })

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalled()
      })

      const editorAfterSave = screen.getByTestId('content-editor')
      expect(document.activeElement).toBe(editorAfterSave)
    })
  })

  describe('409 Conflict handling', () => {
    const create409Error = (): Error & { response?: { status: number; data: { detail: { error: string; server_state: PromptType } } } } => {
      const error = new Error('Conflict') as Error & { response?: { status: number; data: { detail: { error: string; server_state: PromptType } } } }
      error.response = {
        status: 409,
        data: {
          detail: {
            error: 'conflict',
            server_state: {
              ...mockPrompt,
              name: 'server-updated-prompt',
              updated_at: '2024-01-03T00:00:00Z',
            },
          },
        },
      }
      return error
    }

    beforeEach(() => {
      vi.mocked(axios.isAxiosError).mockReturnValue(true)
    })

    it('should show ConflictDialog when save returns 409', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      mockOnSave.mockRejectedValue(create409Error())

      render(
        <Prompt
          prompt={mockPrompt}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      // Make a change and save (prompts use name as primary field, must be lowercase-hyphen)
      await user.clear(screen.getByDisplayValue('test-prompt'))
      await user.type(screen.getByPlaceholderText('prompt-name'), 'my-new-prompt')
      await user.click(screen.getByText('Save'))

      // ConflictDialog should appear
      await waitFor(() => {
        expect(screen.getByText('Save Conflict')).toBeInTheDocument()
      })
      expect(screen.getByRole('button', { name: 'Load Server Version' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Save My Version' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Do Nothing' })).toBeInTheDocument()
    })

    it('should call onRefresh when Load Server Version is clicked', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      mockOnSave.mockRejectedValue(create409Error())
      const mockOnRefresh = vi.fn().mockResolvedValue(mockPrompt)

      render(
        <Prompt
          prompt={mockPrompt}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
          onRefresh={mockOnRefresh}
        />
      )

      // Make a change and save to trigger conflict
      await user.clear(screen.getByDisplayValue('test-prompt'))
      await user.type(screen.getByPlaceholderText('prompt-name'), 'my-new-prompt')
      await user.click(screen.getByText('Save'))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Load Server Version' })).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: 'Load Server Version' }))

      expect(mockOnRefresh).toHaveBeenCalledTimes(1)
    })

    it('should force save without expected_updated_at when Save My Version is clicked', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      // First call rejects with 409, second call succeeds
      mockOnSave.mockRejectedValueOnce(create409Error()).mockResolvedValueOnce(undefined)

      render(
        <Prompt
          prompt={mockPrompt}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      // Make a change and save to trigger conflict
      await user.clear(screen.getByDisplayValue('test-prompt'))
      await user.type(screen.getByPlaceholderText('prompt-name'), 'my-new-prompt')
      await user.click(screen.getByText('Save'))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Save My Version' })).toBeInTheDocument()
      })

      // First click shows confirmation
      await user.click(screen.getByRole('button', { name: 'Save My Version' }))
      expect(screen.getByRole('button', { name: 'Confirm Overwrite?' })).toBeInTheDocument()

      // Second click confirms and saves
      await user.click(screen.getByRole('button', { name: 'Confirm Overwrite?' }))

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledTimes(2)
      })

      // Second call should NOT include expected_updated_at (force save)
      const secondCall = mockOnSave.mock.calls[1][0]
      expect(secondCall).not.toHaveProperty('expected_updated_at')
      expect(secondCall).toHaveProperty('name', 'my-new-prompt')
    })

    it('should close ConflictDialog without action when Do Nothing is clicked', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      mockOnSave.mockRejectedValue(create409Error())

      render(
        <Prompt
          prompt={mockPrompt}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      // Make a change and save to trigger conflict
      await user.clear(screen.getByDisplayValue('test-prompt'))
      await user.type(screen.getByPlaceholderText('prompt-name'), 'my-new-prompt')
      await user.click(screen.getByText('Save'))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Do Nothing' })).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: 'Do Nothing' }))

      // Dialog should close but changes should remain
      await waitFor(() => {
        expect(screen.queryByText('Save Conflict')).not.toBeInTheDocument()
      })

      // User's changes should still be in the form
      expect(screen.getByDisplayValue('my-new-prompt')).toBeInTheDocument()
    })
  })
})
