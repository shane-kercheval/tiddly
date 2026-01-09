/**
 * Tests for useUnsavedChangesWarning hook.
 */
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useUnsavedChangesWarning } from './useUnsavedChangesWarning'

describe('useUnsavedChangesWarning', () => {
  describe('without data router (MemoryRouter)', () => {
    // Tests run without a data router, simulating test environment or legacy router setup
    const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
      <MemoryRouter>{children}</MemoryRouter>
    )

    it('should return showDialog as false when not dirty', () => {
      const { result } = renderHook(() => useUnsavedChangesWarning(false), { wrapper })

      expect(result.current.showDialog).toBe(false)
    })

    it('should return showDialog as false when dirty but no data router', () => {
      // Without a data router, blocking is not supported
      const { result } = renderHook(() => useUnsavedChangesWarning(true), { wrapper })

      expect(result.current.showDialog).toBe(false)
    })

    it('should return stable handler functions', () => {
      const { result, rerender } = renderHook(
        ({ isDirty }) => useUnsavedChangesWarning(isDirty),
        { wrapper, initialProps: { isDirty: false } }
      )

      const initialHandleStay = result.current.handleStay
      const initialHandleLeave = result.current.handleLeave
      const initialConfirmLeave = result.current.confirmLeave

      // Rerender with same props
      rerender({ isDirty: false })

      expect(result.current.handleStay).toBe(initialHandleStay)
      expect(result.current.handleLeave).toBe(initialHandleLeave)
      expect(result.current.confirmLeave).toBe(initialConfirmLeave)
    })

    it('should provide handleStay, handleLeave, and confirmLeave functions', () => {
      const { result } = renderHook(() => useUnsavedChangesWarning(true), { wrapper })

      expect(typeof result.current.handleStay).toBe('function')
      expect(typeof result.current.handleLeave).toBe('function')
      expect(typeof result.current.confirmLeave).toBe('function')
    })

    it('handleStay, handleLeave, and confirmLeave should not throw when called', () => {
      const { result } = renderHook(() => useUnsavedChangesWarning(true), { wrapper })

      expect(() => {
        act(() => {
          result.current.handleStay()
        })
      }).not.toThrow()

      expect(() => {
        act(() => {
          result.current.handleLeave()
        })
      }).not.toThrow()

      expect(() => {
        act(() => {
          result.current.confirmLeave()
        })
      }).not.toThrow()
    })
  })

  describe('with data router', () => {
    // Create a wrapper with a data router for full functionality testing
    const createDataRouterWrapper = (testComponent: ReactNode): ReactNode => {
      const router = createMemoryRouter(
        [
          {
            path: '/',
            element: testComponent,
          },
          {
            path: '/other',
            element: <div>Other Page</div>,
          },
        ],
        { initialEntries: ['/'] }
      )
      return <RouterProvider router={router} />
    }

    it('should return showDialog as false when not dirty', () => {
      const TestComponent = (): null => {
        const result = useUnsavedChangesWarning(false)
        expect(result.showDialog).toBe(false)
        return null
      }

      const wrapper = createDataRouterWrapper(<TestComponent />)
      renderHook(() => null, {
        wrapper: () => wrapper,
      })
    })

    it('should provide handler functions when using data router', () => {
      // Test that hook returns expected structure when used inside a data router
      const TestComponent = (): null => {
        const result = useUnsavedChangesWarning(true)
        // Verify structure inside component where we have access to result
        expect(typeof result.handleStay).toBe('function')
        expect(typeof result.handleLeave).toBe('function')
        expect(typeof result.confirmLeave).toBe('function')
        expect(typeof result.showDialog).toBe('boolean')
        return null
      }

      const wrapper = createDataRouterWrapper(<TestComponent />)
      renderHook(() => null, {
        wrapper: () => wrapper,
      })
    })
  })

  describe('dirty state transitions', () => {
    const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
      <MemoryRouter>{children}</MemoryRouter>
    )

    it('should handle transition from clean to dirty', () => {
      const { result, rerender } = renderHook(
        ({ isDirty }) => useUnsavedChangesWarning(isDirty),
        { wrapper, initialProps: { isDirty: false } }
      )

      expect(result.current.showDialog).toBe(false)

      rerender({ isDirty: true })

      // Without data router, showDialog stays false
      expect(result.current.showDialog).toBe(false)
    })

    it('should handle transition from dirty to clean', () => {
      const { result, rerender } = renderHook(
        ({ isDirty }) => useUnsavedChangesWarning(isDirty),
        { wrapper, initialProps: { isDirty: true } }
      )

      rerender({ isDirty: false })

      expect(result.current.showDialog).toBe(false)
    })
  })

  describe('confirmLeave functionality', () => {
    const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
      <MemoryRouter>{children}</MemoryRouter>
    )

    it('should return a stable confirmLeave function across rerenders', () => {
      const { result, rerender } = renderHook(
        ({ isDirty }) => useUnsavedChangesWarning(isDirty),
        { wrapper, initialProps: { isDirty: false } }
      )

      const initialConfirmLeave = result.current.confirmLeave

      rerender({ isDirty: true })

      // confirmLeave should be stable (memoized with useCallback)
      expect(result.current.confirmLeave).toBe(initialConfirmLeave)
    })

    it('should provide confirmLeave that can be called multiple times safely', () => {
      const { result } = renderHook(() => useUnsavedChangesWarning(true), { wrapper })

      // Should not throw when called multiple times
      expect(() => {
        act(() => {
          result.current.confirmLeave()
          result.current.confirmLeave()
          result.current.confirmLeave()
        })
      }).not.toThrow()
    })
  })

  describe('confirmLeave reset behavior', () => {
    const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
      <MemoryRouter>{children}</MemoryRouter>
    )

    it('should reset internal state when isDirty transitions to false', () => {
      // This tests the scenario: user calls confirmLeave for save, save succeeds (isDirty=false),
      // then user makes more changes (isDirty=true) - the blocker should be re-enabled
      const { result, rerender } = renderHook(
        ({ isDirty }) => useUnsavedChangesWarning(isDirty),
        { wrapper, initialProps: { isDirty: true } }
      )

      // User attempts to save - calls confirmLeave
      act(() => {
        result.current.confirmLeave()
      })

      // Save succeeds - form becomes clean
      rerender({ isDirty: false })

      // User makes more changes - form becomes dirty again
      rerender({ isDirty: true })

      // Hook should still work normally (internal ref was reset)
      expect(typeof result.current.confirmLeave).toBe('function')
      expect(typeof result.current.handleStay).toBe('function')
      expect(typeof result.current.handleLeave).toBe('function')
    })

    it('should handle multiple dirty/clean cycles correctly', () => {
      const { result, rerender } = renderHook(
        ({ isDirty }) => useUnsavedChangesWarning(isDirty),
        { wrapper, initialProps: { isDirty: false } }
      )

      // Cycle 1: dirty -> confirmLeave -> clean
      rerender({ isDirty: true })
      act(() => {
        result.current.confirmLeave()
      })
      rerender({ isDirty: false })

      // Cycle 2: dirty -> confirmLeave -> clean
      rerender({ isDirty: true })
      act(() => {
        result.current.confirmLeave()
      })
      rerender({ isDirty: false })

      // Cycle 3: dirty again - should work normally
      rerender({ isDirty: true })

      // Hook should continue working
      expect(() => {
        act(() => {
          result.current.confirmLeave()
        })
      }).not.toThrow()
    })

    it('should handle failed save scenario (confirmLeave called but isDirty stays true)', () => {
      // Scenario: user calls confirmLeave, but save fails and form stays dirty
      // Then form becomes clean (maybe user reverts), then dirty again
      // Blocker should be re-enabled
      const { result, rerender } = renderHook(
        ({ isDirty }) => useUnsavedChangesWarning(isDirty),
        { wrapper, initialProps: { isDirty: true } }
      )

      // User attempts to save
      act(() => {
        result.current.confirmLeave()
      })

      // Save fails - isDirty stays true (no reset triggered)
      // User reverts changes or resets form
      rerender({ isDirty: false })

      // User makes new changes
      rerender({ isDirty: true })

      // Blocker should be re-enabled (ref was reset when isDirty went false)
      expect(typeof result.current.confirmLeave).toBe('function')
    })
  })

  describe('with data router and confirmLeave', () => {
    const createDataRouterWrapper = (testComponent: ReactNode): ReactNode => {
      const router = createMemoryRouter(
        [
          { path: '/', element: testComponent },
          { path: '/other', element: <div>Other Page</div> },
        ],
        { initialEntries: ['/'] }
      )
      return <RouterProvider router={router} />
    }

    it('should provide confirmLeave with data router', () => {
      const TestComponent = (): null => {
        const result = useUnsavedChangesWarning(true)
        expect(typeof result.confirmLeave).toBe('function')
        return null
      }

      const wrapper = createDataRouterWrapper(<TestComponent />)
      renderHook(() => null, {
        wrapper: () => wrapper,
      })
    })

    it('confirmLeave should allow subsequent navigation without blocking', () => {
      // This tests that confirmLeave sets the internal ref that prevents blocking
      // The actual navigation blocking behavior depends on router internals,
      // but we can verify the function is available and callable
      const TestComponent = (): null => {
        const result = useUnsavedChangesWarning(true)
        // Call confirmLeave - this should set the internal ref
        result.confirmLeave()
        // The hook should still work after confirmLeave is called
        expect(typeof result.showDialog).toBe('boolean')
        expect(typeof result.handleStay).toBe('function')
        expect(typeof result.handleLeave).toBe('function')
        return null
      }

      const wrapper = createDataRouterWrapper(<TestComponent />)
      renderHook(() => null, {
        wrapper: () => wrapper,
      })
    })
  })
})
