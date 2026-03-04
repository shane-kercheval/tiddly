/**
 * Tests for filtersStore.
 *
 * Covers the hasFetched flag behavior for gating content queries.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useFiltersStore } from './filtersStore'

// Mock the api module
vi.mock('../services/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}))

import { api } from '../services/api'

describe('filtersStore', () => {
  beforeEach(() => {
    // Reset store state between tests
    useFiltersStore.setState({
      filters: [],
      isLoading: false,
      error: null,
      hasFetched: false,
    })
    vi.clearAllMocks()
  })

  it('should initialize hasFetched as false', () => {
    const state = useFiltersStore.getState()
    expect(state.hasFetched).toBe(false)
  })

  it('should set hasFetched to true after successful fetchFilters', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [{ id: '1', name: 'Test' }] })

    await useFiltersStore.getState().fetchFilters()

    const state = useFiltersStore.getState()
    expect(state.hasFetched).toBe(true)
    expect(state.filters).toEqual([{ id: '1', name: 'Test' }])
    expect(state.error).toBeNull()
  })

  it('should set hasFetched to true after failed fetchFilters', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('Network error'))

    await useFiltersStore.getState().fetchFilters()

    const state = useFiltersStore.getState()
    expect(state.hasFetched).toBe(true)
    expect(state.filters).toEqual([])
    expect(state.error).toBe('Network error')
  })
})
