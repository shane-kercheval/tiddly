/**
 * Tests for the owner share control.
 *
 * The load-bearing case: published state is driven by `is_public`, NOT token
 * presence — the backend retains `public_token` on unpublish, so a previously
 * shared-then-unshared item (is_public:false, public_token:"…") must render as
 * unshared and must NOT surface its (now-dead) URL.
 */
import { useState, type ReactNode } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ShareControl } from './ShareControl'
import type { Bookmark } from '../types'

/** Only the share fields matter here; the rest is filler to satisfy the Bookmark type. */
type ShareState = Pick<Bookmark, 'id' | 'is_public' | 'public_token'>
const BASE: Bookmark = {
  id: 'b1', url: '', title: null, description: null, summary: null, tags: [],
  created_at: '', updated_at: '', last_used_at: '', deleted_at: null, archived_at: null,
  content_preview: null, content: null, is_public: false, public_token: null,
}

const mockPublish = { mutateAsync: vi.fn(), isPending: false }
const mockUnpublish = { mutateAsync: vi.fn(), isPending: false }
const mockRotate = { mutateAsync: vi.fn(), isPending: false }
vi.mock('../hooks/useShareMutations', () => ({
  useShareMutations: () => ({ publish: mockPublish, unpublish: mockUnpublish, rotate: mockRotate }),
}))
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }))

/** Stateful harness so onShareStateChanged transitions the control like the real detail page. */
function Harness({ initial }: { initial: ShareState }): ReactNode {
  const [item, setItem] = useState<Bookmark>({ ...BASE, ...initial })
  return <ShareControl type="bookmarks" item={item} onShareStateChanged={setItem} />
}

async function openPanel(): Promise<void> {
  // The trigger's label tracks state: "Share" when private, "Shared" when public.
  await userEvent.click(screen.getByRole('button', { name: /^Shared?$/ }))
}

describe('ShareControl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('private item: shows "Create share link" and no URL', async () => {
    render(<Harness initial={{ id: 'b1', is_public: false, public_token: null }} />)
    await openPanel()
    expect(screen.getByRole('button', { name: 'Create share link' })).toBeInTheDocument()
    expect(screen.queryByText(/\/shared\/bookmarks\//)).toBeNull()
  })

  it('retained token but unpublished: renders unshared, does NOT surface the dead URL', async () => {
    // is_public=false with a leftover token (re-publish would restore the same URL).
    render(<Harness initial={{ id: 'b1', is_public: false, public_token: 'stale-token' }} />)
    await openPanel()
    expect(screen.getByRole('button', { name: 'Create share link' })).toBeInTheDocument()
    expect(screen.queryByText(/stale-token/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Stop sharing' })).toBeNull()
  })

  it('shared item: shows the URL, copy, stop sharing, and regenerate', async () => {
    render(<Harness initial={{ id: 'b1', is_public: true, public_token: 'tok' }} />)
    await openPanel()
    expect(screen.getByText(`${window.location.origin}/shared/bookmarks/tok`)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Stop sharing' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Regenerate link' })).toBeInTheDocument()
  })

  it('publishing transitions to the shared state and reveals the URL', async () => {
    mockPublish.mutateAsync.mockResolvedValueOnce({ id: 'b1', is_public: true, public_token: 'fresh' })
    render(<Harness initial={{ id: 'b1', is_public: false, public_token: null }} />)
    await openPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Create share link' }))

    expect(mockPublish.mutateAsync).toHaveBeenCalledWith('b1')
    await waitFor(() =>
      expect(screen.getByText(`${window.location.origin}/shared/bookmarks/fresh`)).toBeInTheDocument()
    )
  })

  it('stop sharing transitions back to the unshared state', async () => {
    mockUnpublish.mutateAsync.mockResolvedValueOnce({ id: 'b1', is_public: false, public_token: 'tok' })
    render(<Harness initial={{ id: 'b1', is_public: true, public_token: 'tok' }} />)
    await openPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Stop sharing' }))

    expect(mockUnpublish.mutateAsync).toHaveBeenCalledWith('b1')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Create share link' })).toBeInTheDocument()
    )
  })

  it('regenerate requires confirmation that warns the old link breaks, then rotates', async () => {
    mockRotate.mutateAsync.mockResolvedValueOnce({ id: 'b1', is_public: true, public_token: 'rotated' })
    render(<Harness initial={{ id: 'b1', is_public: true, public_token: 'tok' }} />)
    await openPanel()

    await userEvent.click(screen.getByRole('button', { name: 'Regenerate link' }))
    // Confirmation surfaces and is explicit that the existing link stops working.
    expect(screen.getByText(/breaks the current link/i)).toBeInTheDocument()
    expect(mockRotate.mutateAsync).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Regenerate' }))
    expect(mockRotate.mutateAsync).toHaveBeenCalledWith('b1')
    await waitFor(() =>
      expect(screen.getByText(`${window.location.origin}/shared/bookmarks/rotated`)).toBeInTheDocument()
    )
  })

  it('cancelling regenerate returns to the share actions without rotating', async () => {
    render(<Harness initial={{ id: 'b1', is_public: true, public_token: 'tok' }} />)
    await openPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Regenerate link' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(mockRotate.mutateAsync).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Stop sharing' })).toBeInTheDocument()
  })
})
