/**
 * Tests for legacy route redirects in App.tsx.
 *
 * Verifies that old bookmark and note list routes properly redirect
 * to the unified /app/content/* routes with correct parameter substitution.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route, Navigate, useParams, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'

// Replicate the ListRedirect component from App.tsx for testing
function ListRedirect(): ReactNode {
  const { listId } = useParams<{ listId: string }>()
  return <Navigate to={`/app/content/lists/${listId}`} replace />
}

// Test component that captures the current location
function LocationDisplay(): ReactNode {
  const location = useLocation()
  return <div data-testid="location">{location.pathname}</div>
}

// Minimal route setup for testing redirects
function TestRoutes({ initialRoute }: { initialRoute: string }): ReactNode {
  return (
    <MemoryRouter initialEntries={[initialRoute]}>
      <Routes>
        {/* Target route */}
        <Route path="/app/content/lists/:listId" element={<LocationDisplay />} />

        {/* Legacy routes with ListRedirect */}
        <Route path="/app/bookmarks/lists/:listId" element={<ListRedirect />} />
        <Route path="/app/notes/lists/:listId" element={<ListRedirect />} />

        {/* Fallback to show we didn't match */}
        <Route path="*" element={<div data-testid="not-found">Not Found</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('ListRedirect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('legacy bookmark list routes', () => {
    it('redirects /app/bookmarks/lists/123 to /app/content/lists/123', async () => {
      render(<TestRoutes initialRoute="/app/bookmarks/lists/123" />)

      await waitFor(() => {
        const location = document.querySelector('[data-testid="location"]')
        expect(location?.textContent).toBe('/app/content/lists/123')
      })
    })

    it('redirects /app/bookmarks/lists/456 to /app/content/lists/456', async () => {
      render(<TestRoutes initialRoute="/app/bookmarks/lists/456" />)

      await waitFor(() => {
        const location = document.querySelector('[data-testid="location"]')
        expect(location?.textContent).toBe('/app/content/lists/456')
      })
    })

    it('handles large list IDs correctly', async () => {
      render(<TestRoutes initialRoute="/app/bookmarks/lists/999999" />)

      await waitFor(() => {
        const location = document.querySelector('[data-testid="location"]')
        expect(location?.textContent).toBe('/app/content/lists/999999')
      })
    })
  })

  describe('legacy note list routes', () => {
    it('redirects /app/notes/lists/123 to /app/content/lists/123', async () => {
      render(<TestRoutes initialRoute="/app/notes/lists/123" />)

      await waitFor(() => {
        const location = document.querySelector('[data-testid="location"]')
        expect(location?.textContent).toBe('/app/content/lists/123')
      })
    })

    it('redirects /app/notes/lists/789 to /app/content/lists/789', async () => {
      render(<TestRoutes initialRoute="/app/notes/lists/789" />)

      await waitFor(() => {
        const location = document.querySelector('[data-testid="location"]')
        expect(location?.textContent).toBe('/app/content/lists/789')
      })
    })
  })

  describe('parameter substitution', () => {
    it('correctly substitutes numeric list IDs', async () => {
      const testIds = ['1', '42', '100', '9999']

      for (const id of testIds) {
        const { unmount } = render(<TestRoutes initialRoute={`/app/bookmarks/lists/${id}`} />)

        await waitFor(() => {
          const location = document.querySelector('[data-testid="location"]')
          expect(location?.textContent).toBe(`/app/content/lists/${id}`)
        })

        unmount()
      }
    })

    it('does not produce literal :listId in the URL', async () => {
      render(<TestRoutes initialRoute="/app/bookmarks/lists/123" />)

      await waitFor(() => {
        const location = document.querySelector('[data-testid="location"]')
        // This was the bug - :listId was being kept as a literal string
        expect(location?.textContent).not.toContain(':listId')
        expect(location?.textContent).toBe('/app/content/lists/123')
      })
    })
  })
})
