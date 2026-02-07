/**
 * Store for history sidebar visibility state.
 * Used by Layout to apply margin when sidebar is open.
 */
import { create } from 'zustand'

/**
 * Shared width classes for the history sidebar.
 * Co-located here to keep Layout margin and HistorySidebar width in sync.
 */
export const HISTORY_SIDEBAR_WIDTH_CLASS = 'w-96'
export const HISTORY_SIDEBAR_MARGIN_CLASS = 'md:mr-96'

interface HistorySidebarState {
  isOpen: boolean
  setOpen: (open: boolean) => void
}

export const useHistorySidebarStore = create<HistorySidebarState>((set) => ({
  isOpen: false,
  setOpen: (open) => set({ isOpen: open }),
}))
