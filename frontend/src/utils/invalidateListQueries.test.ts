/**
 * Tests for invalidateListQueries utility.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { invalidateListQueries } from './invalidateListQueries'
import { bookmarkKeys } from '../hooks/useBookmarksQuery'
import { noteKeys } from '../hooks/useNotesQuery'

describe('invalidateListQueries', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })
  })

  it('should invalidate bookmark queries for the specified list', async () => {
    // Set up cached queries for different lists
    const list5Params = { list_id: 5, offset: 0, limit: 10 }
    const list10Params = { list_id: 10, offset: 0, limit: 10 }

    queryClient.setQueryData(bookmarkKeys.list(list5Params), { items: [], total: 0 })
    queryClient.setQueryData(bookmarkKeys.list(list10Params), { items: [], total: 0 })

    // Invalidate list 5
    await invalidateListQueries(queryClient, 5)

    // List 5 should be invalidated (stale)
    const list5State = queryClient.getQueryState(bookmarkKeys.list(list5Params))
    expect(list5State?.isInvalidated).toBe(true)

    // List 10 should NOT be invalidated
    const list10State = queryClient.getQueryState(bookmarkKeys.list(list10Params))
    expect(list10State?.isInvalidated).toBe(false)
  })

  it('should invalidate note queries for the specified list', async () => {
    // Set up cached queries for different lists
    const list5Params = { list_id: 5, offset: 0, limit: 10 }
    const list10Params = { list_id: 10, offset: 0, limit: 10 }

    queryClient.setQueryData(noteKeys.list(list5Params), { items: [], total: 0 })
    queryClient.setQueryData(noteKeys.list(list10Params), { items: [], total: 0 })

    // Invalidate list 5
    await invalidateListQueries(queryClient, 5)

    // List 5 should be invalidated (stale)
    const list5State = queryClient.getQueryState(noteKeys.list(list5Params))
    expect(list5State?.isInvalidated).toBe(true)

    // List 10 should NOT be invalidated
    const list10State = queryClient.getQueryState(noteKeys.list(list10Params))
    expect(list10State?.isInvalidated).toBe(false)
  })

  it('should invalidate both bookmark and note queries for the same list', async () => {
    const listParams = { list_id: 7, offset: 0, limit: 10 }

    queryClient.setQueryData(bookmarkKeys.list(listParams), { items: [], total: 0 })
    queryClient.setQueryData(noteKeys.list(listParams), { items: [], total: 0 })

    await invalidateListQueries(queryClient, 7)

    const bookmarkState = queryClient.getQueryState(bookmarkKeys.list(listParams))
    const noteState = queryClient.getQueryState(noteKeys.list(listParams))

    expect(bookmarkState?.isInvalidated).toBe(true)
    expect(noteState?.isInvalidated).toBe(true)
  })

  it('should not invalidate non-custom list queries (active/archived/deleted views)', async () => {
    // Set up a custom list query and a regular view query
    const customListParams = { list_id: 5, offset: 0, limit: 10 }
    const activeViewParams = { view: 'active' as const, offset: 0, limit: 10 }

    queryClient.setQueryData(bookmarkKeys.list(customListParams), { items: [], total: 0 })
    queryClient.setQueryData(bookmarkKeys.list(activeViewParams), { items: [], total: 0 })

    await invalidateListQueries(queryClient, 5)

    // Custom list should be invalidated
    const customState = queryClient.getQueryState(bookmarkKeys.list(customListParams))
    expect(customState?.isInvalidated).toBe(true)

    // Active view should NOT be invalidated
    const activeState = queryClient.getQueryState(bookmarkKeys.list(activeViewParams))
    expect(activeState?.isInvalidated).toBe(false)
  })

  it('should handle case when no queries exist for the list', async () => {
    // Set up a query for a different list
    const list10Params = { list_id: 10, offset: 0, limit: 10 }
    queryClient.setQueryData(bookmarkKeys.list(list10Params), { items: [], total: 0 })

    // Invalidate a list that has no cached queries - should not throw
    await expect(invalidateListQueries(queryClient, 999)).resolves.not.toThrow()

    // List 10 should still be valid
    const list10State = queryClient.getQueryState(bookmarkKeys.list(list10Params))
    expect(list10State?.isInvalidated).toBe(false)
  })

  it('should invalidate queries with different pagination params for same list', async () => {
    // Same list, different pagination
    const page1Params = { list_id: 5, offset: 0, limit: 10 }
    const page2Params = { list_id: 5, offset: 10, limit: 10 }
    const page3Params = { list_id: 5, offset: 20, limit: 10 }

    queryClient.setQueryData(bookmarkKeys.list(page1Params), { items: [], total: 30 })
    queryClient.setQueryData(bookmarkKeys.list(page2Params), { items: [], total: 30 })
    queryClient.setQueryData(bookmarkKeys.list(page3Params), { items: [], total: 30 })

    await invalidateListQueries(queryClient, 5)

    // All pages of list 5 should be invalidated
    expect(queryClient.getQueryState(bookmarkKeys.list(page1Params))?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(bookmarkKeys.list(page2Params))?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(bookmarkKeys.list(page3Params))?.isInvalidated).toBe(true)
  })
})
