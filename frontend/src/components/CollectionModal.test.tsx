/**
 * Tests for CollectionModal component.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CollectionModal } from './CollectionModal'
import type { ContentFilter, SidebarCollectionComputed } from '../types'

// Mock filters for testing
const mockFilters: ContentFilter[] = [
  {
    id: 'filter-1',
    name: 'Work Filter',
    content_types: ['bookmark', 'note'],
    filter_expression: { groups: [{ tags: ['work'], operator: 'AND' }], group_operator: 'OR' },
    default_sort_by: null,
    default_sort_ascending: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  },
  {
    id: 'filter-2',
    name: 'Personal Filter',
    content_types: ['bookmark'],
    filter_expression: { groups: [{ tags: ['personal'], operator: 'AND' }], group_operator: 'OR' },
    default_sort_by: null,
    default_sort_ascending: null,
    created_at: '2024-01-02T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
  },
  {
    id: 'filter-3',
    name: 'Projects Filter',
    content_types: ['note'],
    filter_expression: { groups: [{ tags: ['projects'], operator: 'AND' }], group_operator: 'OR' },
    default_sort_by: null,
    default_sort_ascending: null,
    created_at: '2024-01-03T00:00:00Z',
    updated_at: '2024-01-03T00:00:00Z',
  },
]

// Mock collection for edit mode
const mockCollection: SidebarCollectionComputed = {
  type: 'collection',
  id: 'collection-1',
  name: 'My Collection',
  items: [
    { type: 'filter', id: 'filter-1', name: 'Work Filter', content_types: ['bookmark', 'note'] },
  ],
}

describe('CollectionModal', () => {
  const mockOnClose = vi.fn()
  const mockOnCreate = vi.fn()
  const mockOnUpdate = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('renders with correct title for create mode', () => {
      render(
        <CollectionModal
          isOpen={true}
          onClose={mockOnClose}
          availableFilters={mockFilters}
          onCreate={mockOnCreate}
        />
      )

      expect(screen.getByRole('heading', { name: /Create Collection/ })).toBeInTheDocument()
    })

    it('renders with correct title for edit mode', () => {
      render(
        <CollectionModal
          isOpen={true}
          onClose={mockOnClose}
          collection={mockCollection}
          availableFilters={mockFilters}
          onUpdate={mockOnUpdate}
        />
      )

      expect(screen.getByRole('heading', { name: /Edit Collection/ })).toBeInTheDocument()
    })

    it('renders help icon with tooltip', () => {
      render(
        <CollectionModal
          isOpen={true}
          onClose={mockOnClose}
          availableFilters={mockFilters}
          onCreate={mockOnCreate}
        />
      )

      // Help icon should be present in the title
      const helpIcon = document.querySelector('svg[class*="cursor-help"]')
      expect(helpIcon).toBeInTheDocument()
    })

    it('renders empty state when no filters selected', () => {
      render(
        <CollectionModal
          isOpen={true}
          onClose={mockOnClose}
          availableFilters={mockFilters}
          onCreate={mockOnCreate}
        />
      )

      expect(screen.getByText('Select filters from below to add to this collection.')).toBeInTheDocument()
    })

    it('renders empty state when no filters available', () => {
      render(
        <CollectionModal
          isOpen={true}
          onClose={mockOnClose}
          availableFilters={[]}
          onCreate={mockOnCreate}
        />
      )

      expect(screen.getByText(/No filters available/)).toBeInTheDocument()
    })

    it('does not render when closed', () => {
      render(
        <CollectionModal
          isOpen={false}
          onClose={mockOnClose}
          availableFilters={mockFilters}
          onCreate={mockOnCreate}
        />
      )

      expect(screen.queryByRole('heading', { name: 'Create Collection' })).not.toBeInTheDocument()
    })
  })

  describe('create mode', () => {
    it('initializes with empty name and no selected filters', () => {
      render(
        <CollectionModal
          isOpen={true}
          onClose={mockOnClose}
          availableFilters={mockFilters}
          onCreate={mockOnCreate}
        />
      )

      const nameInput = screen.getByLabelText('Collection Name') as HTMLInputElement
      expect(nameInput.value).toBe('')
      expect(screen.getByText('Select filters from below to add to this collection.')).toBeInTheDocument()
    })

    it('shows all filters as available to add', () => {
      render(
        <CollectionModal
          isOpen={true}
          onClose={mockOnClose}
          availableFilters={mockFilters}
          onCreate={mockOnCreate}
        />
      )

      expect(screen.getByRole('button', { name: '+ Work Filter' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '+ Personal Filter' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '+ Projects Filter' })).toBeInTheDocument()
    })

    it('calls onCreate with name and filter IDs on submit', async () => {
      mockOnCreate.mockResolvedValueOnce(undefined)
      const user = userEvent.setup()

      render(
        <CollectionModal
          isOpen={true}
          onClose={mockOnClose}
          availableFilters={mockFilters}
          onCreate={mockOnCreate}
        />
      )

      await user.type(screen.getByLabelText('Collection Name'), 'My New Collection')
      await user.click(screen.getByRole('button', { name: '+ Work Filter' }))
      await user.click(screen.getByRole('button', { name: 'Create Collection' }))

      await waitFor(() => {
        expect(mockOnCreate).toHaveBeenCalledWith('My New Collection', ['filter-1'])
      })
      expect(mockOnClose).toHaveBeenCalled()
    })

    it('can create collection with no filters selected', async () => {
      mockOnCreate.mockResolvedValueOnce(undefined)
      const user = userEvent.setup()

      render(
        <CollectionModal
          isOpen={true}
          onClose={mockOnClose}
          availableFilters={mockFilters}
          onCreate={mockOnCreate}
        />
      )

      await user.type(screen.getByLabelText('Collection Name'), 'Empty Collection')
      await user.click(screen.getByRole('button', { name: 'Create Collection' }))

      await waitFor(() => {
        expect(mockOnCreate).toHaveBeenCalledWith('Empty Collection', [])
      })
    })
  })

  describe('edit mode', () => {
    it('initializes with existing name and selected filters', () => {
      render(
        <CollectionModal
          isOpen={true}
          onClose={mockOnClose}
          collection={mockCollection}
          availableFilters={mockFilters}
          onUpdate={mockOnUpdate}
        />
      )

      const nameInput = screen.getByLabelText('Collection Name') as HTMLInputElement
      expect(nameInput.value).toBe('My Collection')
      // Work Filter should be in selected section (as a tag with remove button)
      expect(screen.getByText('Work Filter')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Remove Work Filter' })).toBeInTheDocument()
    })

    it('calls onUpdate with updated data on submit', async () => {
      mockOnUpdate.mockResolvedValueOnce(undefined)
      const user = userEvent.setup()

      render(
        <CollectionModal
          isOpen={true}
          onClose={mockOnClose}
          collection={mockCollection}
          availableFilters={mockFilters}
          onUpdate={mockOnUpdate}
        />
      )

      await user.clear(screen.getByLabelText('Collection Name'))
      await user.type(screen.getByLabelText('Collection Name'), 'Updated Collection')
      await user.click(screen.getByRole('button', { name: '+ Personal Filter' }))
      await user.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => {
        expect(mockOnUpdate).toHaveBeenCalledWith(
          'collection-1',
          'Updated Collection',
          ['filter-1', 'filter-2']
        )
      })
    })

    it('shows Save button instead of Create Collection button', () => {
      render(
        <CollectionModal
          isOpen={true}
          onClose={mockOnClose}
          collection={mockCollection}
          availableFilters={mockFilters}
          onUpdate={mockOnUpdate}
        />
      )

      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Create Collection' })).not.toBeInTheDocument()
    })
  })

  describe('filter selection', () => {
    it('adds filter when clicking add button', async () => {
      const user = userEvent.setup()

      render(
        <CollectionModal
          isOpen={true}
          onClose={mockOnClose}
          availableFilters={mockFilters}
          onCreate={mockOnCreate}
        />
      )

      await user.click(screen.getByRole('button', { name: '+ Work Filter' }))

      // Filter should now appear in selected section
      expect(screen.getByText('Work Filter')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Remove Work Filter' })).toBeInTheDocument()
      // Filter should no longer appear in available section
      expect(screen.queryByRole('button', { name: '+ Work Filter' })).not.toBeInTheDocument()
    })

    it('removes filter when clicking remove button', async () => {
      const user = userEvent.setup()

      render(
        <CollectionModal
          isOpen={true}
          onClose={mockOnClose}
          collection={mockCollection}
          availableFilters={mockFilters}
          onUpdate={mockOnUpdate}
        />
      )

      await user.click(screen.getByRole('button', { name: 'Remove Work Filter' }))

      // Filter should now appear in available section
      expect(screen.getByRole('button', { name: '+ Work Filter' })).toBeInTheDocument()
      // No filters selected message should appear
      expect(screen.getByText('Select filters from below to add to this collection.')).toBeInTheDocument()
    })

    it('maintains selection order when adding filters', async () => {
      mockOnCreate.mockResolvedValueOnce(undefined)
      const user = userEvent.setup()

      render(
        <CollectionModal
          isOpen={true}
          onClose={mockOnClose}
          availableFilters={mockFilters}
          onCreate={mockOnCreate}
        />
      )

      // Add filters in specific order
      await user.click(screen.getByRole('button', { name: '+ Personal Filter' }))
      await user.click(screen.getByRole('button', { name: '+ Work Filter' }))
      await user.click(screen.getByRole('button', { name: '+ Projects Filter' }))

      await user.type(screen.getByLabelText('Collection Name'), 'Test')
      await user.click(screen.getByRole('button', { name: 'Create Collection' }))

      await waitFor(() => {
        expect(mockOnCreate).toHaveBeenCalledWith('Test', ['filter-2', 'filter-1', 'filter-3'])
      })
    })

    it('shows message when all filters have been added', async () => {
      const user = userEvent.setup()

      render(
        <CollectionModal
          isOpen={true}
          onClose={mockOnClose}
          availableFilters={mockFilters}
          onCreate={mockOnCreate}
        />
      )

      // Add all filters
      await user.click(screen.getByRole('button', { name: '+ Work Filter' }))
      await user.click(screen.getByRole('button', { name: '+ Personal Filter' }))
      await user.click(screen.getByRole('button', { name: '+ Projects Filter' }))

      expect(screen.getByText(/All available filters have been added/)).toBeInTheDocument()
    })
  })

  describe('validation', () => {
    it('shows error when submitting without name', () => {
      render(
        <CollectionModal
          isOpen={true}
          onClose={mockOnClose}
          availableFilters={mockFilters}
          onCreate={mockOnCreate}
        />
      )

      // Try to submit with empty name - button should be disabled
      const submitButton = screen.getByRole('button', { name: 'Create Collection' })
      expect(submitButton).toBeDisabled()
    })

    it('disables submit button when name is empty', () => {
      render(
        <CollectionModal
          isOpen={true}
          onClose={mockOnClose}
          availableFilters={mockFilters}
          onCreate={mockOnCreate}
        />
      )

      expect(screen.getByRole('button', { name: 'Create Collection' })).toBeDisabled()
    })

    it('enables submit button when name is provided', async () => {
      const user = userEvent.setup()

      render(
        <CollectionModal
          isOpen={true}
          onClose={mockOnClose}
          availableFilters={mockFilters}
          onCreate={mockOnCreate}
        />
      )

      await user.type(screen.getByLabelText('Collection Name'), 'Test Collection')

      expect(screen.getByRole('button', { name: 'Create Collection' })).not.toBeDisabled()
    })
  })

  describe('error handling', () => {
    it('displays error when onCreate fails', async () => {
      mockOnCreate.mockRejectedValueOnce(new Error('Network error'))
      const user = userEvent.setup()

      render(
        <CollectionModal
          isOpen={true}
          onClose={mockOnClose}
          availableFilters={mockFilters}
          onCreate={mockOnCreate}
        />
      )

      await user.type(screen.getByLabelText('Collection Name'), 'Test Collection')
      await user.click(screen.getByRole('button', { name: 'Create Collection' }))

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument()
      })
      expect(mockOnClose).not.toHaveBeenCalled()
    })

    it('displays error when onUpdate fails', async () => {
      mockOnUpdate.mockRejectedValueOnce(new Error('Failed to update'))
      const user = userEvent.setup()

      render(
        <CollectionModal
          isOpen={true}
          onClose={mockOnClose}
          collection={mockCollection}
          availableFilters={mockFilters}
          onUpdate={mockOnUpdate}
        />
      )

      await user.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => {
        expect(screen.getByText('Failed to update')).toBeInTheDocument()
      })
      expect(mockOnClose).not.toHaveBeenCalled()
    })
  })

  describe('cancel behavior', () => {
    it('calls onClose when Cancel is clicked', async () => {
      const user = userEvent.setup()

      render(
        <CollectionModal
          isOpen={true}
          onClose={mockOnClose}
          availableFilters={mockFilters}
          onCreate={mockOnCreate}
        />
      )

      await user.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(mockOnClose).toHaveBeenCalled()
      expect(mockOnCreate).not.toHaveBeenCalled()
    })
  })

  describe('submitting state', () => {
    it('shows Saving... text and disables buttons when submitting', async () => {
      // Create a promise that we control
      let resolvePromise: () => void
      const pendingPromise = new Promise<void>((resolve) => {
        resolvePromise = resolve
      })
      mockOnCreate.mockReturnValueOnce(pendingPromise)

      const user = userEvent.setup()

      render(
        <CollectionModal
          isOpen={true}
          onClose={mockOnClose}
          availableFilters={mockFilters}
          onCreate={mockOnCreate}
        />
      )

      await user.type(screen.getByLabelText('Collection Name'), 'Test')

      // Start the submit but don't wait for it
      await user.click(screen.getByRole('button', { name: 'Create Collection' }))

      // Check the submitting state
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled()
      })
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
      expect(screen.getByLabelText('Collection Name')).toBeDisabled()

      // Resolve the promise to clean up
      await act(async () => {
        resolvePromise!()
      })
    })
  })

  describe('state reset', () => {
    it('resets state when modal reopens in create mode', async () => {
      const user = userEvent.setup()

      const { rerender } = render(
        <CollectionModal
          isOpen={true}
          onClose={mockOnClose}
          availableFilters={mockFilters}
          onCreate={mockOnCreate}
        />
      )

      // Type something
      await user.type(screen.getByLabelText('Collection Name'), 'Test')
      await user.click(screen.getByRole('button', { name: '+ Work Filter' }))

      // Close modal
      rerender(
        <CollectionModal
          isOpen={false}
          onClose={mockOnClose}
          availableFilters={mockFilters}
          onCreate={mockOnCreate}
        />
      )

      // Reopen modal
      rerender(
        <CollectionModal
          isOpen={true}
          onClose={mockOnClose}
          availableFilters={mockFilters}
          onCreate={mockOnCreate}
        />
      )

      // Should be reset
      const nameInput = screen.getByLabelText('Collection Name') as HTMLInputElement
      expect(nameInput.value).toBe('')
      expect(screen.getByText('Select filters from below to add to this collection.')).toBeInTheDocument()
    })
  })
})
