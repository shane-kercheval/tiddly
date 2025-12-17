/**
 * Tests for useBookmarkUrlParams hook.
 *
 * Note: Tag filters (selectedTags, tagMatch) are now managed by useTagFilterStore
 * for persistence across navigation. This hook only manages search, sort, and pagination.
 */
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useBookmarkUrlParams } from './useBookmarkUrlParams'

describe('useBookmarkUrlParams', () => {
  const createWrapper = (initialEntries: string[] = ['/']) => {
    return function Wrapper({ children }: { children: ReactNode }) {
      return (
        <MemoryRouter initialEntries={initialEntries}>
          {children}
        </MemoryRouter>
      )
    }
  }

  describe('parsing', () => {
    it('returns default values when no URL params', () => {
      const { result } = renderHook(() => useBookmarkUrlParams(), {
        wrapper: createWrapper(['/bookmarks']),
      })

      expect(result.current.searchQuery).toBe('')
      expect(result.current.sortBy).toBe('created_at')
      expect(result.current.sortOrder).toBe('desc')
      expect(result.current.offset).toBe(0)
    })

    it('parses search query from URL', () => {
      const { result } = renderHook(() => useBookmarkUrlParams(), {
        wrapper: createWrapper(['/bookmarks?q=react%20hooks']),
      })

      expect(result.current.searchQuery).toBe('react hooks')
    })

    it('parses sort_by from URL', () => {
      const { result } = renderHook(() => useBookmarkUrlParams(), {
        wrapper: createWrapper(['/bookmarks?sort_by=title']),
      })

      expect(result.current.sortBy).toBe('title')
    })

    it('parses sort_order from URL', () => {
      const { result } = renderHook(() => useBookmarkUrlParams(), {
        wrapper: createWrapper(['/bookmarks?sort_order=asc']),
      })

      expect(result.current.sortOrder).toBe('asc')
    })

    it('parses offset from URL', () => {
      const { result } = renderHook(() => useBookmarkUrlParams(), {
        wrapper: createWrapper(['/bookmarks?offset=50']),
      })

      expect(result.current.offset).toBe(50)
    })

    it('parses all params together', () => {
      const { result } = renderHook(() => useBookmarkUrlParams(), {
        wrapper: createWrapper(['/bookmarks?q=test&sort_by=title&sort_order=asc&offset=25']),
      })

      expect(result.current.searchQuery).toBe('test')
      expect(result.current.sortBy).toBe('title')
      expect(result.current.sortOrder).toBe('asc')
      expect(result.current.offset).toBe(25)
    })
  })

  describe('updateParams', () => {
    it('sets search query in URL', () => {
      const { result } = renderHook(() => useBookmarkUrlParams(), {
        wrapper: createWrapper(['/bookmarks']),
      })

      act(() => {
        result.current.updateParams({ q: 'react hooks' })
      })

      expect(result.current.searchQuery).toBe('react hooks')
    })

    it('removes search query from URL when empty', () => {
      const { result } = renderHook(() => useBookmarkUrlParams(), {
        wrapper: createWrapper(['/bookmarks?q=test']),
      })

      act(() => {
        result.current.updateParams({ q: '' })
      })

      expect(result.current.searchQuery).toBe('')
    })

    it('sets sort_by in URL when not default', () => {
      const { result } = renderHook(() => useBookmarkUrlParams(), {
        wrapper: createWrapper(['/bookmarks']),
      })

      act(() => {
        result.current.updateParams({ sort_by: 'title' })
      })

      expect(result.current.sortBy).toBe('title')
    })

    it('removes sort_by from URL when set to default "created_at"', () => {
      const { result } = renderHook(() => useBookmarkUrlParams(), {
        wrapper: createWrapper(['/bookmarks?sort_by=title']),
      })

      act(() => {
        result.current.updateParams({ sort_by: 'created_at' })
      })

      expect(result.current.sortBy).toBe('created_at')
    })

    it('sets sort_order in URL when not default', () => {
      const { result } = renderHook(() => useBookmarkUrlParams(), {
        wrapper: createWrapper(['/bookmarks']),
      })

      act(() => {
        result.current.updateParams({ sort_order: 'asc' })
      })

      expect(result.current.sortOrder).toBe('asc')
    })

    it('removes sort_order from URL when set to default "desc"', () => {
      const { result } = renderHook(() => useBookmarkUrlParams(), {
        wrapper: createWrapper(['/bookmarks?sort_order=asc']),
      })

      act(() => {
        result.current.updateParams({ sort_order: 'desc' })
      })

      expect(result.current.sortOrder).toBe('desc')
    })

    it('sets offset in URL when not zero', () => {
      const { result } = renderHook(() => useBookmarkUrlParams(), {
        wrapper: createWrapper(['/bookmarks']),
      })

      act(() => {
        result.current.updateParams({ offset: 50 })
      })

      expect(result.current.offset).toBe(50)
    })

    it('removes offset from URL when set to zero', () => {
      const { result } = renderHook(() => useBookmarkUrlParams(), {
        wrapper: createWrapper(['/bookmarks?offset=50']),
      })

      act(() => {
        result.current.updateParams({ offset: 0 })
      })

      expect(result.current.offset).toBe(0)
    })

    it('updates multiple params at once', () => {
      const { result } = renderHook(() => useBookmarkUrlParams(), {
        wrapper: createWrapper(['/bookmarks']),
      })

      act(() => {
        result.current.updateParams({
          q: 'search',
          sort_by: 'title',
          sort_order: 'asc',
        })
      })

      expect(result.current.searchQuery).toBe('search')
      expect(result.current.sortBy).toBe('title')
      expect(result.current.sortOrder).toBe('asc')
    })

    it('preserves existing params when updating others', () => {
      const { result } = renderHook(() => useBookmarkUrlParams(), {
        wrapper: createWrapper(['/bookmarks?q=existing&sort_by=title']),
      })

      act(() => {
        result.current.updateParams({ offset: 25 })
      })

      expect(result.current.searchQuery).toBe('existing')
      expect(result.current.sortBy).toBe('title')
      expect(result.current.offset).toBe(25)
    })
  })
})
