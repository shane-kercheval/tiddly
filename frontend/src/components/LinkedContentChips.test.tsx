/**
 * Tests for LinkedContentChips component.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRef } from 'react'
import type { ReactNode } from 'react'
import toast from 'react-hot-toast'
import { LinkedContentChips, type LinkedContentChipsHandle } from './LinkedContentChips'
import { api } from '../services/api'
import type { RelationshipWithContent, RelationshipListResponse, ContentListItem, ContentListResponse } from '../types'

vi.mock('../services/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}))

vi.mock('react-hot-toast', () => ({
  default: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

const mockGet = api.get as Mock
const mockPost = api.post as Mock
const mockDelete = api.delete as Mock

function createWrapper(): ({ children }: { children: ReactNode }) => ReactNode {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return function Wrapper({ children }: { children: ReactNode }): ReactNode {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

function makeRelationship(overrides: Partial<RelationshipWithContent> = {}): RelationshipWithContent {
  return {
    id: 'rel-1',
    source_type: 'note',
    source_id: 'note-1',
    target_type: 'bookmark',
    target_id: 'bm-1',
    relationship_type: 'related',
    description: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    source_title: 'My Note',
    source_url: null,
    target_title: 'My Bookmark',
    target_url: 'https://example.com',
    source_deleted: false,
    target_deleted: false,
    source_archived: false,
    target_archived: false,
    ...overrides,
  }
}

function makeRelListResponse(items: RelationshipWithContent[]): RelationshipListResponse {
  return { items, total: items.length, offset: 0, limit: 50, has_more: false }
}

function makeContentItem(overrides: Partial<ContentListItem> = {}): ContentListItem {
  return {
    type: 'note',
    id: 'note-2',
    title: 'Search Result',
    description: null,
    tags: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    last_used_at: '2026-01-01T00:00:00Z',
    deleted_at: null,
    archived_at: null,
    content_preview: null,
    url: null,
    version: 1,
    name: null,
    arguments: null,
    ...overrides,
  }
}

function makeSearchResponse(items: ContentListItem[]): ContentListResponse {
  return { items, total: items.length, offset: 0, limit: 20, has_more: false }
}

/** Set up mockGet to handle both relationships and content search endpoints */
function setupMockGet(
  searchItems: ContentListItem[],
  existingRelationships: RelationshipWithContent[] = [],
): void {
  mockGet.mockImplementation((url: string) => {
    if (url.includes('/relationships/content/')) {
      return Promise.resolve({ data: makeRelListResponse(existingRelationships) })
    }
    return Promise.resolve({ data: makeSearchResponse(searchItems) })
  })
}

