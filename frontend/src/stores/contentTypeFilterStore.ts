/**
 * Zustand store for content type filter state.
 *
 * Manages which content types (bookmark, note) are shown in the All/Archived/Trash views.
 * State persists to localStorage per view.
 */
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { ContentType } from '../types'

/** All available content types */
export const ALL_CONTENT_TYPES: ContentType[] = ['bookmark', 'note']

interface ContentTypeFilterState {
  /** Selected content types per view (active, archived, deleted) */
  selectedTypes: Record<string, ContentType[]>

  /** Get selected types for a view. Returns all types if not set. */
  getSelectedTypes: (view: string) => ContentType[]

  /** Toggle a content type for a view. Ensures at least one type is always selected. */
  toggleType: (view: string, type: ContentType) => void

  /** Set content types for a view directly */
  setTypes: (view: string, types: ContentType[]) => void
}

export const useContentTypeFilterStore = create<ContentTypeFilterState>()(
  persist(
    (set, get) => ({
      selectedTypes: {},

      getSelectedTypes: (view: string): ContentType[] => {
        const types = get().selectedTypes[view]
        // If not set or empty, return all types
        if (!types || types.length === 0) {
          return ALL_CONTENT_TYPES
        }
        return types
      },

      toggleType: (view: string, type: ContentType): void => {
        set((state) => {
          const currentTypes = state.selectedTypes[view] || [...ALL_CONTENT_TYPES]
          const isSelected = currentTypes.includes(type)

          // If trying to deselect and it's the last one, don't allow
          if (isSelected && currentTypes.length === 1) {
            return state
          }

          const newTypes = isSelected
            ? currentTypes.filter((t) => t !== type)
            : [...currentTypes, type]

          return {
            selectedTypes: {
              ...state.selectedTypes,
              [view]: newTypes,
            },
          }
        })
      },

      setTypes: (view: string, types: ContentType[]): void => {
        // Ensure at least one type is selected
        const validTypes = types.length > 0 ? types : ALL_CONTENT_TYPES
        set((state) => ({
          selectedTypes: {
            ...state.selectedTypes,
            [view]: validTypes,
          },
        }))
      },
    }),
    {
      name: 'content-type-filter',
      storage: createJSONStorage(() => localStorage),
    }
  )
)
