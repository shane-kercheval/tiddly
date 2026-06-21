/**
 * Tests for the Shared Content settings page: lists publicly-shared items,
 * unshares in place, empty/loading states, and the server-driven wiring
 * (date-range filter + pagination params passed to useSharedContent).
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { SettingsSharedContent } from './SettingsSharedContent'
import type { ContentListItem } from '../../types'

let mockQuery: { data: unknown; isLoading: boolean; isError: boolean; refetch: Mock }
const useSharedContentMock = vi.fn<(params: unknown) => typeof mockQuery>(() => mockQuery)
vi.mock('../../hooks/useSharedContent', () => ({
  useSharedContent: (params: unknown) => useSharedContentMock(params),
}))

const mockUnpublish = vi.fn()
vi.mock('../../hooks/useShareMutations', () => ({
  useShareMutations: () => ({ unpublish: { mutateAsync: mockUnpublish, isPending: false } }),
}))

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }))

function item(overrides: Partial<ContentListItem> = {}): ContentListItem {
  return {
    type: 'note', id: 'n1', title: 'Shared Note', description: null, tags: [],
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    last_used_at: '2026-01-01T00:00:00Z', deleted_at: null, archived_at: null,
    content_preview: null, is_public: true, shared_at: '2026-06-01T00:00:00Z',
    url: null, name: null, arguments: null,
    ...overrides,
  }
}

function response(items: ContentListItem[], hasMore = false): unknown {
  return { items, total: items.length, offset: 0, limit: 25, has_more: hasMore }
}

function renderPage(): void {
  render(<MemoryRouter><SettingsSharedContent /></MemoryRouter>)
}

/** The most recent params useSharedContent was called with. */
function lastParams(): Record<string, unknown> {
  return useSharedContentMock.mock.calls.at(-1)?.[0] as Record<string, unknown>
}

describe('SettingsSharedContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQuery = { data: response([]), isLoading: false, isError: false, refetch: vi.fn() }
  })

  it('shows an empty state when nothing is shared', () => {
    renderPage()
    expect(screen.getByText(/haven’t shared anything yet/i)).toBeInTheDocument()
  })

  it('lists shared items', () => {
    mockQuery.data = response([
      item({ id: 'n1', title: 'Shared Note' }),
      item({ type: 'bookmark', id: 'b1', title: 'Shared Bookmark' }),
    ])
    renderPage()
    expect(screen.getByText('Shared Note')).toBeInTheDocument()
    expect(screen.getByText('Shared Bookmark')).toBeInTheDocument()
  })

  it('requests the first page with no date range by default', () => {
    renderPage()
    expect(lastParams()).toMatchObject({ offset: 0, limit: 25, sharedAfter: undefined, sharedBefore: undefined })
  })

  it('applies a date-range filter when a preset is chosen', async () => {
    renderPage()
    await userEvent.selectOptions(screen.getByTestId('filter-date'), 'last7')
    expect(lastParams().sharedAfter).toBeTruthy()
  })

  it('advances the page offset via Next', async () => {
    mockQuery.data = response([item()], true)
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(lastParams().offset).toBe(25)
  })

  it('unshares an item in place', async () => {
    mockUnpublish.mockResolvedValueOnce({ id: 'n1', is_public: false, public_token: 'tok' })
    mockQuery.data = response([item({ id: 'n1' })])
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'Unshare' }))
    await waitFor(() => expect(mockUnpublish).toHaveBeenCalledWith('n1'))
  })

  it('steps back a page when unsharing the last row on a non-first page', async () => {
    // has_more keeps Next enabled so we can reach page 2; one row so unsharing
    // empties it. The page should fall back to offset 0, not strand on empty.
    mockUnpublish.mockResolvedValueOnce({ id: 'n1', is_public: false, public_token: 'tok' })
    mockQuery.data = response([item({ id: 'n1' })], true)
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(lastParams().offset).toBe(25)

    await userEvent.click(screen.getByRole('button', { name: 'Unshare' }))
    await waitFor(() => expect(lastParams().offset).toBe(0))
  })

  it('shows a loading state', () => {
    mockQuery = { data: undefined, isLoading: true, isError: false, refetch: vi.fn() }
    renderPage()
    expect(screen.getByText(/loading shared content/i)).toBeInTheDocument()
  })
})
