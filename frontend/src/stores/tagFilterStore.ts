/**
 * Zustand store for tag filters.
 * Persists selected tag filters across list/view navigation.
 */
import { create } from 'zustand'

export type TagMatchOption = 'all' | 'any'

interface TagFilterState {
  selectedTags: string[]
  tagMatch: TagMatchOption
}

interface TagFilterActions {
  addTag: (tag: string) => void
  removeTag: (tag: string) => void
  renameTag: (oldName: string, newName: string) => void
  setTags: (tags: string[]) => void
  setTagMatch: (match: TagMatchOption) => void
  clearFilters: () => void
}

type TagFilterStore = TagFilterState & TagFilterActions

export const useTagFilterStore = create<TagFilterStore>((set, get) => ({
  // State
  selectedTags: [],
  tagMatch: 'all',

  // Actions
  addTag: (tag: string) => {
    const { selectedTags } = get()
    if (!selectedTags.includes(tag)) {
      set({ selectedTags: [...selectedTags, tag] })
    }
  },

  removeTag: (tag: string) => {
    const { selectedTags } = get()
    set({ selectedTags: selectedTags.filter((t) => t !== tag) })
  },

  renameTag: (oldName: string, newName: string) => {
    const { selectedTags } = get()
    if (selectedTags.includes(oldName)) {
      set({ selectedTags: selectedTags.map((t) => (t === oldName ? newName : t)) })
    }
  },

  setTags: (tags: string[]) => {
    set({ selectedTags: tags })
  },

  setTagMatch: (match: TagMatchOption) => {
    set({ tagMatch: match })
  },

  clearFilters: () => {
    set({ selectedTags: [], tagMatch: 'all' })
  },
}))
