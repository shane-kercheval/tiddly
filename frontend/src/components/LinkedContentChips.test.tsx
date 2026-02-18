/**
 * Tests for LinkedContentChips component.
 *
 * The component is stateless: the parent owns relationship state and provides
 * items + callbacks. These tests verify display, callbacks, and inline search.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRef } from 'react'
import type { ReactNode } from 'react'
import { LinkedContentChips, type LinkedContentChipsHandle } from './LinkedContentChips'
import { api } from '../services/api'
import type { LinkedItem } from '../utils/relationships'
import type { ContentListItem, ContentListResponse } from '../types'

vi.mock('../services/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}))

const mockGet = api.get as Mock

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

function makeLinkedItem(overrides: Partial<LinkedItem> = {}): LinkedItem {
  return {
    relationshipId: 'rel-1',
    type: 'bookmark',
    id: 'bm-1',
    title: 'My Bookmark',
    url: 'https://example.com',
    promptName: null,
    deleted: false,
    archived: false,
    description: null,
    ...overrides,
  }
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

/** Set up mockGet to handle content search endpoint */
function setupSearchMock(searchItems: ContentListItem[]): void {
  mockGet.mockImplementation(() => {
    return Promise.resolve({ data: makeSearchResponse(searchItems) })
  })
}

const noop = vi.fn()

