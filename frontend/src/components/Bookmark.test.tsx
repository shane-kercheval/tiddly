/**
 * Tests for the unified Bookmark component.
 *
 * Uses shared test factory for common content component behaviors,
 * plus Bookmark-specific tests for unique functionality.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Bookmark } from './Bookmark'
import { createContentComponentTests } from './__tests__/createContentComponentTests'
import type { Bookmark as BookmarkType, TagCount } from '../types'

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
      data-testid="content-editor-markdown"
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

  describe('draft recovery', () => {
    it('should show draft recovery prompt when draft exists', () => {
      const draftData = {
        url: 'https://draft-url.com',
        title: 'Draft Title',
        description: 'Draft description',
        content: 'Draft content',
        tags: ['draft-tag'],
        archivedAt: '',
        archivePreset: 'none',
        savedAt: Date.now(),
      }
      localStorageMock.getItem.mockReturnValue(JSON.stringify(draftData))

      render(
        <Bookmark
          bookmark={mockBookmark}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      expect(screen.getByText(/unsaved draft from a previous session/)).toBeInTheDocument()
      expect(screen.getByText('Restore Draft')).toBeInTheDocument()
    })

    it('should restore draft when Restore Draft is clicked', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const draftData = {
        url: 'https://draft-url.com',
        title: 'Draft Title',
        description: 'Draft description',
        content: 'Draft content',
        tags: ['draft-tag'],
        archivedAt: '',
        archivePreset: 'none',
        savedAt: Date.now(),
      }
      localStorageMock.getItem.mockReturnValue(JSON.stringify(draftData))

      render(
        <Bookmark
          bookmark={mockBookmark}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      await user.click(screen.getByText('Restore Draft'))

      expect(screen.getByDisplayValue('Draft Title')).toBeInTheDocument()
      expect(screen.getByDisplayValue('https://draft-url.com')).toBeInTheDocument()
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
})
