/**
 * Zustand store for content filters.
 * Shared state between Settings and Bookmarks pages.
 */
import { create } from 'zustand'
import { api } from '../services/api'
import type { ContentFilter, ContentFilterCreate, ContentFilterUpdate } from '../types'

interface FiltersState {
  filters: ContentFilter[]
  isLoading: boolean
  error: string | null
}

interface FiltersActions {
  fetchFilters: () => Promise<void>
  createFilter: (data: ContentFilterCreate) => Promise<ContentFilter>
  updateFilter: (id: string, data: ContentFilterUpdate) => Promise<ContentFilter>
  deleteFilter: (id: string) => Promise<void>
  clearError: () => void
}

type FiltersStore = FiltersState & FiltersActions

export const useFiltersStore = create<FiltersStore>((set, get) => ({
  // State
  filters: [],
  isLoading: false,
  error: null,

  // Actions
  fetchFilters: async () => {
    set({ isLoading: true, error: null })
    try {
      const response = await api.get<ContentFilter[]>('/filters/')
      set({ filters: response.data, isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch filters'
      set({ isLoading: false, error: message })
    }
  },

  createFilter: async (data: ContentFilterCreate) => {
    const response = await api.post<ContentFilter>('/filters/', data)
    const newFilter = response.data
    set({ filters: [...get().filters, newFilter] })
    return newFilter
  },

  updateFilter: async (id: string, data: ContentFilterUpdate) => {
    const response = await api.patch<ContentFilter>(`/filters/${id}`, data)
    const updatedFilter = response.data
    set({
      filters: get().filters.map((filter) =>
        filter.id === id ? updatedFilter : filter
      ),
    })
    return updatedFilter
  },

  deleteFilter: async (id: string) => {
    await api.delete(`/filters/${id}`)
    set({ filters: get().filters.filter((filter) => filter.id !== id) })
  },

  clearError: () => {
    set({ error: null })
  },
}))
