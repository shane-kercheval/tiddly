/**
 * Store for right sidebar panel state (history, table of contents).
 * Only one panel can be open at a time. Used by Layout to apply margin.
 */
import { create } from 'zustand'

export type SidebarPanel = 'history' | 'toc'

/** Default sidebar width in pixels */
export const DEFAULT_SIDEBAR_WIDTH = 400
export const MIN_SIDEBAR_WIDTH = 280
/** Minimum space reserved for content area (header buttons + padding) */
export const MIN_CONTENT_WIDTH = 600

// Storage keys for persisting state
const WIDTH_STORAGE_KEY = 'right-sidebar-width'
const PANEL_STORAGE_KEY = 'right-sidebar-panel'

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

// Load initial panel from localStorage (only 'history' is persisted; 'toc' is session-only)
function getInitialPanel(): SidebarPanel | null {
  if (typeof window === 'undefined') return null
  const stored = localStorage.getItem(PANEL_STORAGE_KEY)
  if (stored === 'history') return stored
  return null
}

interface RightSidebarState {
  activePanel: SidebarPanel | null
  width: number
  setActivePanel: (panel: SidebarPanel | null) => void
  togglePanel: (panel: SidebarPanel) => void
  setWidth: (width: number) => void
}

export const useRightSidebarStore = create<RightSidebarState>((set, get) => ({
  activePanel: getInitialPanel(),
  width: getInitialWidth(),
  setActivePanel: (panel) => {
    // Only persist 'history' to localStorage; 'toc' is session-only
    // (ToC requires specific page support and shouldn't restore on reload/navigation)
    try {
      localStorage.setItem(PANEL_STORAGE_KEY, panel === 'history' ? 'history' : '')
    } catch {
      // Ignore storage errors - in-memory state still updates
    }
    set({ activePanel: panel })
  },
  togglePanel: (panel) => {
    const current = get().activePanel
    const next = current === panel ? null : panel
    try {
      localStorage.setItem(PANEL_STORAGE_KEY, next === 'history' ? 'history' : '')
    } catch {
      // Ignore storage errors - in-memory state still updates
    }
    set({ activePanel: next })
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
