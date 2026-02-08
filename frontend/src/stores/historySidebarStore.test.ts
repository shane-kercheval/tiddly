/**
 * Tests for history sidebar store.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  useHistorySidebarStore,
  DEFAULT_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
} from './historySidebarStore'

describe('historySidebarStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useHistorySidebarStore.setState({ isOpen: false, width: DEFAULT_SIDEBAR_WIDTH })
    // Clear localStorage
    localStorage.clear()
  })

  describe('initial state', () => {
    it('should start with sidebar closed', () => {
      const { isOpen } = useHistorySidebarStore.getState()
      expect(isOpen).toBe(false)
    })
  })

  describe('setOpen', () => {
    it('should open the sidebar when called with true', () => {
      const { setOpen } = useHistorySidebarStore.getState()

      setOpen(true)

      expect(useHistorySidebarStore.getState().isOpen).toBe(true)
    })

    it('should close the sidebar when called with false', () => {
      // Start with sidebar open
      useHistorySidebarStore.setState({ isOpen: true })
      const { setOpen } = useHistorySidebarStore.getState()

      setOpen(false)

      expect(useHistorySidebarStore.getState().isOpen).toBe(false)
    })

    it('should allow toggling between open and closed states', () => {
      const { setOpen } = useHistorySidebarStore.getState()

      setOpen(true)
      expect(useHistorySidebarStore.getState().isOpen).toBe(true)

      setOpen(false)
      expect(useHistorySidebarStore.getState().isOpen).toBe(false)

      setOpen(true)
      expect(useHistorySidebarStore.getState().isOpen).toBe(true)
    })

    it('should persist open state to localStorage', () => {
      const { setOpen } = useHistorySidebarStore.getState()

      setOpen(true)
      expect(localStorage.getItem('history-sidebar-open')).toBe('true')

      setOpen(false)
      expect(localStorage.getItem('history-sidebar-open')).toBe('false')
    })

    it('should not persist when persist: false is passed', () => {
      const { setOpen } = useHistorySidebarStore.getState()

      // First persist open state
      setOpen(true)
      expect(localStorage.getItem('history-sidebar-open')).toBe('true')

      // Close without persisting (used by cleanup effects)
      setOpen(false, { persist: false })
      expect(useHistorySidebarStore.getState().isOpen).toBe(false)
      // localStorage still has 'true' from the explicit open
      expect(localStorage.getItem('history-sidebar-open')).toBe('true')
    })

    it('should handle localStorage errors gracefully', () => {
      const { setOpen } = useHistorySidebarStore.getState()
      const originalSetItem = localStorage.setItem
      localStorage.setItem = vi.fn(() => {
        throw new Error('Storage quota exceeded')
      })

      expect(() => setOpen(true)).not.toThrow()
      expect(useHistorySidebarStore.getState().isOpen).toBe(true)

      localStorage.setItem = originalSetItem
    })
  })

  describe('setWidth', () => {
    it('should update width within valid range', () => {
      const { setWidth } = useHistorySidebarStore.getState()

      setWidth(500)

      expect(useHistorySidebarStore.getState().width).toBe(500)
    })

    it('should clamp width to minimum boundary', () => {
      const { setWidth } = useHistorySidebarStore.getState()

      setWidth(100) // Below MIN_SIDEBAR_WIDTH (280)

      expect(useHistorySidebarStore.getState().width).toBe(MIN_SIDEBAR_WIDTH)
    })

    it('should accept large widths (dynamic max handled at resize time)', () => {
      const { setWidth } = useHistorySidebarStore.getState()

      setWidth(1000) // Large value - store accepts it, dynamic max is enforced during resize

      expect(useHistorySidebarStore.getState().width).toBe(1000)
    })

    it('should persist width to localStorage', () => {
      const { setWidth } = useHistorySidebarStore.getState()

      setWidth(600)

      expect(localStorage.getItem('history-sidebar-width')).toBe('600')
    })

    it('should handle localStorage errors gracefully', () => {
      const { setWidth } = useHistorySidebarStore.getState()
      const originalSetItem = localStorage.setItem
      localStorage.setItem = vi.fn(() => {
        throw new Error('Storage quota exceeded')
      })

      // Should not throw, state should still update
      expect(() => setWidth(500)).not.toThrow()
      expect(useHistorySidebarStore.getState().width).toBe(500)

      localStorage.setItem = originalSetItem
    })
  })

  describe('initial width from localStorage', () => {
    it('should use default width when localStorage is empty', () => {
      expect(useHistorySidebarStore.getState().width).toBe(DEFAULT_SIDEBAR_WIDTH)
    })
  })
})
