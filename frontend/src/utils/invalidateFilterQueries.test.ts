/**
 * Tests for invalidateFilterQueries utility.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { invalidateFilterQueries } from './invalidateFilterQueries'
import { bookmarkKeys } from '../hooks/useBookmarksQuery'
import { noteKeys } from '../hooks/useNotesQuery'
import { promptKeys } from '../hooks/usePromptsQuery'
import { contentKeys } from '../hooks/useContentQuery'

describe('invalidateFilterQueries', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })
  })

  it('should invalidate bookmark queries for the specified filter', async () => {
    // Set up cached queries for different filters
    const filter5Params = { filter_id: '5', offset: 0, limit: 10 }
    const filter10Params = { filter_id: '10', offset: 0, limit: 10 }

    queryClient.setQueryData(bookmarkKeys.list(filter5Params), { items: [], total: 0 })
    queryClient.setQueryData(bookmarkKeys.list(filter10Params), { items: [], total: 0 })

    // Invalidate filter 5
    await invalidateFilterQueries(queryClient, '5')

    // Filter 5 should be invalidated (stale)
    const filter5State = queryClient.getQueryState(bookmarkKeys.list(filter5Params))
    expect(filter5State?.isInvalidated).toBe(true)

    // Filter 10 should NOT be invalidated
    const filter10State = queryClient.getQueryState(bookmarkKeys.list(filter10Params))
    expect(filter10State?.isInvalidated).toBe(false)
  })

  it('should invalidate note queries for the specified filter', async () => {
    // Set up cached queries for different filters
    const filter5Params = { filter_id: '5', offset: 0, limit: 10 }
    const filter10Params = { filter_id: '10', offset: 0, limit: 10 }

    queryClient.setQueryData(noteKeys.list(filter5Params), { items: [], total: 0 })
    queryClient.setQueryData(noteKeys.list(filter10Params), { items: [], total: 0 })

    // Invalidate filter 5
    await invalidateFilterQueries(queryClient, '5')

    // Filter 5 should be invalidated (stale)
    const filter5State = queryClient.getQueryState(noteKeys.list(filter5Params))
    expect(filter5State?.isInvalidated).toBe(true)

    // Filter 10 should NOT be invalidated
    const filter10State = queryClient.getQueryState(noteKeys.list(filter10Params))
    expect(filter10State?.isInvalidated).toBe(false)
  })

  it('should invalidate bookmark, note, and prompt queries for the same filter', async () => {
    const filterParams = { filter_id: '7', offset: 0, limit: 10 }

    queryClient.setQueryData(bookmarkKeys.list(filterParams), { items: [], total: 0 })
    queryClient.setQueryData(noteKeys.list(filterParams), { items: [], total: 0 })
    queryClient.setQueryData(promptKeys.list(filterParams), { items: [], total: 0 })

    await invalidateFilterQueries(queryClient, '7')

    const bookmarkState = queryClient.getQueryState(bookmarkKeys.list(filterParams))
    const noteState = queryClient.getQueryState(noteKeys.list(filterParams))
    const promptState = queryClient.getQueryState(promptKeys.list(filterParams))

    expect(bookmarkState?.isInvalidated).toBe(true)
    expect(noteState?.isInvalidated).toBe(true)
    expect(promptState?.isInvalidated).toBe(true)
  })

  it('should invalidate prompt queries for the specified filter', async () => {
    // Set up cached queries for different filters
    const filter5Params = { filter_id: '5', offset: 0, limit: 10 }
    const filter10Params = { filter_id: '10', offset: 0, limit: 10 }

    queryClient.setQueryData(promptKeys.list(filter5Params), { items: [], total: 0 })
    queryClient.setQueryData(promptKeys.list(filter10Params), { items: [], total: 0 })

    // Invalidate filter 5
    await invalidateFilterQueries(queryClient, '5')

    // Filter 5 should be invalidated (stale)
    const filter5State = queryClient.getQueryState(promptKeys.list(filter5Params))
    expect(filter5State?.isInvalidated).toBe(true)

    // Filter 10 should NOT be invalidated
    const filter10State = queryClient.getQueryState(promptKeys.list(filter10Params))
    expect(filter10State?.isInvalidated).toBe(false)
  })

  it('should not invalidate non-custom filter queries (active/archived/deleted views)', async () => {
    // Set up a custom filter query and a regular view query
    const customFilterParams = { filter_id: '5', offset: 0, limit: 10 }
    const activeViewParams = { view: 'active' as const, offset: 0, limit: 10 }

    queryClient.setQueryData(bookmarkKeys.list(customFilterParams), { items: [], total: 0 })
    queryClient.setQueryData(bookmarkKeys.list(activeViewParams), { items: [], total: 0 })

    await invalidateFilterQueries(queryClient, '5')

    // Custom filter should be invalidated
    const customState = queryClient.getQueryState(bookmarkKeys.list(customFilterParams))
    expect(customState?.isInvalidated).toBe(true)

    // Active view should NOT be invalidated
    const activeState = queryClient.getQueryState(bookmarkKeys.list(activeViewParams))
    expect(activeState?.isInvalidated).toBe(false)
  })

  it('should handle case when no queries exist for the filter', async () => {
    // Set up a query for a different filter
    const filter10Params = { filter_id: '10', offset: 0, limit: 10 }
    queryClient.setQueryData(bookmarkKeys.list(filter10Params), { items: [], total: 0 })

    // Invalidate a filter that has no cached queries - should not throw
    await expect(invalidateFilterQueries(queryClient, '999')).resolves.not.toThrow()

    // Filter 10 should still be valid
    const filter10State = queryClient.getQueryState(bookmarkKeys.list(filter10Params))
    expect(filter10State?.isInvalidated).toBe(false)
  })

  it('should invalidate queries with different pagination params for same filter', async () => {
    // Same filter, different pagination
    const page1Params = { filter_id: '5', offset: 0, limit: 10 }
    const page2Params = { filter_id: '5', offset: 10, limit: 10 }
    const page3Params = { filter_id: '5', offset: 20, limit: 10 }

    queryClient.setQueryData(bookmarkKeys.list(page1Params), { items: [], total: 30 })
    queryClient.setQueryData(bookmarkKeys.list(page2Params), { items: [], total: 30 })
    queryClient.setQueryData(bookmarkKeys.list(page3Params), { items: [], total: 30 })

    await invalidateFilterQueries(queryClient, '5')

    // All pages of filter 5 should be invalidated
    expect(queryClient.getQueryState(bookmarkKeys.list(page1Params))?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(bookmarkKeys.list(page2Params))?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(bookmarkKeys.list(page3Params))?.isInvalidated).toBe(true)
  })

  it('should invalidate content queries for the specified filter', async () => {
    // Set up cached content queries for different filters
    const filter5Params = { view: 'active' as const, filter_id: '5', offset: 0, limit: 10 }
    const filter10Params = { view: 'active' as const, filter_id: '10', offset: 0, limit: 10 }

    queryClient.setQueryData(contentKeys.list(filter5Params), { items: [], total: 0 })
    queryClient.setQueryData(contentKeys.list(filter10Params), { items: [], total: 0 })

    // Invalidate filter 5
    await invalidateFilterQueries(queryClient, '5')

    // Filter 5 should be invalidated (stale)
    const filter5State = queryClient.getQueryState(contentKeys.list(filter5Params))
    expect(filter5State?.isInvalidated).toBe(true)

    // Filter 10 should NOT be invalidated
    const filter10State = queryClient.getQueryState(contentKeys.list(filter10Params))
    expect(filter10State?.isInvalidated).toBe(false)
  })

  it('should invalidate bookmark, note, prompt, and content queries for the same filter', async () => {
    const filterParams = { filter_id: '7', offset: 0, limit: 10 }
    const contentParams = { view: 'active' as const, filter_id: '7', offset: 0, limit: 10 }

    queryClient.setQueryData(bookmarkKeys.list(filterParams), { items: [], total: 0 })
    queryClient.setQueryData(noteKeys.list(filterParams), { items: [], total: 0 })
    queryClient.setQueryData(promptKeys.list(filterParams), { items: [], total: 0 })
    queryClient.setQueryData(contentKeys.list(contentParams), { items: [], total: 0 })

    await invalidateFilterQueries(queryClient, '7')

    const bookmarkState = queryClient.getQueryState(bookmarkKeys.list(filterParams))
    const noteState = queryClient.getQueryState(noteKeys.list(filterParams))
    const promptState = queryClient.getQueryState(promptKeys.list(filterParams))
    const contentState = queryClient.getQueryState(contentKeys.list(contentParams))

    expect(bookmarkState?.isInvalidated).toBe(true)
    expect(noteState?.isInvalidated).toBe(true)
    expect(promptState?.isInvalidated).toBe(true)
    expect(contentState?.isInvalidated).toBe(true)
  })

  it('should not invalidate content queries without filter_id (builtin views)', async () => {
    // Set up a custom filter query and a regular "All" view query (no filter_id)
    const customFilterParams = { view: 'active' as const, filter_id: '5', offset: 0, limit: 10 }
    const allViewParams = { view: 'active' as const, offset: 0, limit: 10 }

    queryClient.setQueryData(contentKeys.list(customFilterParams), { items: [], total: 0 })
    queryClient.setQueryData(contentKeys.list(allViewParams), { items: [], total: 0 })

    await invalidateFilterQueries(queryClient, '5')

    // Custom filter should be invalidated
    const customState = queryClient.getQueryState(contentKeys.list(customFilterParams))
    expect(customState?.isInvalidated).toBe(true)

    // "All" view (no filter_id) should NOT be invalidated
    const allState = queryClient.getQueryState(contentKeys.list(allViewParams))
    expect(allState?.isInvalidated).toBe(false)
  })
})
