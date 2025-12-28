/**
 * Zustand store for user settings.
 * Manages sidebar order and other user preferences.
 */
import { create } from 'zustand'
import { api } from '../services/api'
import type {
  SidebarOrderComputed,
  SidebarOrder,
  SidebarItemComputed,
} from '../types'

interface SettingsState {
  sidebar: SidebarOrderComputed | null
  isLoading: boolean
  error: string | null
}

interface SettingsActions {
  fetchSidebar: () => Promise<void>
  updateSidebar: (sidebar: SidebarOrder) => Promise<void>
  setSidebarOptimistic: (items: SidebarItemComputed[]) => void
  clearError: () => void
}

type SettingsStore = SettingsState & SettingsActions

export const useSettingsStore = create<SettingsStore>((set) => ({
  // State
  sidebar: null,
  isLoading: false,
  error: null,

  // Actions
  clearError: () => {
    set({ error: null })
  },

  fetchSidebar: async () => {
    set({ isLoading: true, error: null })
    try {
      const response = await api.get<SidebarOrderComputed>('/settings/sidebar')
      set({ sidebar: response.data, isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch sidebar'
      set({ isLoading: false, error: message })
    }
  },

  updateSidebar: async (sidebar: SidebarOrder) => {
    await api.put('/settings/sidebar', sidebar)
    // Refresh the computed sidebar after saving
    const response = await api.get<SidebarOrderComputed>('/settings/sidebar')
    set({ sidebar: response.data })
  },

  setSidebarOptimistic: (items: SidebarItemComputed[]) => {
    set((state) => ({
      sidebar: state.sidebar
        ? { ...state.sidebar, items }
        : null,
    }))
  },
}))
