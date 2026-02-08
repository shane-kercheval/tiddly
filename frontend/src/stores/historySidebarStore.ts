/**
 * Store for history sidebar visibility and width state.
 * Used by Layout to apply margin when sidebar is open.
 */
import { create } from 'zustand'

/** Default sidebar width in pixels */
export const DEFAULT_SIDEBAR_WIDTH = 384 // w-96 equivalent
export const MIN_SIDEBAR_WIDTH = 280
export const MAX_SIDEBAR_WIDTH = Infinity // Dynamic max calculated at resize time

// Storage key for persisting width
const STORAGE_KEY = 'history-sidebar-width'

// Load initial width from localStorage
function getInitialWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_SIDEBAR_WIDTH
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored) {
    const parsed = parseInt(stored, 10)
    if (!isNaN(parsed) && parsed >= MIN_SIDEBAR_WIDTH && parsed <= MAX_SIDEBAR_WIDTH) {
      return parsed
    }
  }
  return DEFAULT_SIDEBAR_WIDTH
}

interface HistorySidebarState {
  isOpen: boolean
  width: number
  setOpen: (open: boolean) => void
  setWidth: (width: number) => void
}

export const useHistorySidebarStore = create<HistorySidebarState>((set) => ({
  isOpen: false,
  width: getInitialWidth(),
  setOpen: (open) => set({ isOpen: open }),
  setWidth: (width) => {
    const clampedWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, width))
    // Persist to localStorage (safe guard against storage failures)
    try {
      localStorage.setItem(STORAGE_KEY, String(clampedWidth))
    } catch {
      // Ignore storage errors - in-memory state still updates
    }
    set({ width: clampedWidth })
  },
}))
