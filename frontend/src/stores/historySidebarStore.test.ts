/**
 * Tests for history sidebar store.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useHistorySidebarStore } from './historySidebarStore'

describe('historySidebarStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useHistorySidebarStore.setState({ isOpen: false })
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
  })
})
