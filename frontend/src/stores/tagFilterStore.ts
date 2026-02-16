/**
 * Zustand store for tag filters.
 * State is keyed per view (e.g. 'active', 'archived', 'search', 'filter:{id}')
 * so tag selections in different views are isolated from each other.
 */
import { create } from 'zustand'

export type TagMatchOption = 'all' | 'any'

/** Shared empty array to maintain referential stability for uninitialized views */
const EMPTY_TAGS: string[] = []

interface TagFilterState {
  /** Selected tags per view key */
  selectedTags: Record<string, string[]>
  /** Tag match mode per view key */
  tagMatch: Record<string, TagMatchOption>
}

interface TagFilterActions {
  getSelectedTags: (view: string) => string[]
  getTagMatch: (view: string) => TagMatchOption
  addTag: (view: string, tag: string) => void
  removeTag: (view: string, tag: string) => void
  setTags: (view: string, tags: string[]) => void
  setTagMatch: (view: string, match: TagMatchOption) => void
  clearFilters: (view: string) => void
  renameTagAllViews: (oldName: string, newName: string) => void
  removeTagAllViews: (tag: string) => void
}

type TagFilterStore = TagFilterState & TagFilterActions

export const useTagFilterStore = create<TagFilterStore>((set, get) => ({
  // State
  selectedTags: {},
  tagMatch: {},

  // Getters
  getSelectedTags: (view: string): string[] => {
    return get().selectedTags[view] ?? EMPTY_TAGS
  },

  getTagMatch: (view: string): TagMatchOption => {
    return get().tagMatch[view] ?? 'all'
  },

  // Actions
  addTag: (view: string, tag: string) => {
    const current = get().selectedTags[view] ?? []
    if (!current.includes(tag)) {
      set((state) => ({
        selectedTags: {
          ...state.selectedTags,
          [view]: [...current, tag],
        },
      }))
    }
  },

  removeTag: (view: string, tag: string) => {
    const current = get().selectedTags[view] ?? []
    set((state) => ({
      selectedTags: {
        ...state.selectedTags,
        [view]: current.filter((t) => t !== tag),
      },
    }))
  },

  setTags: (view: string, tags: string[]) => {
    set((state) => ({
      selectedTags: {
        ...state.selectedTags,
        [view]: tags,
      },
    }))
  },

  setTagMatch: (view: string, match: TagMatchOption) => {
    set((state) => ({
      tagMatch: {
        ...state.tagMatch,
        [view]: match,
      },
    }))
  },

  clearFilters: (view: string) => {
    set((state) => {
      const newTags = { ...state.selectedTags }
      delete newTags[view]
      const newMatch = { ...state.tagMatch }
      delete newMatch[view]
      return {
        selectedTags: newTags,
        tagMatch: newMatch,
      }
    })
  },

  // Cross-view operations (used by SettingsTags)
  renameTagAllViews: (oldName: string, newName: string) => {
    set((state) => {
      const updated: Record<string, string[]> = {}
      for (const [view, tags] of Object.entries(state.selectedTags)) {
        if (tags.includes(oldName)) {
          updated[view] = tags.map((t) => (t === oldName ? newName : t))
        } else {
          updated[view] = tags
        }
      }
      return { selectedTags: updated }
    })
  },

  removeTagAllViews: (tag: string) => {
    set((state) => {
      const updated: Record<string, string[]> = {}
      for (const [view, tags] of Object.entries(state.selectedTags)) {
        updated[view] = tags.filter((t) => t !== tag)
      }
      return { selectedTags: updated }
    })
  },
}))
