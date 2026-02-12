/**
 * Tests for LinkedContentChips component.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { LinkedContentChips } from './LinkedContentChips'
import { api } from '../services/api'
import type { RelationshipWithContent, RelationshipListResponse } from '../types'

vi.mock('../services/api', () => ({
  api: {
    get: vi.fn(),
    delete: vi.fn(),
  },
}))

const mockGet = api.get as Mock
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

function makeListResponse(items: RelationshipWithContent[]): RelationshipListResponse {
  return { items, total: items.length, offset: 0, limit: 50, has_more: false }
}

describe('LinkedContentChips', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render chips with content type icons and titles', async () => {
    mockGet.mockResolvedValueOnce({
      data: makeListResponse([
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
      data: makeListResponse([
        makeRelationship({ target_title: null }),
      ]),
    })

    render(
      <LinkedContentChips contentType="note" contentId="note-1" />,
      { wrapper: createWrapper() },
    )

    expect(await screen.findByText('Untitled')).toBeInTheDocument()
  })

  it('should render add link button when onAddClick provided', async () => {
    mockGet.mockResolvedValueOnce({ data: makeListResponse([]) })
    const onAddClick = vi.fn()

    render(
      <LinkedContentChips contentType="note" contentId="note-1" onAddClick={onAddClick} />,
      { wrapper: createWrapper() },
    )

    // Wait for query to settle
    const button = await screen.findByLabelText('Link content')
    await userEvent.click(button)

    expect(onAddClick).toHaveBeenCalledOnce()
  })

  it('should not render add button when disabled', async () => {
    mockGet.mockResolvedValueOnce({ data: makeListResponse([]) })

    render(
      <LinkedContentChips
        contentType="note"
        contentId="note-1"
        onAddClick={() => {}}
        disabled
      />,
      { wrapper: createWrapper() },
    )

    // Wait for render to complete
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByLabelText('Link content')).not.toBeInTheDocument()
  })

  it('should call onNavigate when chip is clicked', async () => {
    mockGet.mockResolvedValueOnce({
      data: makeListResponse([makeRelationship()]),
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

  it('should call remove mutation when remove button clicked', async () => {
    mockGet.mockResolvedValueOnce({
      data: makeListResponse([makeRelationship()]),
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
      data: makeListResponse([makeRelationship()]),
    })

    render(
      <LinkedContentChips contentType="note" contentId="note-1" disabled />,
      { wrapper: createWrapper() },
    )

    await screen.findByText('My Bookmark')
    expect(screen.queryByLabelText('Remove link to My Bookmark')).not.toBeInTheDocument()
  })

  it('should show line-through and opacity for deleted items', async () => {
    mockGet.mockResolvedValueOnce({
      data: makeListResponse([
        makeRelationship({ target_deleted: true }),
      ]),
    })

    render(
      <LinkedContentChips contentType="note" contentId="note-1" />,
      { wrapper: createWrapper() },
    )

    const title = await screen.findByText('My Bookmark')
    expect(title.className).toContain('line-through')
    // Chip wrapper should be dimmed
    const chip = title.closest('span.inline-flex')
    expect(chip?.className).toContain('opacity-60')
  })

  it('should show opacity for archived items', async () => {
    mockGet.mockResolvedValueOnce({
      data: makeListResponse([
        makeRelationship({ target_archived: true }),
      ]),
    })

    render(
      <LinkedContentChips contentType="note" contentId="note-1" />,
      { wrapper: createWrapper() },
    )

    const title = await screen.findByText('My Bookmark')
    // Chip wrapper should be dimmed but no line-through
    const chip = title.closest('span.inline-flex')
    expect(chip?.className).toContain('opacity-60')
    expect(title.className).not.toContain('line-through')
  })

  it('should not render navigable button for deleted items', async () => {
    mockGet.mockResolvedValueOnce({
      data: makeListResponse([
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

  it('should render nothing while loading', () => {
    // Never resolve to keep loading
    mockGet.mockReturnValue(new Promise(() => {}))

    const { container } = render(
      <LinkedContentChips contentType="note" contentId="note-1" />,
      { wrapper: createWrapper() },
    )

    expect(container.innerHTML).toBe('')
  })

  it('should resolve items correctly when self is target', async () => {
    mockGet.mockResolvedValueOnce({
      data: makeListResponse([makeRelationship()]),
    })

    render(
      <LinkedContentChips contentType="bookmark" contentId="bm-1" />,
      { wrapper: createWrapper() },
    )

    // Should show the note (the other side)
    expect(await screen.findByText('My Note')).toBeInTheDocument()
  })
})
