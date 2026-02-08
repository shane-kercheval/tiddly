/**
 * Store for history sidebar visibility and width state.
 * Used by Layout to apply margin when sidebar is open.
 */
import { create } from 'zustand'

/** Default sidebar width in pixels */
export const DEFAULT_SIDEBAR_WIDTH = 450
export const MIN_SIDEBAR_WIDTH = 280
/** Minimum space reserved for content area (header buttons + padding) */
export const MIN_CONTENT_WIDTH = 600

// Storage keys for persisting state
const WIDTH_STORAGE_KEY = 'history-sidebar-width'
const OPEN_STORAGE_KEY = 'history-sidebar-open'

// Load initial width from localStorage
function getInitialWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_SIDEBAR_WIDTH
  const stored = localStorage.getItem(WIDTH_STORAGE_KEY)
  if (stored) {
    const parsed = parseInt(stored, 10)
    if (!isNaN(parsed) && parsed >= MIN_SIDEBAR_WIDTH) {
      return parsed
    }
  }
  return DEFAULT_SIDEBAR_WIDTH
}

// Load initial open state from localStorage
function getInitialOpen(): boolean {
  if (typeof window === 'undefined') return false
  return localStorage.getItem(OPEN_STORAGE_KEY) === 'true'
}

interface SetOpenOptions {
  /** Whether to persist to localStorage (default: true). Pass false for cleanup-only closes. */
  persist?: boolean
}

interface HistorySidebarState {
  isOpen: boolean
  width: number
  setOpen: (open: boolean, options?: SetOpenOptions) => void
  setWidth: (width: number) => void
}

export const useHistorySidebarStore = create<HistorySidebarState>((set) => ({
  isOpen: getInitialOpen(),
  width: getInitialWidth(),
  setOpen: (open, options) => {
    if (options?.persist !== false) {
      try {
        localStorage.setItem(OPEN_STORAGE_KEY, String(open))
      } catch {
        // Ignore storage errors - in-memory state still updates
      }
    }
    set({ isOpen: open })
  },
  setWidth: (width) => {
    const clampedWidth = Math.max(MIN_SIDEBAR_WIDTH, width)
    try {
      localStorage.setItem(WIDTH_STORAGE_KEY, String(clampedWidth))
    } catch {
      // Ignore storage errors - in-memory state still updates
    }
    set({ width: clampedWidth })
  },
}))
