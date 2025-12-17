/**
 * Zustand store for local UI preferences.
 * Persists to localStorage without needing API calls.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface UIPreferencesState {
  /** Whether to use full width layout instead of constrained width */
  fullWidthLayout: boolean
}

interface UIPreferencesActions {
  toggleFullWidthLayout: () => void
  setFullWidthLayout: (value: boolean) => void
}

type UIPreferencesStore = UIPreferencesState & UIPreferencesActions

export const useUIPreferencesStore = create<UIPreferencesStore>()(
  persist(
    (set) => ({
      // State
      fullWidthLayout: false,

      // Actions
      toggleFullWidthLayout: () => {
        set((state) => ({ fullWidthLayout: !state.fullWidthLayout }))
      },

      setFullWidthLayout: (value: boolean) => {
        set({ fullWidthLayout: value })
      },
    }),
    {
      name: 'ui-preferences',
    }
  )
)
