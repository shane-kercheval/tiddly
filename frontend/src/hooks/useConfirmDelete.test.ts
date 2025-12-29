import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useConfirmDelete, DEFAULT_CONFIRM_TIMEOUT } from './useConfirmDelete'

describe('useConfirmDelete', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('initial state', () => {
    it('should start with isConfirming as false', () => {
      const { result } = renderHook(() =>
        useConfirmDelete({ onConfirm: vi.fn() })
      )

      expect(result.current.isConfirming).toBe(false)
    })

    it('should provide a buttonRef', () => {
      const { result } = renderHook(() =>
        useConfirmDelete({ onConfirm: vi.fn() })
      )

      expect(result.current.buttonRef).toBeDefined()
      expect(result.current.buttonRef.current).toBeNull()
    })
  })

  describe('two-click pattern', () => {
    it('should set isConfirming to true on first click', () => {
      const onConfirm = vi.fn()
      const { result } = renderHook(() =>
        useConfirmDelete({ onConfirm })
      )

      act(() => {
        result.current.handleClick()
      })

      expect(result.current.isConfirming).toBe(true)
      expect(onConfirm).not.toHaveBeenCalled()
    })

    it('should call onConfirm and reset state on second click', () => {
      const onConfirm = vi.fn()
      const { result } = renderHook(() =>
        useConfirmDelete({ onConfirm })
      )

      // First click
      act(() => {
        result.current.handleClick()
      })

      expect(result.current.isConfirming).toBe(true)

      // Second click
      act(() => {
        result.current.handleClick()
      })

      expect(result.current.isConfirming).toBe(false)
      expect(onConfirm).toHaveBeenCalledTimes(1)
    })

    it('should stop propagation and prevent default when event is provided', () => {
      const onConfirm = vi.fn()
      const { result } = renderHook(() =>
        useConfirmDelete({ onConfirm })
      )

      const mockEvent = {
        stopPropagation: vi.fn(),
        preventDefault: vi.fn(),
      } as unknown as React.MouseEvent

      act(() => {
        result.current.handleClick(mockEvent)
      })

      expect(mockEvent.stopPropagation).toHaveBeenCalled()
      expect(mockEvent.preventDefault).toHaveBeenCalled()
    })
  })

  describe('timeout reset', () => {
    it('should reset isConfirming after default timeout', () => {
      const onConfirm = vi.fn()
      const { result } = renderHook(() =>
        useConfirmDelete({ onConfirm })
      )

      act(() => {
        result.current.handleClick()
      })

      expect(result.current.isConfirming).toBe(true)

      // Fast-forward past the timeout
      act(() => {
        vi.advanceTimersByTime(DEFAULT_CONFIRM_TIMEOUT)
      })

      expect(result.current.isConfirming).toBe(false)
      expect(onConfirm).not.toHaveBeenCalled()
    })

    it('should reset isConfirming after custom timeout', () => {
      const onConfirm = vi.fn()
      const customTimeout = 5000
      const { result } = renderHook(() =>
        useConfirmDelete({ onConfirm, timeout: customTimeout })
      )

      act(() => {
        result.current.handleClick()
      })

      expect(result.current.isConfirming).toBe(true)

      // Fast-forward less than the custom timeout
      act(() => {
        vi.advanceTimersByTime(customTimeout - 100)
      })

      expect(result.current.isConfirming).toBe(true)

      // Fast-forward past the custom timeout
      act(() => {
        vi.advanceTimersByTime(200)
      })

      expect(result.current.isConfirming).toBe(false)
    })

    it('should clear timeout on second click before timeout expires', () => {
      const onConfirm = vi.fn()
      const { result } = renderHook(() =>
        useConfirmDelete({ onConfirm })
      )

      // First click
      act(() => {
        result.current.handleClick()
      })

      // Second click before timeout
      act(() => {
        vi.advanceTimersByTime(1000)
        result.current.handleClick()
      })

      expect(result.current.isConfirming).toBe(false)
      expect(onConfirm).toHaveBeenCalledTimes(1)

      // Ensure timeout callback doesn't fire
      act(() => {
        vi.advanceTimersByTime(DEFAULT_CONFIRM_TIMEOUT)
      })

      // No additional state changes expected
      expect(result.current.isConfirming).toBe(false)
    })
  })

  describe('click outside detection', () => {
    it('should reset isConfirming when clicking outside the button', () => {
      const onConfirm = vi.fn()
      const { result } = renderHook(() =>
        useConfirmDelete({ onConfirm })
      )

      // Create and set button ref
      const button = document.createElement('button')
      document.body.appendChild(button)

      // Manually set the ref (since we're testing the hook in isolation)
      act(() => {
        ;(result.current.buttonRef as React.MutableRefObject<HTMLButtonElement | null>).current = button
      })

      // First click to enter confirming state
      act(() => {
        result.current.handleClick()
      })

      expect(result.current.isConfirming).toBe(true)

      // Click outside
      act(() => {
        document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      })

      expect(result.current.isConfirming).toBe(false)
      expect(onConfirm).not.toHaveBeenCalled()

      // Cleanup
      document.body.removeChild(button)
    })

    it('should NOT reset when clicking on the button itself', () => {
      const onConfirm = vi.fn()
      const { result } = renderHook(() =>
        useConfirmDelete({ onConfirm })
      )

      // Create and set button ref
      const button = document.createElement('button')
      document.body.appendChild(button)

      act(() => {
        ;(result.current.buttonRef as React.MutableRefObject<HTMLButtonElement | null>).current = button
      })

      // First click to enter confirming state
      act(() => {
        result.current.handleClick()
      })

      expect(result.current.isConfirming).toBe(true)

      // Click on the button (dispatch event with button as target)
      act(() => {
        const event = new MouseEvent('mousedown', { bubbles: true })
        button.dispatchEvent(event)
      })

      // Should still be in confirming state (click-outside handler ignores clicks on the button)
      expect(result.current.isConfirming).toBe(true)

      // Cleanup
      document.body.removeChild(button)
    })
  })

  describe('isDeleting prop', () => {
    it('should not respond to clicks when isDeleting is true', () => {
      const onConfirm = vi.fn()
      const { result } = renderHook(() =>
        useConfirmDelete({ onConfirm, isDeleting: true })
      )

      act(() => {
        result.current.handleClick()
      })

      expect(result.current.isConfirming).toBe(false)
      expect(onConfirm).not.toHaveBeenCalled()
    })

    it('should not confirm when isDeleting becomes true during confirmation', () => {
      const onConfirm = vi.fn()
      const { result, rerender } = renderHook(
        ({ isDeleting }) => useConfirmDelete({ onConfirm, isDeleting }),
        { initialProps: { isDeleting: false } }
      )

      // First click
      act(() => {
        result.current.handleClick()
      })

      expect(result.current.isConfirming).toBe(true)

      // isDeleting becomes true
      rerender({ isDeleting: true })

      // Second click should not work
      act(() => {
        result.current.handleClick()
      })

      expect(onConfirm).not.toHaveBeenCalled()
    })
  })

  describe('reset function', () => {
    it('should reset isConfirming when called', () => {
      const onConfirm = vi.fn()
      const { result } = renderHook(() =>
        useConfirmDelete({ onConfirm })
      )

      act(() => {
        result.current.handleClick()
      })

      expect(result.current.isConfirming).toBe(true)

      act(() => {
        result.current.reset()
      })

      expect(result.current.isConfirming).toBe(false)
      expect(onConfirm).not.toHaveBeenCalled()
    })

    it('should clear pending timeout when reset is called', () => {
      const onConfirm = vi.fn()
      const { result } = renderHook(() =>
        useConfirmDelete({ onConfirm })
      )

      act(() => {
        result.current.handleClick()
      })

      act(() => {
        result.current.reset()
      })

      // Fast-forward past what would have been the timeout
      act(() => {
        vi.advanceTimersByTime(DEFAULT_CONFIRM_TIMEOUT + 1000)
      })

      // Should remain in reset state
      expect(result.current.isConfirming).toBe(false)
    })
  })

  describe('cleanup on unmount', () => {
    it('should clear timeout when component unmounts', () => {
      const onConfirm = vi.fn()
      const { result, unmount } = renderHook(() =>
        useConfirmDelete({ onConfirm })
      )

      act(() => {
        result.current.handleClick()
      })

      expect(result.current.isConfirming).toBe(true)

      // Unmount before timeout
      unmount()

      // Fast-forward past the timeout - should not cause errors
      act(() => {
        vi.advanceTimersByTime(DEFAULT_CONFIRM_TIMEOUT + 1000)
      })

      // No assertions needed - test passes if no errors occur
    })
  })

  describe('async onConfirm', () => {
    it('should work with async onConfirm callbacks', async () => {
      const onConfirm = vi.fn().mockResolvedValue(undefined)
      const { result } = renderHook(() =>
        useConfirmDelete({ onConfirm })
      )

      // First click
      act(() => {
        result.current.handleClick()
      })

      // Second click
      act(() => {
        result.current.handleClick()
      })

      expect(onConfirm).toHaveBeenCalledTimes(1)
    })
  })
})
