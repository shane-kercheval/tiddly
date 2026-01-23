/**
 * Tests for the unified Bookmark component.
 *
 * Uses shared test factory for common content component behaviors,
 * plus Bookmark-specific tests for unique functionality.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axios from 'axios'
import { Bookmark } from './Bookmark'
import { createContentComponentTests } from './__tests__/createContentComponentTests'
import type { Bookmark as BookmarkType, TagCount } from '../types'

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

// Mock MilkdownEditor - simulates the editor with a simple textarea
vi.mock('./MilkdownEditor', () => ({
  MilkdownEditor: ({ value, onChange, placeholder, disabled }: {
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

// Mock CodeMirrorEditor
vi.mock('./CodeMirrorEditor', () => ({
  CodeMirrorEditor: ({ value, onChange, placeholder, disabled }: {
    value: string
    onChange: (value: string) => void
    placeholder?: string
    disabled?: boolean
  }) => (
    <textarea
      data-testid="content-editor-text"
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

// Mock bookmark data
const mockBookmark: BookmarkType = {
  id: 'bookmark-1',
  url: 'https://example.com',
  title: 'Test Bookmark',
  description: 'Test description',
  summary: null,
  content: '# Hello World\n\nThis is a test bookmark.',
  tags: ['test', 'example'],
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-02T00:00:00Z',
  last_used_at: '2024-01-02T00:00:00Z',
  deleted_at: null,
  archived_at: null,
}

const mockDeletedBookmark: BookmarkType = {
  ...mockBookmark,
  deleted_at: '2024-01-03T00:00:00Z',
}

const mockArchivedBookmark: BookmarkType = {
  ...mockBookmark,
  archived_at: '2024-01-03T00:00:00Z',
}

const mockTagSuggestions: TagCount[] = [
  { name: 'test', count: 5 },
  { name: 'example', count: 3 },
  { name: 'javascript', count: 10 },
]

// Run shared content component tests
createContentComponentTests({
  componentName: 'Bookmark',
  Component: Bookmark,
  mockItem: mockBookmark,
  mockDeletedItem: mockDeletedBookmark,
  mockArchivedItem: mockArchivedBookmark,
  mockTagSuggestions,
  placeholders: {
    primaryField: 'Page title',
  },
  getPrimaryFieldValue: (bookmark) => bookmark.title ?? '',
  buildProps: ({ item, onSave, onClose, onArchive, onUnarchive, onDelete, viewState, isSaving }) => ({
    bookmark: item,
    tagSuggestions: mockTagSuggestions,
    onSave,
    onClose,
    onArchive,
    onUnarchive,
    onDelete,
    viewState,
    isSaving,
  }),
})

// Bookmark-specific tests
describe('Bookmark component - specific behaviors', () => {
  const mockOnSave = vi.fn()
  const mockOnClose = vi.fn()
  const mockOnFetchMetadata = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMock.clear()
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('URL field', () => {
    it('should render bookmark URL', () => {
      render(
        <Bookmark
          bookmark={mockBookmark}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      expect(screen.getByDisplayValue('https://example.com')).toBeInTheDocument()
    })

    it('should show URL placeholder for new bookmark', () => {
      render(
        <Bookmark
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      expect(screen.getByPlaceholderText('https://example.com')).toBeInTheDocument()
    })

    it('should detect URL change as dirty', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      render(
        <Bookmark
          bookmark={mockBookmark}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      await user.clear(screen.getByDisplayValue('https://example.com'))
      await user.type(screen.getByPlaceholderText('https://example.com'), 'https://new-url.com')

      expect(screen.getByText('Save').closest('button')).not.toBeDisabled()
    })

    it('should enable Create button when URL is entered for new bookmark', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      render(
        <Bookmark
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      // Initially disabled
      expect(screen.getByText('Create').closest('button')).toBeDisabled()

      // Enter URL
      await user.type(screen.getByPlaceholderText('https://example.com'), 'https://test.com')

      // Now enabled
      expect(screen.getByText('Create').closest('button')).not.toBeDisabled()
    })
  })

  describe('timestamps', () => {
    it('should not show timestamps for new bookmark', () => {
      render(
        <Bookmark
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      expect(screen.queryByText(/Created/)).not.toBeInTheDocument()
      expect(screen.queryByText(/Updated/)).not.toBeInTheDocument()
    })

    it('should show timestamps for existing bookmark', () => {
      render(
        <Bookmark
          bookmark={mockBookmark}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      expect(screen.getByText(/Created/)).toBeInTheDocument()
      expect(screen.getByText(/Updated/)).toBeInTheDocument()
    })

  })

  describe('description field', () => {
    it('should render bookmark description', () => {
      render(
        <Bookmark
          bookmark={mockBookmark}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      expect(screen.getByText('Test description')).toBeInTheDocument()
    })
  })

  describe('tags', () => {
    it('should render bookmark tags', () => {
      render(
        <Bookmark
          bookmark={mockBookmark}
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
        <Bookmark
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
          initialTags={['preset-tag']}
        />
      )

      expect(screen.getByText('preset-tag')).toBeInTheDocument()
    })

    it('should populate initial URL from props', () => {
      render(
        <Bookmark
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
          initialUrl="https://initial-url.com"
        />
      )

      expect(screen.getByDisplayValue('https://initial-url.com')).toBeInTheDocument()
    })
  })

  describe('save with only changed fields', () => {
    it('should call onSave with only changed fields for existing bookmark', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      mockOnSave.mockResolvedValue(undefined)

      render(
        <Bookmark
          bookmark={mockBookmark}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      await user.clear(screen.getByDisplayValue('Test Bookmark'))
      await user.type(screen.getByPlaceholderText('Page title'), 'Updated Title')

      await user.click(screen.getByText('Save'))

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith({
          title: 'Updated Title',
          expected_updated_at: '2024-01-02T00:00:00Z',
        })
      })
    })
  })

  describe('fetch metadata', () => {
    it('should show fetch metadata button when onFetchMetadata is provided', () => {
      render(
        <Bookmark
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
          onFetchMetadata={mockOnFetchMetadata}
        />
      )

      // The fetch metadata button should be visible
      expect(screen.getByTitle(/fetch metadata/i)).toBeInTheDocument()
    })
  })

  describe('archive scheduling', () => {
    it('should show archive schedule section for existing bookmarks', () => {
      render(
        <Bookmark
          bookmark={mockBookmark}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      // Archive schedule section should be present
      expect(screen.getByText(/auto-archive/i)).toBeInTheDocument()
    })
  })

  describe('fullWidth prop', () => {
    it('should apply max-w-4xl when fullWidth is false', () => {
      const { container } = render(
        <Bookmark
          bookmark={mockBookmark}
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
        <Bookmark
          bookmark={mockBookmark}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
          fullWidth={true}
        />
      )

      expect(container.querySelector('form')).not.toHaveClass('max-w-4xl')
    })
  })

  describe('409 Conflict handling', () => {
    const create409Error = (): Error & { response?: { status: number; data: { detail: { error: string; server_state: BookmarkType } } } } => {
      const error = new Error('Conflict') as Error & { response?: { status: number; data: { detail: { error: string; server_state: BookmarkType } } } }
      error.response = {
        status: 409,
        data: {
          detail: {
            error: 'conflict',
            server_state: {
              ...mockBookmark,
              title: 'Server Updated Title',
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
        <Bookmark
          bookmark={mockBookmark}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      // Make a change and save
      await user.clear(screen.getByDisplayValue('Test Bookmark'))
      await user.type(screen.getByPlaceholderText('Page title'), 'My New Title')
      await user.click(screen.getByText('Save'))

      // ConflictDialog should appear
      await waitFor(() => {
        expect(screen.getByText('This bookmark was modified while you were editing')).toBeInTheDocument()
      })
      expect(screen.getByRole('button', { name: 'Load Server Version' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Save My Version' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Do Nothing' })).toBeInTheDocument()
    })

    it('should call onRefresh when Load Server Version is clicked', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      mockOnSave.mockRejectedValue(create409Error())
      const mockOnRefresh = vi.fn().mockResolvedValue(true)

      render(
        <Bookmark
          bookmark={mockBookmark}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
          onRefresh={mockOnRefresh}
        />
      )

      // Make a change and save to trigger conflict
      await user.clear(screen.getByDisplayValue('Test Bookmark'))
      await user.type(screen.getByPlaceholderText('Page title'), 'My New Title')
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
        <Bookmark
          bookmark={mockBookmark}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      // Make a change and save to trigger conflict
      await user.clear(screen.getByDisplayValue('Test Bookmark'))
      await user.type(screen.getByPlaceholderText('Page title'), 'My New Title')
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
      expect(secondCall).toHaveProperty('title', 'My New Title')
    })

    it('should close ConflictDialog without action when Do Nothing is clicked', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      mockOnSave.mockRejectedValue(create409Error())

      render(
        <Bookmark
          bookmark={mockBookmark}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      // Make a change and save to trigger conflict
      await user.clear(screen.getByDisplayValue('Test Bookmark'))
      await user.type(screen.getByPlaceholderText('Page title'), 'My New Title')
      await user.click(screen.getByText('Save'))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Do Nothing' })).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: 'Do Nothing' }))

      // Dialog should close but changes should remain
      await waitFor(() => {
        expect(screen.queryByText('This bookmark was modified while you were editing')).not.toBeInTheDocument()
      })

      // User's changes should still be in the form
      expect(screen.getByDisplayValue('My New Title')).toBeInTheDocument()
    })
  })
})
