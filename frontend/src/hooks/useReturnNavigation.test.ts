/**
 * Tests for useReturnNavigation hook.
 *
 * Covers navigateBack() routing with/without returnTo, state forwarding
 * (stripping returnTo while passing through extra state), and createReturnState().
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useReturnNavigation } from './useReturnNavigation'

// Mock react-router-dom
const mockNavigate = vi.fn()
let mockLocation: { pathname: string; search: string; state: unknown } = {
  pathname: '/app/notes/1',
  search: '',
  state: null,
}

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => mockLocation,
}))

describe('useReturnNavigation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLocation = { pathname: '/app/notes/1', search: '', state: null }
  })

  describe('navigateBack', () => {
    it('navigates to returnTo URL when present', () => {
      mockLocation.state = { returnTo: '/app/content?q=test' }
      const { result } = renderHook(() => useReturnNavigation())

      act(() => result.current.navigateBack())

      expect(mockNavigate).toHaveBeenCalledWith('/app/content?q=test')
    })

    it('falls back to /app/content when no returnTo', () => {
      mockLocation.state = null
      const { result } = renderHook(() => useReturnNavigation())

      act(() => result.current.navigateBack())

      expect(mockNavigate).toHaveBeenCalledWith('/app/content')
    })

    it('forwards extra state while stripping returnTo', () => {
      mockLocation.state = {
        returnTo: '/app/content',
        selectedContentIndex: 3,
      }
      const { result } = renderHook(() => useReturnNavigation())

      act(() => result.current.navigateBack())

      expect(mockNavigate).toHaveBeenCalledWith('/app/content', {
        state: { selectedContentIndex: 3 },
      })
    })

    it('passes no state when only returnTo is present', () => {
      mockLocation.state = { returnTo: '/app/content' }
      const { result } = renderHook(() => useReturnNavigation())

      act(() => result.current.navigateBack())

      expect(mockNavigate).toHaveBeenCalledWith('/app/content')
    })
  })

  describe('createReturnState', () => {
    it('returns state with current pathname and search', () => {
      mockLocation.pathname = '/app/content'
      mockLocation.search = '?q=hello'
      const { result } = renderHook(() => useReturnNavigation())

      expect(result.current.createReturnState()).toEqual({
        returnTo: '/app/content?q=hello',
      })
    })

    it('returns state with pathname only when no search', () => {
      mockLocation.pathname = '/app/content'
      mockLocation.search = ''
      const { result } = renderHook(() => useReturnNavigation())

      expect(result.current.createReturnState()).toEqual({
        returnTo: '/app/content',
      })
    })
  })
})