describe('LinkedContentChips', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('chip display', () => {
    it('should render chips with content type icons and titles', () => {
      const items = [
        makeLinkedItem(),
        makeLinkedItem({
          relationshipId: 'rel-2',
          type: 'prompt',
          id: 'prompt-1',
          title: 'My Prompt',
        }),
      ]

      render(
        <LinkedContentChips
          contentType="note"
          contentId="note-1"
          items={items}
          onAdd={noop}
          onRemove={noop}
        />,
        { wrapper: createWrapper() },
      )

      expect(screen.getByText('My Bookmark')).toBeInTheDocument()
      expect(screen.getByText('My Prompt')).toBeInTheDocument()
    })

    it('should render URL hostname for bookmarks with null title', () => {
      const items = [makeLinkedItem({ title: null, url: 'https://example.com/path' })]

      render(
        <LinkedContentChips
          contentType="note"
          contentId="note-1"
          items={items}
          onAdd={noop}
          onRemove={noop}
        />,
        { wrapper: createWrapper() },
      )

      expect(screen.getByText('example.com')).toBeInTheDocument()
    })

    it('should render prompt name for prompts with null title', () => {
      const items = [makeLinkedItem({ type: 'prompt', title: null, url: null, promptName: 'my-prompt' })]

      render(
        <LinkedContentChips
          contentType="bookmark"
          contentId="bm-1"
          items={items}
          onAdd={noop}
          onRemove={noop}
        />,
        { wrapper: createWrapper() },
      )

      expect(screen.getByText('my-prompt')).toBeInTheDocument()
    })

    it('should render "Untitled" for non-bookmark items with null title', () => {
      const items = [makeLinkedItem({ type: 'note', title: null, url: null })]

      render(
        <LinkedContentChips
          contentType="bookmark"
          contentId="bm-1"
          items={items}
          onAdd={noop}
          onRemove={noop}
        />,
        { wrapper: createWrapper() },
      )

      expect(screen.getByText('Untitled')).toBeInTheDocument()
    })

    it('should prefer title over URL hostname for bookmarks that have a title', () => {
      const items = [makeLinkedItem({ title: 'My Title', url: 'https://example.com' })]

      render(
        <LinkedContentChips
          contentType="note"
          contentId="note-1"
          items={items}
          onAdd={noop}
          onRemove={noop}
        />,
        { wrapper: createWrapper() },
      )

      expect(screen.getByText('My Title')).toBeInTheDocument()
      expect(screen.queryByText('example.com')).not.toBeInTheDocument()
    })

    it('should render "Untitled" for bookmarks with null title and invalid URL', () => {
      const items = [makeLinkedItem({ title: null, url: 'not-a-valid-url' })]

      render(
        <LinkedContentChips
          contentType="note"
          contentId="note-1"
          items={items}
          onAdd={noop}
          onRemove={noop}
        />,
        { wrapper: createWrapper() },
      )

      expect(screen.getByText('Untitled')).toBeInTheDocument()
    })

    it('should render "Untitled" for bookmarks with null title and null URL', () => {
      const items = [makeLinkedItem({ title: null, url: null })]

      render(
        <LinkedContentChips
          contentType="note"
          contentId="note-1"
          items={items}
          onAdd={noop}
          onRemove={noop}
        />,
        { wrapper: createWrapper() },
      )

      expect(screen.getByText('Untitled')).toBeInTheDocument()
    })

    it('should show line-through and opacity for deleted items', () => {
      const items = [makeLinkedItem({ deleted: true })]

      render(
        <LinkedContentChips
          contentType="note"
          contentId="note-1"
          items={items}
          onAdd={noop}
          onRemove={noop}
        />,
        { wrapper: createWrapper() },
      )

      const title = screen.getByText('My Bookmark')
      expect(title.className).toContain('line-through')
      const chip = title.closest('span.inline-flex')
      expect(chip?.className).toContain('opacity-60')
    })

    it('should show opacity for archived items', () => {
      const items = [makeLinkedItem({ archived: true })]

      render(
        <LinkedContentChips
          contentType="note"
          contentId="note-1"
          items={items}
          onAdd={noop}
          onRemove={noop}
        />,
        { wrapper: createWrapper() },
      )

      const title = screen.getByText('My Bookmark')
      const chip = title.closest('span.inline-flex')
      expect(chip?.className).toContain('opacity-60')
      expect(title.className).not.toContain('line-through')
    })

    it('should render empty container when items is empty', () => {
      const { container } = render(
        <LinkedContentChips
          contentType="note"
          contentId="note-1"
          items={[]}
          onAdd={noop}
          onRemove={noop}
          showAddButton={false}
        />,
        { wrapper: createWrapper() },
      )

      // Container exists but has no chip children
      expect(container.querySelectorAll('span.inline-flex')).toHaveLength(0)
    })
  })

  describe('navigation', () => {
    it('should call onNavigate when chip is clicked', async () => {
      const items = [makeLinkedItem()]
      const onNavigate = vi.fn()

      render(
        <LinkedContentChips
          contentType="note"
          contentId="note-1"
          items={items}
          onAdd={noop}
          onRemove={noop}
          onNavigate={onNavigate}
        />,
        { wrapper: createWrapper() },
      )

      await userEvent.click(screen.getByLabelText('Go to Bookmark: My Bookmark'))

      expect(onNavigate).toHaveBeenCalledOnce()
      expect(onNavigate).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'bookmark', id: 'bm-1', title: 'My Bookmark' }),
      )
    })

    it('should not render navigable button for deleted items', () => {
      const items = [makeLinkedItem({ deleted: true })]
      const onNavigate = vi.fn()

      render(
        <LinkedContentChips
          contentType="note"
          contentId="note-1"
          items={items}
          onAdd={noop}
          onRemove={noop}
          onNavigate={onNavigate}
        />,
        { wrapper: createWrapper() },
      )

      expect(screen.queryByLabelText('Go to Bookmark: My Bookmark')).not.toBeInTheDocument()
    })
  })

  describe('remove', () => {
    it('should call onRemove when remove button clicked', async () => {
      const items = [makeLinkedItem()]
      const onRemove = vi.fn()

      render(
        <LinkedContentChips
          contentType="note"
          contentId="note-1"
          items={items}
          onAdd={noop}
          onRemove={onRemove}
        />,
        { wrapper: createWrapper() },
      )

      await userEvent.click(screen.getByLabelText('Remove link to My Bookmark'))

      expect(onRemove).toHaveBeenCalledOnce()
      expect(onRemove).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'bookmark', id: 'bm-1' }),
      )
    })

    it('should not render remove buttons when disabled', () => {
      const items = [makeLinkedItem()]

      render(
        <LinkedContentChips
          contentType="note"
          contentId="note-1"
          items={items}
          onAdd={noop}
          onRemove={noop}
          disabled
        />,
        { wrapper: createWrapper() },
      )

      expect(screen.queryByLabelText('Remove link to My Bookmark')).not.toBeInTheDocument()
    })
  })

  describe('inline add button', () => {
    it('should show add button when showAddButton is true', () => {
      render(
        <LinkedContentChips
          contentType="note"
          contentId="note-1"
          items={[]}
          onAdd={noop}
          onRemove={noop}
          showAddButton
        />,
        { wrapper: createWrapper() },
      )

      expect(screen.getByLabelText('Link content')).toBeInTheDocument()
    })

    it('should not show add button when disabled', () => {
      render(
        <LinkedContentChips
          contentType="note"
          contentId="note-1"
          items={[]}
          onAdd={noop}
          onRemove={noop}
          showAddButton
          disabled
        />,
        { wrapper: createWrapper() },
      )

      expect(screen.queryByLabelText('Link content')).not.toBeInTheDocument()
    })

    it('should enter add mode when add button clicked', async () => {
      setupSearchMock([])

      render(
        <LinkedContentChips
          contentType="note"
          contentId="note-1"
          items={[]}
          onAdd={noop}
          onRemove={noop}
          showAddButton
        />,
        { wrapper: createWrapper() },
      )

      await userEvent.click(screen.getByLabelText('Link content'))

      expect(screen.getByPlaceholderText('Search to link...')).toBeInTheDocument()
    })
  })

  describe('startAdding via ref', () => {
    it('should enter add mode when startAdding is called', async () => {
      setupSearchMock([])
      const ref = createRef<LinkedContentChipsHandle>()

      render(
        <LinkedContentChips
          ref={ref}
          contentType="note"
          contentId="note-1"
          items={[]}
          onAdd={noop}
          onRemove={noop}
          showAddButton={false}
        />,
        { wrapper: createWrapper() },
      )

      act(() => { ref.current?.startAdding() })

      expect(await screen.findByPlaceholderText('Search to link...')).toBeInTheDocument()
    })

    it('should not enter add mode when disabled', async () => {
      setupSearchMock([])
      const ref = createRef<LinkedContentChipsHandle>()

      render(
        <LinkedContentChips
          ref={ref}
          contentType="note"
          contentId="note-1"
          items={[]}
          onAdd={noop}
          onRemove={noop}
          disabled
        />,
        { wrapper: createWrapper() },
      )

      act(() => { ref.current?.startAdding() })

      await new Promise((r) => setTimeout(r, 50))
      expect(screen.queryByPlaceholderText('Search to link...')).not.toBeInTheDocument()
    })
  })

  describe('inline search', () => {
    it('should show search results after typing', async () => {
      const user = userEvent.setup()
      const searchItems = [
        makeContentItem({ id: 'note-2', title: 'Found Note' }),
        makeContentItem({ type: 'prompt', id: 'prompt-1', title: 'Found Prompt', name: 'found-prompt' }),
      ]
      setupSearchMock(searchItems)

      render(
        <LinkedContentChips
          contentType="note"
          contentId="note-1"
          items={[]}
          onAdd={noop}
          onRemove={noop}
          showAddButton
        />,
        { wrapper: createWrapper() },
      )

      await user.click(screen.getByLabelText('Link content'))
      await user.type(screen.getByPlaceholderText('Search to link...'), 'test')

      expect(await screen.findByText('Found Note')).toBeInTheDocument()
      expect(screen.getByText('Found Prompt')).toBeInTheDocument()
    })

    it('should show "No results found." when search returns empty', async () => {
      const user = userEvent.setup()
      setupSearchMock([])

      render(
        <LinkedContentChips
          contentType="note"
          contentId="note-1"
          items={[]}
          onAdd={noop}
          onRemove={noop}
          showAddButton
        />,
        { wrapper: createWrapper() },
      )

      await user.click(screen.getByLabelText('Link content'))
      await user.type(screen.getByPlaceholderText('Search to link...'), 'xyz')

      expect(await screen.findByText('No results found.')).toBeInTheDocument()
    })

    it('should call onAdd when search result clicked', async () => {
      const user = userEvent.setup()
      const searchItems = [makeContentItem({ type: 'bookmark', id: 'bm-2', title: 'Target BM' })]
      setupSearchMock(searchItems)
      const onAdd = vi.fn()

      render(
        <LinkedContentChips
          contentType="note"
          contentId="note-1"
          items={[]}
          onAdd={onAdd}
          onRemove={noop}
          showAddButton
        />,
        { wrapper: createWrapper() },
      )

      await user.click(screen.getByLabelText('Link content'))
      await user.type(screen.getByPlaceholderText('Search to link...'), 'target')
      await user.click(await screen.findByText('Target BM'))

      expect(onAdd).toHaveBeenCalledOnce()
      expect(onAdd).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'bookmark', id: 'bm-2', title: 'Target BM' }),
      )
    })

    it('should exit add mode on Escape', async () => {
      const user = userEvent.setup()
      setupSearchMock([])

      render(
        <LinkedContentChips
          contentType="note"
          contentId="note-1"
          items={[]}
          onAdd={noop}
          onRemove={noop}
          showAddButton
        />,
        { wrapper: createWrapper() },
      )

      await user.click(screen.getByLabelText('Link content'))
      expect(screen.getByPlaceholderText('Search to link...')).toBeInTheDocument()

      await user.keyboard('{Escape}')

      expect(screen.queryByPlaceholderText('Search to link...')).not.toBeInTheDocument()
    })
  })

  describe('quick-create buttons', () => {
    it('should show quick-create buttons in search widget when onQuickCreate and contentId provided', async () => {
      const onQuickCreate = vi.fn()
      const ref = createRef<LinkedContentChipsHandle>()

      render(
        <LinkedContentChips
          ref={ref}
          contentType="note"
          contentId="note-1"
          items={[]}
          onAdd={noop}
          onRemove={noop}
          onQuickCreate={onQuickCreate}
        />,
        { wrapper: createWrapper() },
      )

      // Buttons not visible before opening search
      expect(screen.queryByLabelText('Create linked note')).not.toBeInTheDocument()

      // Open search via ref
      act(() => { ref.current?.startAdding() })

      expect(screen.getByLabelText('Create linked note')).toBeInTheDocument()
      expect(screen.getByLabelText('Create linked bookmark')).toBeInTheDocument()
      expect(screen.getByLabelText('Create linked prompt')).toBeInTheDocument()
    })

    it('should not show quick-create buttons when contentId is null', async () => {
      const onQuickCreate = vi.fn()
      const ref = createRef<LinkedContentChipsHandle>()

      render(
        <LinkedContentChips
          ref={ref}
          contentType="note"
          contentId={null}
          items={[]}
          onAdd={noop}
          onRemove={noop}
          onQuickCreate={onQuickCreate}
        />,
        { wrapper: createWrapper() },
      )

      act(() => { ref.current?.startAdding() })

      expect(screen.queryByLabelText('Create linked note')).not.toBeInTheDocument()
    })

    it('should call onQuickCreate with correct type when button clicked', async () => {
      const onQuickCreate = vi.fn()
      const ref = createRef<LinkedContentChipsHandle>()

      render(
        <LinkedContentChips
          ref={ref}
          contentType="note"
          contentId="note-1"
          items={[]}
          onAdd={noop}
          onRemove={noop}
          onQuickCreate={onQuickCreate}
        />,
        { wrapper: createWrapper() },
      )

      act(() => { ref.current?.startAdding() })

      await userEvent.click(screen.getByLabelText('Create linked bookmark'))

      expect(onQuickCreate).toHaveBeenCalledOnce()
      expect(onQuickCreate).toHaveBeenCalledWith('bookmark')
    })
  })

})
