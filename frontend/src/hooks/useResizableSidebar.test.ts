/**
 * Tests for useResizableSidebar hook.
 *
 * Covers:
 * - Width clamping to viewport constraints
 * - Responsive breakpoint detection (desktop vs mobile)
 * - Drag state management (mousedown, mousemove, mouseup)
 * - Body style changes during drag
 * - Window resize constrains width
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useResizableSidebar } from './useResizableSidebar'
import { useRightSidebarStore, DEFAULT_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH } from '../stores/rightSidebarStore'

// We don't mock the store — we use the real Zustand store and reset it between tests.
// This gives higher confidence that the hook integrates correctly.

// Save original window.innerWidth descriptor
let originalInnerWidth: PropertyDescriptor | undefined

function setWindowWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width,
  })
}

beforeEach(() => {
  originalInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth')
  // Default to desktop width
  setWindowWidth(1400)
  // Reset store
  useRightSidebarStore.setState({ activePanel: null, width: DEFAULT_SIDEBAR_WIDTH })
  // No left sidebar element by default
  document.getElementById('desktop-sidebar')?.remove()
})

afterEach(() => {
  if (originalInnerWidth) {
    Object.defineProperty(window, 'innerWidth', originalInnerWidth)
  }
  document.body.style.userSelect = ''
  document.body.style.cursor = ''
})

describe('useResizableSidebar', () => {
  describe('initial state', () => {
    it('should return store width on desktop', () => {
      useRightSidebarStore.setState({ width: 500 })
      const { result } = renderHook(() => useResizableSidebar())

      expect(result.current.width).toBe(500)
      expect(result.current.isDesktop).toBe(true)
      expect(result.current.isDragging).toBe(false)
    })

    it('should detect mobile breakpoint', () => {
      setWindowWidth(600)
      const { result } = renderHook(() => useResizableSidebar())

      expect(result.current.isDesktop).toBe(false)
    })

    it('should detect desktop breakpoint', () => {
      setWindowWidth(1024)
      const { result } = renderHook(() => useResizableSidebar())

      expect(result.current.isDesktop).toBe(true)
    })

    it('should detect mobile at exactly 767px', () => {
      setWindowWidth(767)
      const { result } = renderHook(() => useResizableSidebar())

      expect(result.current.isDesktop).toBe(false)
    })

    it('should detect desktop at exactly 768px', () => {
      setWindowWidth(768)
      const { result } = renderHook(() => useResizableSidebar())

      expect(result.current.isDesktop).toBe(true)
    })
  })

  describe('width clamping', () => {
    it('should clamp width to max when store width exceeds viewport', () => {
      // Window 1400px, no left sidebar, MIN_CONTENT_WIDTH=600
      // Max = max(280, 1400 - 0 - 600) = 800
      useRightSidebarStore.setState({ width: 1000 })
      const { result } = renderHook(() => useResizableSidebar())

      expect(result.current.width).toBe(800)
    })

    it('should not clamp width when within viewport bounds', () => {
      // Max = 800, store = 500 → no clamping
      useRightSidebarStore.setState({ width: 500 })
      const { result } = renderHook(() => useResizableSidebar())

      expect(result.current.width).toBe(500)
    })

    it('should account for left sidebar width in max calculation', () => {
      // Create a left sidebar element
      const sidebar = document.createElement('div')
      sidebar.id = 'desktop-sidebar'
      // jsdom doesn't compute layout, getBoundingClientRect returns zeros
      // So left sidebar width will be 0; this just verifies the element lookup works
      document.body.appendChild(sidebar)

      useRightSidebarStore.setState({ width: 500 })
      const { result } = renderHook(() => useResizableSidebar())

      expect(result.current.width).toBe(500)

      sidebar.remove()
    })

    it('should constrain store width on window resize', () => {
      // Start with width that fits
      useRightSidebarStore.setState({ width: 500 })
      renderHook(() => useResizableSidebar())

      // Shrink window so max becomes smaller than stored width
      // New max = max(280, 700 - 0 - 600) = 280 (since MIN_SIDEBAR_WIDTH clamping applies in store)
      setWindowWidth(700)
      act(() => {
        window.dispatchEvent(new Event('resize'))
      })

      // Store should have been constrained
      // max = max(280, 700 - 0 - 600) = 280
      // 500 > 280, so store gets set to 280
      expect(useRightSidebarStore.getState().width).toBe(MIN_SIDEBAR_WIDTH)
    })
  })

  describe('drag behavior', () => {
    it('should set isDragging on handleMouseDown', () => {
      const { result } = renderHook(() => useResizableSidebar())

      expect(result.current.isDragging).toBe(false)

      act(() => {
        const mockEvent = { preventDefault: vi.fn() } as unknown as React.MouseEvent
        result.current.handleMouseDown(mockEvent)
      })

      expect(result.current.isDragging).toBe(true)
    })

    it('should call preventDefault on mousedown', () => {
      const { result } = renderHook(() => useResizableSidebar())
      const preventDefault = vi.fn()

      act(() => {
        const mockEvent = { preventDefault } as unknown as React.MouseEvent
        result.current.handleMouseDown(mockEvent)
      })

      expect(preventDefault).toHaveBeenCalledOnce()
    })

    it('should update width on mousemove during drag', () => {
      useRightSidebarStore.setState({ width: 400 })
      const { result } = renderHook(() => useResizableSidebar())

      // Start drag
      act(() => {
        const mockEvent = { preventDefault: vi.fn() } as unknown as React.MouseEvent
        result.current.handleMouseDown(mockEvent)
      })

      // Simulate mousemove at clientX=1000 with window.innerWidth=1400
      // newWidth = 1400 - 1000 = 400
      act(() => {
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 1000 }))
      })

      expect(useRightSidebarStore.getState().width).toBe(400)
    })

    it('should clamp width to max on mousemove', () => {
      useRightSidebarStore.setState({ width: 400 })
      const { result } = renderHook(() => useResizableSidebar())

      // Start drag
      act(() => {
        const mockEvent = { preventDefault: vi.fn() } as unknown as React.MouseEvent
        result.current.handleMouseDown(mockEvent)
      })

      // Simulate mousemove at clientX=100 → newWidth = 1400 - 100 = 1300
      // max = max(280, 1400 - 0 - 600) = 800
      // Clamped to 800
      act(() => {
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100 }))
      })

      expect(useRightSidebarStore.getState().width).toBe(800)
    })

    it('should clear isDragging on mouseup', () => {
      const { result } = renderHook(() => useResizableSidebar())

      // Start drag
      act(() => {
        const mockEvent = { preventDefault: vi.fn() } as unknown as React.MouseEvent
        result.current.handleMouseDown(mockEvent)
      })
      expect(result.current.isDragging).toBe(true)

      // Release
      act(() => {
        document.dispatchEvent(new MouseEvent('mouseup'))
      })

      expect(result.current.isDragging).toBe(false)
    })

    it('should set body styles during drag and clear on mouseup', () => {
      const { result } = renderHook(() => useResizableSidebar())

      // Start drag
      act(() => {
        const mockEvent = { preventDefault: vi.fn() } as unknown as React.MouseEvent
        result.current.handleMouseDown(mockEvent)
      })

      expect(document.body.style.userSelect).toBe('none')
      expect(document.body.style.cursor).toBe('ew-resize')

      // Release
      act(() => {
        document.dispatchEvent(new MouseEvent('mouseup'))
      })

      expect(document.body.style.userSelect).toBe('')
      expect(document.body.style.cursor).toBe('')
    })

    it('should not respond to mousemove when not dragging', () => {
      useRightSidebarStore.setState({ width: 400 })
      renderHook(() => useResizableSidebar())

      // Simulate mousemove without starting drag
      act(() => {
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 1000 }))
      })

      // Width unchanged
      expect(useRightSidebarStore.getState().width).toBe(400)
    })
  })

  describe('cleanup', () => {
    it('should remove resize listener on unmount', () => {
      const removeEventListener = vi.spyOn(window, 'removeEventListener')
      const { unmount } = renderHook(() => useResizableSidebar())

      unmount()

      expect(removeEventListener).toHaveBeenCalledWith('resize', expect.any(Function))
      removeEventListener.mockRestore()
    })

    it('should clean up drag listeners and body styles on unmount during drag', () => {
      const { result, unmount } = renderHook(() => useResizableSidebar())

      // Start drag
      act(() => {
        const mockEvent = { preventDefault: vi.fn() } as unknown as React.MouseEvent
        result.current.handleMouseDown(mockEvent)
      })

      expect(document.body.style.userSelect).toBe('none')

      // Unmount while dragging
      unmount()

      expect(document.body.style.userSelect).toBe('')
      expect(document.body.style.cursor).toBe('')
    })
  })
})
