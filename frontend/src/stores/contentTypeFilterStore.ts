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
  getSelectedTypes: (view: string, availableTypes?: ContentType[]) => ContentType[]

  /** Toggle a content type for a view. Ensures at least one type is always selected. */
  toggleType: (view: string, type: ContentType, availableTypes?: ContentType[]) => void

  /** Set content types for a view directly */
  setTypes: (view: string, types: ContentType[], availableTypes?: ContentType[]) => void
}

export const useContentTypeFilterStore = create<ContentTypeFilterState>()(
  persist(
    (set, get) => ({
      selectedTypes: {},

      getSelectedTypes: (view: string, availableTypes = ALL_CONTENT_TYPES): ContentType[] => {
        const resolvedAvailableTypes = availableTypes.length > 0 ? availableTypes : ALL_CONTENT_TYPES
        const types = get().selectedTypes[view]
        if (!types || types.length === 0) {
          return resolvedAvailableTypes
        }
        const filteredTypes = types.filter((type) => resolvedAvailableTypes.includes(type))
        return filteredTypes.length > 0 ? filteredTypes : resolvedAvailableTypes
      },

      toggleType: (view: string, type: ContentType, availableTypes = ALL_CONTENT_TYPES): void => {
        set((state) => {
          const resolvedAvailableTypes = availableTypes.length > 0 ? availableTypes : ALL_CONTENT_TYPES
          const currentTypes = state.selectedTypes[view]
            ? state.selectedTypes[view].filter((currentType) => resolvedAvailableTypes.includes(currentType))
            : [...resolvedAvailableTypes]
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

      setTypes: (view: string, types: ContentType[], availableTypes = ALL_CONTENT_TYPES): void => {
        const resolvedAvailableTypes = availableTypes.length > 0 ? availableTypes : ALL_CONTENT_TYPES
        const filteredTypes = types.filter((type) => resolvedAvailableTypes.includes(type))
        const validTypes = filteredTypes.length > 0 ? filteredTypes : resolvedAvailableTypes
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
