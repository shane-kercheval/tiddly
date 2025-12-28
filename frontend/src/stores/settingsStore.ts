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
  /** Previous sidebar state for rollback on failed updates */
  _previousSidebar: SidebarOrderComputed | null
  isLoading: boolean
  error: string | null
}

interface SettingsActions {
  fetchSidebar: () => Promise<void>
  updateSidebar: (sidebar: SidebarOrder) => Promise<void>
  /**
   * Set sidebar items optimistically.
   * Stores the previous state for potential rollback.
   */
  setSidebarOptimistic: (items: SidebarItemComputed[]) => void
  /** Rollback to previous sidebar state after a failed update */
  rollbackSidebar: () => void
  clearError: () => void
}

type SettingsStore = SettingsState & SettingsActions

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  // State
  sidebar: null,
  _previousSidebar: null,
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
    // Clear previous state on successful save and update sidebar
    set({ sidebar: response.data, _previousSidebar: null })
  },

  setSidebarOptimistic: (items: SidebarItemComputed[]) => {
    set((state) => ({
      // Store current state for potential rollback (only if not already stored)
      _previousSidebar: state._previousSidebar ?? state.sidebar,
      sidebar: state.sidebar
        ? { ...state.sidebar, items }
        : null,
    }))
  },

  rollbackSidebar: () => {
    const previousSidebar = get()._previousSidebar
    if (previousSidebar) {
      set({ sidebar: previousSidebar, _previousSidebar: null })
    }
  },
}))
