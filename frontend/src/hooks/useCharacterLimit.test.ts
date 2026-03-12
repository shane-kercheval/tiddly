/**
 * Tests for useCharacterLimit hook.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useCharacterLimit } from './useCharacterLimit'

describe('useCharacterLimit', () => {
  beforeEach(() => {
    // Default to light mode
    window.matchMedia = vi.fn((query: string) => ({ matches: false, media: query })) as unknown as typeof window.matchMedia
  })

  describe('when maxLength is undefined', () => {
    it('should return inactive defaults', () => {
      const { result } = renderHook(() => useCharacterLimit(50, undefined))
      expect(result.current.exceeded).toBe(false)
      expect(result.current.showCounter).toBe(false)
      expect(result.current.counterText).toBe('')
      expect(result.current.message).toBeUndefined()
      expect(result.current.color).toBe('')
    })
  })

  describe('short fields (default mode)', () => {
    it('should not show counter below 70%', () => {
      const { result } = renderHook(() => useCharacterLimit(69, 100))
      expect(result.current.showCounter).toBe(false)
      expect(result.current.exceeded).toBe(false)
    })

    it('should show counter at exactly 70%', () => {
      const { result } = renderHook(() => useCharacterLimit(70, 100))
      expect(result.current.showCounter).toBe(true)
      expect(result.current.message).toBeUndefined()
      expect(result.current.exceeded).toBe(false)
    })

    it('should show counter between 70% and 100% with no message', () => {
      const { result } = renderHook(() => useCharacterLimit(85, 100))
      expect(result.current.showCounter).toBe(true)
      expect(result.current.message).toBeUndefined()
      expect(result.current.exceeded).toBe(false)
    })

    it('should show "Character limit reached" at exactly 100%', () => {
      const { result } = renderHook(() => useCharacterLimit(100, 100))
      expect(result.current.showCounter).toBe(true)
      expect(result.current.message).toBe('Character limit reached')
      expect(result.current.exceeded).toBe(false)
    })

    it('should show exceeded message above 100%', () => {
      const { result } = renderHook(() => useCharacterLimit(105, 100))
      expect(result.current.showCounter).toBe(true)
      expect(result.current.message).toBe('Character limit exceeded - saving is disabled')
      expect(result.current.exceeded).toBe(true)
    })

    it('should format counterText with toLocaleString', () => {
      // Use a ratio >= 0.7 so counter is visible
      const { result } = renderHook(() => useCharacterLimit(1500, 2048))
      expect(result.current.counterText).toBe('1,500 / 2,048')
    })

    it('should return a valid hex color when showing counter', () => {
      const { result } = renderHook(() => useCharacterLimit(85, 100))
      expect(result.current.color).toMatch(/^#[0-9a-f]{6}$/)
    })
  })

  describe('content fields (alwaysShow mode)', () => {
    it('should show counter even below 70%', () => {
      const { result } = renderHook(() => useCharacterLimit(10, 100, { alwaysShow: true }))
      expect(result.current.showCounter).toBe(true)
      expect(result.current.message).toBeUndefined()
      expect(result.current.exceeded).toBe(false)
    })

    it('should still return showCounter=false when maxLength is undefined', () => {
      const { result } = renderHook(() => useCharacterLimit(10, undefined, { alwaysShow: true }))
      expect(result.current.showCounter).toBe(false)
    })

    it('should use gray-400 color below 85%', () => {
      const { result } = renderHook(() => useCharacterLimit(50, 100, { alwaysShow: true }))
      expect(result.current.color).toBe('#9ca3af')
    })

    it('should transition orange→red from 85%+', () => {
      const at85 = renderHook(() => useCharacterLimit(85, 100, { alwaysShow: true }))
      const at100 = renderHook(() => useCharacterLimit(100, 100, { alwaysShow: true }))
      // At 85% should be orange, at 100% should be red
      expect(at85.result.current.color).not.toBe(at100.result.current.color)
    })

    it('should show reached message at 100%', () => {
      const { result } = renderHook(() => useCharacterLimit(100, 100, { alwaysShow: true }))
      expect(result.current.message).toBe('Character limit reached')
      expect(result.current.exceeded).toBe(false)
    })

    it('should show exceeded message above 100%', () => {
      const { result } = renderHook(() => useCharacterLimit(110, 100, { alwaysShow: true }))
      expect(result.current.message).toBe('Character limit exceeded - saving is disabled')
      expect(result.current.exceeded).toBe(true)
    })
  })
})
