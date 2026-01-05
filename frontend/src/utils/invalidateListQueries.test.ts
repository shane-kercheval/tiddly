/**
 * Tests for invalidateListQueries utility.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { invalidateListQueries } from './invalidateListQueries'
import { bookmarkKeys } from '../hooks/useBookmarksQuery'
import { noteKeys } from '../hooks/useNotesQuery'
import { promptKeys } from '../hooks/usePromptsQuery'
import { contentKeys } from '../hooks/useContentQuery'

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

  it('should invalidate bookmark, note, and prompt queries for the same list', async () => {
    const listParams = { list_id: 7, offset: 0, limit: 10 }

    queryClient.setQueryData(bookmarkKeys.list(listParams), { items: [], total: 0 })
    queryClient.setQueryData(noteKeys.list(listParams), { items: [], total: 0 })
    queryClient.setQueryData(promptKeys.list(listParams), { items: [], total: 0 })

    await invalidateListQueries(queryClient, 7)

    const bookmarkState = queryClient.getQueryState(bookmarkKeys.list(listParams))
    const noteState = queryClient.getQueryState(noteKeys.list(listParams))
    const promptState = queryClient.getQueryState(promptKeys.list(listParams))

    expect(bookmarkState?.isInvalidated).toBe(true)
    expect(noteState?.isInvalidated).toBe(true)
    expect(promptState?.isInvalidated).toBe(true)
  })

  it('should invalidate prompt queries for the specified list', async () => {
    // Set up cached queries for different lists
    const list5Params = { list_id: 5, offset: 0, limit: 10 }
    const list10Params = { list_id: 10, offset: 0, limit: 10 }

    queryClient.setQueryData(promptKeys.list(list5Params), { items: [], total: 0 })
    queryClient.setQueryData(promptKeys.list(list10Params), { items: [], total: 0 })

    // Invalidate list 5
    await invalidateListQueries(queryClient, 5)

    // List 5 should be invalidated (stale)
    const list5State = queryClient.getQueryState(promptKeys.list(list5Params))
    expect(list5State?.isInvalidated).toBe(true)

    // List 10 should NOT be invalidated
    const list10State = queryClient.getQueryState(promptKeys.list(list10Params))
    expect(list10State?.isInvalidated).toBe(false)
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

  it('should invalidate content queries for the specified list', async () => {
    // Set up cached content queries for different lists
    const list5Params = { view: 'active' as const, list_id: 5, offset: 0, limit: 10 }
    const list10Params = { view: 'active' as const, list_id: 10, offset: 0, limit: 10 }

    queryClient.setQueryData(contentKeys.list(list5Params), { items: [], total: 0 })
    queryClient.setQueryData(contentKeys.list(list10Params), { items: [], total: 0 })

    // Invalidate list 5
    await invalidateListQueries(queryClient, 5)

    // List 5 should be invalidated (stale)
    const list5State = queryClient.getQueryState(contentKeys.list(list5Params))
    expect(list5State?.isInvalidated).toBe(true)

    // List 10 should NOT be invalidated
    const list10State = queryClient.getQueryState(contentKeys.list(list10Params))
    expect(list10State?.isInvalidated).toBe(false)
  })

  it('should invalidate bookmark, note, prompt, and content queries for the same list', async () => {
    const listParams = { list_id: 7, offset: 0, limit: 10 }
    const contentParams = { view: 'active' as const, list_id: 7, offset: 0, limit: 10 }

    queryClient.setQueryData(bookmarkKeys.list(listParams), { items: [], total: 0 })
    queryClient.setQueryData(noteKeys.list(listParams), { items: [], total: 0 })
    queryClient.setQueryData(promptKeys.list(listParams), { items: [], total: 0 })
    queryClient.setQueryData(contentKeys.list(contentParams), { items: [], total: 0 })

    await invalidateListQueries(queryClient, 7)

    const bookmarkState = queryClient.getQueryState(bookmarkKeys.list(listParams))
    const noteState = queryClient.getQueryState(noteKeys.list(listParams))
    const promptState = queryClient.getQueryState(promptKeys.list(listParams))
    const contentState = queryClient.getQueryState(contentKeys.list(contentParams))

    expect(bookmarkState?.isInvalidated).toBe(true)
    expect(noteState?.isInvalidated).toBe(true)
    expect(promptState?.isInvalidated).toBe(true)
    expect(contentState?.isInvalidated).toBe(true)
  })

  it('should not invalidate content queries without list_id (builtin views)', async () => {
    // Set up a custom list query and a regular "All" view query (no list_id)
    const customListParams = { view: 'active' as const, list_id: 5, offset: 0, limit: 10 }
    const allViewParams = { view: 'active' as const, offset: 0, limit: 10 }

    queryClient.setQueryData(contentKeys.list(customListParams), { items: [], total: 0 })
    queryClient.setQueryData(contentKeys.list(allViewParams), { items: [], total: 0 })

    await invalidateListQueries(queryClient, 5)

    // Custom list should be invalidated
    const customState = queryClient.getQueryState(contentKeys.list(customListParams))
    expect(customState?.isInvalidated).toBe(true)

    // "All" view (no list_id) should NOT be invalidated
    const allState = queryClient.getQueryState(contentKeys.list(allViewParams))
    expect(allState?.isInvalidated).toBe(false)
  })
})
