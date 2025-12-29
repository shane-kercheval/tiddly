/**
 * Zustand store for sidebar state.
 * Manages collapse/expand state with localStorage persistence.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface SidebarState {
  isCollapsed: boolean
  expandedSections: string[]
  /** Group IDs that are collapsed (groups start expanded by default) */
  collapsedGroupIds: string[]
  isMobileOpen: boolean
}

interface SidebarActions {
  toggleCollapse: () => void
  setCollapsed: (collapsed: boolean) => void
  toggleSection: (section: string) => void
  setSectionExpanded: (section: string, expanded: boolean) => void
  /** Toggle a group's collapsed state */
  toggleGroup: (groupId: string) => void
  /** Check if a group is collapsed */
  isGroupCollapsed: (groupId: string) => boolean
  toggleMobile: () => void
  closeMobile: () => void
}

type SidebarStore = SidebarState & SidebarActions

export const useSidebarStore = create<SidebarStore>()(
  persist(
    (set, get) => ({
      // State - sections expanded by default (shared is non-collapsible, so doesn't need to be here)
      isCollapsed: false,
      expandedSections: ['bookmarks', 'notes', 'settings'],
      collapsedGroupIds: [], // Groups start expanded by default
      isMobileOpen: false,

      // Actions
      toggleCollapse: () => {
        set((state) => ({ isCollapsed: !state.isCollapsed }))
      },

      setCollapsed: (collapsed: boolean) => {
        set({ isCollapsed: collapsed })
      },

      toggleSection: (section: string) => {
        set((state) => {
          const isExpanded = state.expandedSections.includes(section)
          return {
            expandedSections: isExpanded
              ? state.expandedSections.filter((s) => s !== section)
              : [...state.expandedSections, section],
          }
        })
      },

      setSectionExpanded: (section: string, expanded: boolean) => {
        set((state) => {
          const isCurrentlyExpanded = state.expandedSections.includes(section)
          if (expanded && !isCurrentlyExpanded) {
            return { expandedSections: [...state.expandedSections, section] }
          } else if (!expanded && isCurrentlyExpanded) {
            return { expandedSections: state.expandedSections.filter((s) => s !== section) }
          }
          return state
        })
      },

      toggleGroup: (groupId: string) => {
        set((state) => {
          const isCollapsed = state.collapsedGroupIds.includes(groupId)
          return {
            collapsedGroupIds: isCollapsed
              ? state.collapsedGroupIds.filter((id) => id !== groupId)
              : [...state.collapsedGroupIds, groupId],
          }
        })
      },

      isGroupCollapsed: (groupId: string) => {
        return get().collapsedGroupIds.includes(groupId)
      },

      toggleMobile: () => {
        set((state) => ({ isMobileOpen: !state.isMobileOpen }))
      },

      closeMobile: () => {
        set({ isMobileOpen: false })
      },
    }),
    {
      name: 'sidebar-storage',
      // Only persist collapse state and expanded sections/groups, not mobile state
      partialize: (state) => ({
        isCollapsed: state.isCollapsed,
        expandedSections: state.expandedSections,
        collapsedGroupIds: state.collapsedGroupIds,
      }),
    }
  )
)
