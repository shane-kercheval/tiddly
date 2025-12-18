/**
 * Tests for useUIPreferencesStore.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useUIPreferencesStore } from './uiPreferencesStore'

describe('useUIPreferencesStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useUIPreferencesStore.setState({
      fullWidthLayout: false,
    })
  })

  describe('initial state', () => {
    it('has fullWidthLayout as false by default', () => {
      const { fullWidthLayout } = useUIPreferencesStore.getState()
      expect(fullWidthLayout).toBe(false)
    })
  })

  describe('toggleFullWidthLayout', () => {
    it('toggles from false to true', () => {
      const { toggleFullWidthLayout } = useUIPreferencesStore.getState()
      toggleFullWidthLayout()

      const { fullWidthLayout } = useUIPreferencesStore.getState()
      expect(fullWidthLayout).toBe(true)
    })

    it('toggles from true to false', () => {
      useUIPreferencesStore.setState({ fullWidthLayout: true })
      const { toggleFullWidthLayout } = useUIPreferencesStore.getState()
      toggleFullWidthLayout()

      const { fullWidthLayout } = useUIPreferencesStore.getState()
      expect(fullWidthLayout).toBe(false)
    })

    it('toggles multiple times', () => {
      const { toggleFullWidthLayout } = useUIPreferencesStore.getState()

      toggleFullWidthLayout()
      expect(useUIPreferencesStore.getState().fullWidthLayout).toBe(true)

      toggleFullWidthLayout()
      expect(useUIPreferencesStore.getState().fullWidthLayout).toBe(false)

      toggleFullWidthLayout()
      expect(useUIPreferencesStore.getState().fullWidthLayout).toBe(true)
    })
  })

  describe('setFullWidthLayout', () => {
    it('sets to true', () => {
      const { setFullWidthLayout } = useUIPreferencesStore.getState()
      setFullWidthLayout(true)

      const { fullWidthLayout } = useUIPreferencesStore.getState()
      expect(fullWidthLayout).toBe(true)
    })

    it('sets to false', () => {
      useUIPreferencesStore.setState({ fullWidthLayout: true })
      const { setFullWidthLayout } = useUIPreferencesStore.getState()
      setFullWidthLayout(false)

      const { fullWidthLayout } = useUIPreferencesStore.getState()
      expect(fullWidthLayout).toBe(false)
    })
  })
})
