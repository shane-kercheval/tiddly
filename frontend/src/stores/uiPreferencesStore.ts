/**
 * Zustand store for local UI preferences.
 * Persists to localStorage without needing API calls.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type SortByOption = 'created_at' | 'updated_at' | 'last_used_at' | 'title'
export type SortOrderOption = 'asc' | 'desc'

interface UIPreferencesState {
  /** Whether to use full width layout instead of constrained width */
  fullWidthLayout: boolean
  /** Bookmark sort field */
  bookmarkSortBy: SortByOption
  /** Bookmark sort order */
  bookmarkSortOrder: SortOrderOption
}

interface UIPreferencesActions {
  toggleFullWidthLayout: () => void
  setFullWidthLayout: (value: boolean) => void
  setBookmarkSort: (sortBy: SortByOption, sortOrder: SortOrderOption) => void
}

type UIPreferencesStore = UIPreferencesState & UIPreferencesActions

export const useUIPreferencesStore = create<UIPreferencesStore>()(
  persist(
    (set) => ({
      // State
      fullWidthLayout: false,
      bookmarkSortBy: 'last_used_at',
      bookmarkSortOrder: 'desc',

      // Actions
      toggleFullWidthLayout: () => {
        set((state) => ({ fullWidthLayout: !state.fullWidthLayout }))
      },

      setFullWidthLayout: (value: boolean) => {
        set({ fullWidthLayout: value })
      },

      setBookmarkSort: (sortBy: SortByOption, sortOrder: SortOrderOption) => {
        set({ bookmarkSortBy: sortBy, bookmarkSortOrder: sortOrder })
      },
    }),
    {
      name: 'ui-preferences',
    }
  )
)