describe('LinkedContentChips', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('chip display', () => {
    it('should render chips with content type icons and titles', async () => {
      mockGet.mockResolvedValueOnce({
        data: makeRelListResponse([
          makeRelationship(),
          makeRelationship({
            id: 'rel-2',
            target_type: 'prompt',
            target_id: 'prompt-1',
            target_title: 'My Prompt',
          }),
        ]),
      })

      render(
        <LinkedContentChips contentType="note" contentId="note-1" />,
        { wrapper: createWrapper() },
      )

      expect(await screen.findByText('My Bookmark')).toBeInTheDocument()
      expect(screen.getByText('My Prompt')).toBeInTheDocument()
    })

    it('should render "Untitled" for items with null title', async () => {
      mockGet.mockResolvedValueOnce({
        data: makeRelListResponse([
          makeRelationship({ target_title: null }),
        ]),
      })

      render(
        <LinkedContentChips contentType="note" contentId="note-1" />,
        { wrapper: createWrapper() },
      )

      expect(await screen.findByText('Untitled')).toBeInTheDocument()
    })

    it('should show line-through and opacity for deleted items', async () => {
      mockGet.mockResolvedValueOnce({
        data: makeRelListResponse([
          makeRelationship({ target_deleted: true }),
        ]),
      })

      render(
        <LinkedContentChips contentType="note" contentId="note-1" />,
        { wrapper: createWrapper() },
      )

      const title = await screen.findByText('My Bookmark')
      expect(title.className).toContain('line-through')
      const chip = title.closest('span.inline-flex')
      expect(chip?.className).toContain('opacity-60')
    })

    it('should show opacity for archived items', async () => {
      mockGet.mockResolvedValueOnce({
        data: makeRelListResponse([
          makeRelationship({ target_archived: true }),
        ]),
      })

      render(
        <LinkedContentChips contentType="note" contentId="note-1" />,
        { wrapper: createWrapper() },
      )

      const title = await screen.findByText('My Bookmark')
      const chip = title.closest('span.inline-flex')
      expect(chip?.className).toContain('opacity-60')
      expect(title.className).not.toContain('line-through')
    })

    it('should render nothing while loading', () => {
      mockGet.mockReturnValue(new Promise(() => {}))

      const { container } = render(
        <LinkedContentChips contentType="note" contentId="note-1" />,
        { wrapper: createWrapper() },
      )

      expect(container.innerHTML).toBe('')
    })

    it('should resolve items correctly when self is target', async () => {
      mockGet.mockResolvedValueOnce({
        data: makeRelListResponse([makeRelationship()]),
      })

      render(
        <LinkedContentChips contentType="bookmark" contentId="bm-1" />,
        { wrapper: createWrapper() },
      )

      expect(await screen.findByText('My Note')).toBeInTheDocument()
    })
  })

  describe('navigation', () => {
    it('should call onNavigate when chip is clicked', async () => {
      mockGet.mockResolvedValueOnce({
        data: makeRelListResponse([makeRelationship()]),
      })
      const onNavigate = vi.fn()

      render(
        <LinkedContentChips
          contentType="note"
          contentId="note-1"
          onNavigate={onNavigate}
        />,
        { wrapper: createWrapper() },
      )

      await userEvent.click(await screen.findByLabelText('Go to Bookmark: My Bookmark'))

      expect(onNavigate).toHaveBeenCalledOnce()
      expect(onNavigate).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'bookmark', id: 'bm-1', title: 'My Bookmark' }),
      )
    })

    it('should not render navigable button for deleted items', async () => {
      mockGet.mockResolvedValueOnce({
        data: makeRelListResponse([
          makeRelationship({ target_deleted: true }),
        ]),
      })
      const onNavigate = vi.fn()

      render(
        <LinkedContentChips
          contentType="note"
          contentId="note-1"
          onNavigate={onNavigate}
        />,
        { wrapper: createWrapper() },
      )

      await screen.findByText('My Bookmark')
      expect(screen.queryByLabelText('Go to Bookmark: My Bookmark')).not.toBeInTheDocument()
    })
  })

  describe('remove', () => {
    it('should call remove mutation when remove button clicked', async () => {
      mockGet.mockResolvedValueOnce({
        data: makeRelListResponse([makeRelationship()]),
      })
      mockDelete.mockResolvedValueOnce({})

      render(
        <LinkedContentChips contentType="note" contentId="note-1" />,
        { wrapper: createWrapper() },
      )

      const removeButton = await screen.findByLabelText('Remove link to My Bookmark')
      await userEvent.click(removeButton)

      expect(mockDelete).toHaveBeenCalledWith('/relationships/rel-1')
    })

    it('should not render remove buttons when disabled', async () => {
      mockGet.mockResolvedValueOnce({
        data: makeRelListResponse([makeRelationship()]),
      })

      render(
        <LinkedContentChips contentType="note" contentId="note-1" disabled />,
        { wrapper: createWrapper() },
      )

      await screen.findByText('My Bookmark')
      expect(screen.queryByLabelText('Remove link to My Bookmark')).not.toBeInTheDocument()
    })
  })

  describe('inline add button', () => {
    it('should show add button when showAddButton is true', async () => {
      setupMockGet([])

      render(
        <LinkedContentChips contentType="note" contentId="note-1" showAddButton />,
        { wrapper: createWrapper() },
      )

      expect(await screen.findByLabelText('Link content')).toBeInTheDocument()
    })

    it('should not show add button when disabled', async () => {
      setupMockGet([])

      render(
        <LinkedContentChips contentType="note" contentId="note-1" showAddButton disabled />,
        { wrapper: createWrapper() },
      )

      // Wait for render to complete
      await new Promise((r) => setTimeout(r, 50))
      expect(screen.queryByLabelText('Link content')).not.toBeInTheDocument()
    })

    it('should enter add mode when add button clicked', async () => {
      setupMockGet([])

      render(
        <LinkedContentChips contentType="note" contentId="note-1" showAddButton />,
        { wrapper: createWrapper() },
      )

      await userEvent.click(await screen.findByLabelText('Link content'))

      expect(screen.getByPlaceholderText('Search to link...')).toBeInTheDocument()
    })
  })

  describe('startAdding via ref', () => {
    it('should enter add mode when startAdding is called', async () => {
      setupMockGet([])
      const ref = createRef<LinkedContentChipsHandle>()

      render(
        <LinkedContentChips ref={ref} contentType="note" contentId="note-1" showAddButton={false} />,
        { wrapper: createWrapper() },
      )

      // Wait for render to settle
      await new Promise((r) => setTimeout(r, 50))

      ref.current?.startAdding()

      expect(await screen.findByPlaceholderText('Search to link...')).toBeInTheDocument()
    })

    it('should not enter add mode when disabled', async () => {
      setupMockGet([])
      const ref = createRef<LinkedContentChipsHandle>()

      render(
        <LinkedContentChips ref={ref} contentType="note" contentId="note-1" disabled />,
        { wrapper: createWrapper() },
      )

      await new Promise((r) => setTimeout(r, 50))

      ref.current?.startAdding()

      await new Promise((r) => setTimeout(r, 50))
      expect(screen.queryByPlaceholderText('Search to link...')).not.toBeInTheDocument()
    })
  })

  describe('initialRelationships', () => {
    it('should render chips from initialRelationships without API call', async () => {
      const relationships = [
        makeRelationship(),
        makeRelationship({
          id: 'rel-2',
          target_type: 'prompt',
          target_id: 'prompt-1',
          target_title: 'My Prompt',
        }),
      ]

      render(
        <LinkedContentChips
          contentType="note"
          contentId="note-1"
          initialRelationships={relationships}
        />,
        { wrapper: createWrapper() },
      )

      expect(await screen.findByText('My Bookmark')).toBeInTheDocument()
      expect(screen.getByText('My Prompt')).toBeInTheDocument()

      // Should NOT have made a GET request for relationships
      const relCalls = mockGet.mock.calls.filter(
        (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('/relationships/content/'),
      )
      expect(relCalls).toHaveLength(0)
    })
  })

  describe('inline search', () => {
    it('should show search results after typing', async () => {
      const user = userEvent.setup()
      const items = [
        makeContentItem({ id: 'note-2', title: 'Found Note' }),
        makeContentItem({ type: 'prompt', id: 'prompt-1', title: 'Found Prompt', name: 'found-prompt' }),
      ]
      setupMockGet(items)

      render(
        <LinkedContentChips contentType="note" contentId="note-1" showAddButton />,
        { wrapper: createWrapper() },
      )

      await user.click(await screen.findByLabelText('Link content'))
      await user.type(screen.getByPlaceholderText('Search to link...'), 'test')

      expect(await screen.findByText('Found Note')).toBeInTheDocument()
      expect(screen.getByText('Found Prompt')).toBeInTheDocument()
    })

    it('should show "No results found." when search returns empty', async () => {
      const user = userEvent.setup()
      setupMockGet([])

      render(
        <LinkedContentChips contentType="note" contentId="note-1" showAddButton />,
        { wrapper: createWrapper() },
      )

      await user.click(await screen.findByLabelText('Link content'))
      await user.type(screen.getByPlaceholderText('Search to link...'), 'xyz')

      expect(await screen.findByText('No results found.')).toBeInTheDocument()
    })

    it('should create relationship when result clicked', async () => {
      const user = userEvent.setup()
      const items = [makeContentItem({ type: 'bookmark', id: 'bm-2', title: 'Target BM' })]
      setupMockGet(items)
      mockPost.mockResolvedValueOnce({ data: { id: 'rel-new' } })

      render(
        <LinkedContentChips contentType="note" contentId="note-1" showAddButton />,
        { wrapper: createWrapper() },
      )

      await user.click(await screen.findByLabelText('Link content'))
      await user.type(screen.getByPlaceholderText('Search to link...'), 'target')

      await user.click(await screen.findByText('Target BM'))

      expect(mockPost).toHaveBeenCalledWith('/relationships/', {
        source_type: 'note',
        source_id: 'note-1',
        target_type: 'bookmark',
        target_id: 'bm-2',
        relationship_type: 'related',
        description: null,
      })
    })

    it('should show "Already linked" toast on 409 error', async () => {
      const user = userEvent.setup()
      const items = [makeContentItem({ type: 'bookmark', id: 'bm-2', title: 'Target BM' })]
      setupMockGet(items)
      const error409 = Object.assign(new Error('Conflict'), {
        isAxiosError: true,
        response: { status: 409 },
      })
      mockPost.mockRejectedValueOnce(error409)

      render(
        <LinkedContentChips contentType="note" contentId="note-1" showAddButton />,
        { wrapper: createWrapper() },
      )

      await user.click(await screen.findByLabelText('Link content'))
      await user.type(screen.getByPlaceholderText('Search to link...'), 'target')
      await user.click(await screen.findByText('Target BM'))

      await vi.waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Already linked')
      })
    })

    it('should show "Failed to create link" toast on non-409 error', async () => {
      const user = userEvent.setup()
      const items = [makeContentItem({ type: 'bookmark', id: 'bm-2', title: 'Target BM' })]
      setupMockGet(items)
      mockPost.mockRejectedValueOnce(new Error('Network error'))

      render(
        <LinkedContentChips contentType="note" contentId="note-1" showAddButton />,
        { wrapper: createWrapper() },
      )

      await user.click(await screen.findByLabelText('Link content'))
      await user.type(screen.getByPlaceholderText('Search to link...'), 'target')
      await user.click(await screen.findByText('Target BM'))

      await vi.waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Failed to create link')
      })
    })

    it('should exit add mode on Escape', async () => {
      const user = userEvent.setup()
      setupMockGet([])

      render(
        <LinkedContentChips contentType="note" contentId="note-1" showAddButton />,
        { wrapper: createWrapper() },
      )

      await user.click(await screen.findByLabelText('Link content'))
      expect(screen.getByPlaceholderText('Search to link...')).toBeInTheDocument()

      await user.keyboard('{Escape}')

      expect(screen.queryByPlaceholderText('Search to link...')).not.toBeInTheDocument()
    })
  })
})
