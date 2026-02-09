/**
 * Tests for SettingsVersionHistory settings page.
 *
 * Tests filter UI including dropdown filters, date presets, pagination reset, and clear all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SettingsVersionHistory } from './SettingsVersionHistory'

// Mock the history hooks
const mockUseUserHistory = vi.fn()
const mockUseVersionDiff = vi.fn()
vi.mock('../../hooks/useHistory', () => ({
  useUserHistory: (params: unknown) => mockUseUserHistory(params),
  useVersionDiff: () => mockUseVersionDiff(),
}))

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })
}

function renderWithProviders(): void {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter>
        <SettingsVersionHistory />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('SettingsVersionHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default mock - empty history
    mockUseUserHistory.mockReturnValue({
      data: { items: [], total: 0, offset: 0, limit: 50, has_more: false },
      isLoading: false,
      error: null,
    })
    // Default mock - no diff data loaded
    mockUseVersionDiff.mockReturnValue({
      data: null,
    })
  })

  describe('page rendering', () => {
    it('should render page title and description', () => {
      renderWithProviders()

      expect(screen.getByText('Version History')).toBeInTheDocument()
      expect(screen.getByText(/View all changes made to your bookmarks/)).toBeInTheDocument()
    })

    it('should render all filter dropdowns', () => {
      renderWithProviders()

      expect(screen.getByTestId('filter-type')).toBeInTheDocument()
      expect(screen.getByTestId('filter-action')).toBeInTheDocument()
      expect(screen.getByTestId('filter-source')).toBeInTheDocument()
      expect(screen.getByTestId('filter-date')).toBeInTheDocument()
    })
  })

  describe('entity type filter dropdown', () => {
    it('should show all entity type options when dropdown is opened', () => {
      renderWithProviders()

      fireEvent.click(screen.getByTestId('filter-type'))

      expect(screen.getByTestId('filter-type-option-bookmark')).toBeInTheDocument()
      expect(screen.getByTestId('filter-type-option-note')).toBeInTheDocument()
      expect(screen.getByTestId('filter-type-option-prompt')).toBeInTheDocument()
    })

    it('should toggle entity type selection on click', async () => {
      renderWithProviders()

      // Open dropdown and click bookmark option
      fireEvent.click(screen.getByTestId('filter-type'))
      fireEvent.click(screen.getByTestId('filter-type-option-bookmark'))

      // Dropdown label should update to show count
      await waitFor(() => {
        expect(screen.getByTestId('filter-type')).toHaveTextContent('Type (1)')
      })
    })

    it('should allow multiple entity types to be selected', async () => {
      renderWithProviders()

      // Open dropdown and select multiple options
      fireEvent.click(screen.getByTestId('filter-type'))
      fireEvent.click(screen.getByTestId('filter-type-option-bookmark'))
      fireEvent.click(screen.getByTestId('filter-type-option-note'))

      await waitFor(() => {
        expect(screen.getByTestId('filter-type')).toHaveTextContent('Type (2)')
      })
    })

    it('should pass selected entity types to hook', async () => {
      renderWithProviders()

      fireEvent.click(screen.getByTestId('filter-type'))
      fireEvent.click(screen.getByTestId('filter-type-option-bookmark'))

      await waitFor(() => {
        expect(mockUseUserHistory).toHaveBeenCalledWith(
          expect.objectContaining({
            entityTypes: ['bookmark'],
          })
        )
      })
    })
  })

  describe('action filter dropdown', () => {
    it('should show all action type options when dropdown is opened', () => {
      renderWithProviders()

      fireEvent.click(screen.getByTestId('filter-action'))

      expect(screen.getByTestId('filter-action-option-create')).toBeInTheDocument()
      expect(screen.getByTestId('filter-action-option-update')).toBeInTheDocument()
      expect(screen.getByTestId('filter-action-option-delete')).toBeInTheDocument()
      expect(screen.getByTestId('filter-action-option-restore')).toBeInTheDocument()
      expect(screen.getByTestId('filter-action-option-undelete')).toBeInTheDocument()
      expect(screen.getByTestId('filter-action-option-archive')).toBeInTheDocument()
      expect(screen.getByTestId('filter-action-option-unarchive')).toBeInTheDocument()
    })

    it('should toggle action selection on click', async () => {
      renderWithProviders()

      fireEvent.click(screen.getByTestId('filter-action'))
      fireEvent.click(screen.getByTestId('filter-action-option-create'))

      await waitFor(() => {
        expect(screen.getByTestId('filter-action')).toHaveTextContent('Action (1)')
      })
    })

    it('should pass selected actions to hook', async () => {
      renderWithProviders()

      fireEvent.click(screen.getByTestId('filter-action'))
      fireEvent.click(screen.getByTestId('filter-action-option-create'))
      fireEvent.click(screen.getByTestId('filter-action-option-update'))

      await waitFor(() => {
        expect(mockUseUserHistory).toHaveBeenCalledWith(
          expect.objectContaining({
            actions: expect.arrayContaining(['create', 'update']),
          })
        )
      })
    })
  })

  describe('source filter dropdown', () => {
    it('should show all source type options (MCP as single option)', () => {
      renderWithProviders()

      fireEvent.click(screen.getByTestId('filter-source'))

      expect(screen.getByTestId('filter-source-option-web')).toBeInTheDocument()
      expect(screen.getByTestId('filter-source-option-api')).toBeInTheDocument()
      expect(screen.getByTestId('filter-source-option-mcp')).toBeInTheDocument()
      expect(screen.getByTestId('filter-source-option-unknown')).toBeInTheDocument()
    })

    it('should pass selected sources to hook', async () => {
      renderWithProviders()

      fireEvent.click(screen.getByTestId('filter-source'))
      fireEvent.click(screen.getByTestId('filter-source-option-web'))
      fireEvent.click(screen.getByTestId('filter-source-option-api'))

      await waitFor(() => {
        expect(mockUseUserHistory).toHaveBeenCalledWith(
          expect.objectContaining({
            sources: expect.arrayContaining(['web', 'api']),
          })
        )
      })
    })

    it('should expand MCP option to both mcp-content and mcp-prompt', async () => {
      renderWithProviders()

      fireEvent.click(screen.getByTestId('filter-source'))
      fireEvent.click(screen.getByTestId('filter-source-option-mcp'))

      await waitFor(() => {
        expect(mockUseUserHistory).toHaveBeenCalledWith(
          expect.objectContaining({
            sources: expect.arrayContaining(['mcp-content', 'mcp-prompt']),
          })
        )
      })
    })
  })

  describe('date range filter', () => {
    it('should render date preset dropdown with all options', () => {
      renderWithProviders()

      const select = screen.getByTestId('filter-date')
      expect(select).toBeInTheDocument()
      expect(select).toHaveValue('all')

      // Check options
      expect(screen.getByRole('option', { name: 'All time' })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: 'Last 7 days' })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: 'Last 30 days' })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: 'Custom range' })).toBeInTheDocument()
    })

    it('should not show custom inputs when preset is not custom', () => {
      renderWithProviders()

      expect(screen.queryByTestId('filter-date-start')).not.toBeInTheDocument()
      expect(screen.queryByTestId('filter-date-end')).not.toBeInTheDocument()
    })

    it('should show custom date inputs when custom preset is selected', () => {
      renderWithProviders()

      const select = screen.getByTestId('filter-date')
      fireEvent.change(select, { target: { value: 'custom' } })

      expect(screen.getByTestId('filter-date-start')).toBeInTheDocument()
      expect(screen.getByTestId('filter-date-end')).toBeInTheDocument()
      expect(screen.getByText('From')).toBeInTheDocument()
      expect(screen.getByText('To')).toBeInTheDocument()
    })

    it('should pass undefined dates for "all" preset', async () => {
      renderWithProviders()

      await waitFor(() => {
        expect(mockUseUserHistory).toHaveBeenCalledWith(
          expect.objectContaining({
            startDate: undefined,
            endDate: undefined,
          })
        )
      })
    })

    it('should pass ISO dates for last7 preset', async () => {
      renderWithProviders()

      const select = screen.getByTestId('filter-date')
      fireEvent.change(select, { target: { value: 'last7' } })

      await waitFor(() => {
        const lastCall = mockUseUserHistory.mock.calls[mockUseUserHistory.mock.calls.length - 1][0]
        expect(lastCall.startDate).toMatch(/^\d{4}-\d{2}-\d{2}T/)
        expect(lastCall.endDate).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      })
    })
  })

  describe('active filter chips', () => {
    it('should not show active filters section when no filters are applied', () => {
      renderWithProviders()

      expect(screen.queryByTestId('active-filters')).not.toBeInTheDocument()
    })

    it('should show active filter chips when entity type is selected', async () => {
      renderWithProviders()

      fireEvent.click(screen.getByTestId('filter-type'))
      fireEvent.click(screen.getByTestId('filter-type-option-bookmark'))

      await waitFor(() => {
        expect(screen.getByTestId('active-filters')).toBeInTheDocument()
        expect(screen.getByTestId('active-filter-type-bookmark')).toBeInTheDocument()
      })
    })

    it('should show multiple active filter chips', async () => {
      renderWithProviders()

      fireEvent.click(screen.getByTestId('filter-type'))
      fireEvent.click(screen.getByTestId('filter-type-option-bookmark'))
      fireEvent.click(screen.getByTestId('filter-action'))
      fireEvent.click(screen.getByTestId('filter-action-option-create'))

      await waitFor(() => {
        expect(screen.getByTestId('active-filter-type-bookmark')).toBeInTheDocument()
        expect(screen.getByTestId('active-filter-action-create')).toBeInTheDocument()
      })
    })

    it('should show date chip when date filter is applied', async () => {
      renderWithProviders()

      fireEvent.change(screen.getByTestId('filter-date'), { target: { value: 'last7' } })

      await waitFor(() => {
        expect(screen.getByTestId('active-filter-date')).toBeInTheDocument()
        expect(screen.getByTestId('active-filter-date')).toHaveTextContent('Last 7 days')
      })
    })

    it('should remove filter when clicking the X on a chip', async () => {
      renderWithProviders()

      // Add a filter
      fireEvent.click(screen.getByTestId('filter-type'))
      fireEvent.click(screen.getByTestId('filter-type-option-bookmark'))

      await waitFor(() => {
        expect(screen.getByTestId('active-filter-type-bookmark')).toBeInTheDocument()
      })

      // Click the chip to remove it
      fireEvent.click(screen.getByTestId('active-filter-type-bookmark'))

      await waitFor(() => {
        expect(screen.queryByTestId('active-filter-type-bookmark')).not.toBeInTheDocument()
      })
    })

    it('should remove date filter when clicking the date chip', async () => {
      renderWithProviders()

      fireEvent.change(screen.getByTestId('filter-date'), { target: { value: 'last7' } })

      await waitFor(() => {
        expect(screen.getByTestId('active-filter-date')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('active-filter-date'))

      await waitFor(() => {
        expect(screen.queryByTestId('active-filter-date')).not.toBeInTheDocument()
        expect(screen.getByTestId('filter-date')).toHaveValue('all')
      })
    })
  })

  describe('select all toggle', () => {
    it('should show select all in dropdown when no items selected', async () => {
      renderWithProviders()

      fireEvent.click(screen.getByTestId('filter-type'))

      expect(screen.getByTestId('filter-type-toggle-all')).toHaveTextContent('Select all')
    })

    it('should select all entity types when clicking select all', async () => {
      renderWithProviders()

      fireEvent.click(screen.getByTestId('filter-type'))
      fireEvent.click(screen.getByTestId('filter-type-toggle-all'))

      await waitFor(() => {
        expect(mockUseUserHistory).toHaveBeenCalledWith(
          expect.objectContaining({
            entityTypes: expect.arrayContaining(['bookmark', 'note', 'prompt']),
          })
        )
      })
    })

    it('should show deselect all when all items are selected', async () => {
      renderWithProviders()

      // Select all
      fireEvent.click(screen.getByTestId('filter-type'))
      fireEvent.click(screen.getByTestId('filter-type-toggle-all'))

      await waitFor(() => {
        expect(screen.getByTestId('filter-type-toggle-all')).toHaveTextContent('Deselect all')
      })
    })

    it('should deselect all when clicking deselect all', async () => {
      renderWithProviders()

      // Select all first
      fireEvent.click(screen.getByTestId('filter-type'))
      fireEvent.click(screen.getByTestId('filter-type-toggle-all'))

      // Then deselect all
      fireEvent.click(screen.getByTestId('filter-type-toggle-all'))

      await waitFor(() => {
        expect(mockUseUserHistory).toHaveBeenCalledWith(
          expect.objectContaining({
            entityTypes: undefined,
          })
        )
      })
    })
  })

  describe('clear all button', () => {
    it('should not show clear all when no filters are active', () => {
      renderWithProviders()

      expect(screen.queryByTestId('filter-clear-all')).not.toBeInTheDocument()
    })

    it('should show clear all when entity type filter is active', async () => {
      renderWithProviders()

      fireEvent.click(screen.getByTestId('filter-type'))
      fireEvent.click(screen.getByTestId('filter-type-option-bookmark'))

      await waitFor(() => {
        expect(screen.getByTestId('filter-clear-all')).toBeInTheDocument()
      })
    })

    it('should show clear all when date filter is not "all"', async () => {
      renderWithProviders()

      fireEvent.change(screen.getByTestId('filter-date'), { target: { value: 'last7' } })

      await waitFor(() => {
        expect(screen.getByTestId('filter-clear-all')).toBeInTheDocument()
      })
    })

    it('should reset all filters when clicked', async () => {
      renderWithProviders()

      // Set some filters
      fireEvent.click(screen.getByTestId('filter-type'))
      fireEvent.click(screen.getByTestId('filter-type-option-bookmark'))
      fireEvent.click(screen.getByTestId('filter-action'))
      fireEvent.click(screen.getByTestId('filter-action-option-create'))
      fireEvent.change(screen.getByTestId('filter-date'), { target: { value: 'last7' } })

      // Click clear all
      await waitFor(() => {
        expect(screen.getByTestId('filter-clear-all')).toBeInTheDocument()
      })
      fireEvent.click(screen.getByTestId('filter-clear-all'))

      // Verify filters are reset
      await waitFor(() => {
        expect(screen.queryByTestId('filter-clear-all')).not.toBeInTheDocument()
        expect(screen.getByTestId('filter-type')).toHaveTextContent('Type')
        expect(screen.getByTestId('filter-action')).toHaveTextContent('Action')
        expect(screen.getByTestId('filter-source')).toHaveTextContent('Source')
        expect(screen.getByTestId('filter-date')).toHaveValue('all')
      })
    })
  })

  describe('pagination reset', () => {
    const mockHistoryItem = {
      id: '1',
      entity_type: 'bookmark' as const,
      entity_id: 'entity-1',
      action: 'create' as const,
      version: 1,
      metadata_snapshot: { title: 'Test' },
      source: 'web',
      auth_type: 'auth0',
      token_prefix: null,
      created_at: '2024-01-01T00:00:00Z',
    }

    it('should reset to page 0 when entity type filter changes', async () => {
      // Start with data that has pagination
      mockUseUserHistory.mockReturnValue({
        data: {
          items: [mockHistoryItem],
          total: 100,
          offset: 0,
          limit: 50,
          has_more: true,
        },
        isLoading: false,
        error: null,
      })

      renderWithProviders()

      // Navigate to page 1
      fireEvent.click(screen.getByText('Next'))

      // Now change filter - should reset page
      fireEvent.click(screen.getByTestId('filter-type'))
      fireEvent.click(screen.getByTestId('filter-type-option-bookmark'))

      await waitFor(() => {
        // Should reset offset to 0
        expect(mockUseUserHistory).toHaveBeenCalledWith(
          expect.objectContaining({
            offset: 0,
          })
        )
      })
    })

    it('should reset to page 0 when action filter changes', async () => {
      mockUseUserHistory.mockReturnValue({
        data: {
          items: [mockHistoryItem],
          total: 100,
          offset: 0,
          limit: 50,
          has_more: true,
        },
        isLoading: false,
        error: null,
      })

      renderWithProviders()

      // Navigate to page 1
      fireEvent.click(screen.getByText('Next'))

      // Change filter
      fireEvent.click(screen.getByTestId('filter-action'))
      fireEvent.click(screen.getByTestId('filter-action-option-create'))

      await waitFor(() => {
        expect(mockUseUserHistory).toHaveBeenCalledWith(
          expect.objectContaining({
            offset: 0,
          })
        )
      })
    })

    it('should reset to page 0 when date preset changes', async () => {
      mockUseUserHistory.mockReturnValue({
        data: {
          items: [mockHistoryItem],
          total: 100,
          offset: 0,
          limit: 50,
          has_more: true,
        },
        isLoading: false,
        error: null,
      })

      renderWithProviders()

      // Navigate to page 1
      fireEvent.click(screen.getByText('Next'))

      // Change date preset
      fireEvent.change(screen.getByTestId('filter-date'), { target: { value: 'last7' } })

      await waitFor(() => {
        expect(mockUseUserHistory).toHaveBeenCalledWith(
          expect.objectContaining({
            offset: 0,
          })
        )
      })
    })
  })

  describe('empty state', () => {
    it('should show empty state when no history', () => {
      mockUseUserHistory.mockReturnValue({
        data: { items: [], total: 0, offset: 0, limit: 50, has_more: false },
        isLoading: false,
        error: null,
      })

      renderWithProviders()

      expect(screen.getByText(/No history found/)).toBeInTheDocument()
    })

    it('should pass undefined for empty filter arrays (show all behavior)', async () => {
      renderWithProviders()

      // With no selections, hook should receive undefined (not empty arrays)
      await waitFor(() => {
        expect(mockUseUserHistory).toHaveBeenCalledWith(
          expect.objectContaining({
            entityTypes: undefined,
            actions: undefined,
            sources: undefined,
          })
        )
      })
    })
  })

  describe('loading state', () => {
    it('should show loading spinner when loading', () => {
      mockUseUserHistory.mockReturnValue({
        data: undefined,
        isLoading: true,
        error: null,
      })

      const { container } = render(
        <QueryClientProvider client={createQueryClient()}>
          <MemoryRouter>
            <SettingsVersionHistory />
          </MemoryRouter>
        </QueryClientProvider>
      )

      // Check for the spinner element
      expect(container.querySelector('.animate-spin')).toBeInTheDocument()
    })
  })

  describe('error state', () => {
    it('should show error message when error occurs', () => {
      mockUseUserHistory.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: new Error('Failed to fetch'),
      })

      renderWithProviders()

      expect(screen.getByText(/Failed to load history/)).toBeInTheDocument()
    })
  })

  describe('audit event handling', () => {
    const contentEntry = {
      id: '1',
      entity_type: 'bookmark' as const,
      entity_id: 'entity-1',
      action: 'update' as const,
      version: 2,
      metadata_snapshot: { title: 'Test Bookmark' },
      source: 'web',
      auth_type: 'auth0',
      token_prefix: null,
      created_at: '2024-01-02T00:00:00Z',
    }

    const auditEntry = {
      id: '2',
      entity_type: 'bookmark' as const,
      entity_id: 'entity-1',
      action: 'delete' as const,
      version: null,
      metadata_snapshot: { title: 'Test Bookmark' },
      source: 'web',
      auth_type: 'auth0',
      token_prefix: null,
      created_at: '2024-01-03T00:00:00Z',
    }

    const createEntry = {
      id: '3',
      entity_type: 'bookmark' as const,
      entity_id: 'entity-1',
      action: 'create' as const,
      version: 1,
      metadata_snapshot: { title: 'Test Bookmark' },
      source: 'web',
      auth_type: 'auth0',
      token_prefix: null,
      created_at: '2024-01-01T00:00:00Z',
    }

    it('test__audit_entry__shows_audit_label_instead_of_version', () => {
      mockUseUserHistory.mockReturnValue({
        data: {
          items: [auditEntry, contentEntry, createEntry],
          total: 3,
          offset: 0,
          limit: 25,
          has_more: false,
        },
        isLoading: false,
        error: null,
      })

      renderWithProviders()

      // Content entries show version badges
      expect(screen.getAllByText('v2')).toHaveLength(2) // mobile + desktop
      expect(screen.getAllByText('v1')).toHaveLength(2)

      // Audit entry shows "audit" label instead of version badge (mobile + desktop = 2)
      expect(screen.getAllByText('audit')).toHaveLength(2)

      // No numeric version badge for audit entry
      const allVersionBadges = screen.getAllByText(/^v\d+$/)
      expect(allVersionBadges).toHaveLength(4)
    })

    it('test__audit_entry__shows_undelete_label', () => {
      const undeleteEntry = {
        ...auditEntry,
        id: 'undelete-1',
        action: 'undelete' as const,
      }

      mockUseUserHistory.mockReturnValue({
        data: {
          items: [undeleteEntry],
          total: 1,
          offset: 0,
          limit: 25,
          has_more: false,
        },
        isLoading: false,
        error: null,
      })

      renderWithProviders()

      // Should display "Undeleted" (mobile + desktop = 2)
      expect(screen.getAllByText('Undeleted')).toHaveLength(2)
    })

    it('test__undelete_filter_option__is_available', () => {
      renderWithProviders()

      fireEvent.click(screen.getByTestId('filter-action'))

      expect(screen.getByTestId('filter-action-option-undelete')).toBeInTheDocument()
    })
  })
})
