/**
 * Tests for HistorySidebar component.
 *
 * Focuses on audit event handling:
 * - formatAction labels for all action types
 * - Audit actions (null version) don't show version badge
 * - Audit actions don't show restore button
 * - Content actions show version badge and diff view
 * - RESTORE actions show diff and restore button
 * - latestVersion computed from first non-null version
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HistorySidebar } from './HistorySidebar'
import type { HistoryEntry } from '../types'

// Mock the history hooks
const mockUseEntityHistory = vi.fn()
const mockUseContentAtVersion = vi.fn()
const mockUseRestoreToVersion = vi.fn()
vi.mock('../hooks/useHistory', () => ({
  useEntityHistory: (...args: unknown[]) => mockUseEntityHistory(...args),
  useContentAtVersion: (...args: unknown[]) => mockUseContentAtVersion(...args),
  useRestoreToVersion: () => mockUseRestoreToVersion(),
}))

// Mock the sidebar store
vi.mock('../stores/historySidebarStore', () => ({
  useHistorySidebarStore: (selector: (state: { width: number }) => unknown) =>
    selector({ width: 500 }),
  MIN_SIDEBAR_WIDTH: 300,
  MIN_CONTENT_WIDTH: 400,
}))

function createEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: 'entry-1',
    entity_type: 'bookmark',
    entity_id: 'entity-1',
    action: 'update',
    version: 2,
    diff_type: 'diff',
    metadata_snapshot: { title: 'Test' },
    source: 'web',
    auth_type: 'auth0',
    token_prefix: null,
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
}

function renderSidebar(): void {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <HistorySidebar
        entityType="bookmark"
        entityId="entity-1"
        onClose={vi.fn()}
        onRestored={vi.fn()}
      />
    </QueryClientProvider>
  )
}

describe('HistorySidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseContentAtVersion.mockReturnValue({ data: null })
    mockUseRestoreToVersion.mockReturnValue({ mutate: vi.fn(), isPending: false })
  })

  describe('formatAction labels', () => {
    it('test__format_action__displays_correct_labels_for_all_action_types', () => {
      const entries = [
        createEntry({ id: '1', action: 'create', version: 1 }),
        createEntry({ id: '2', action: 'update', version: 2 }),
        createEntry({ id: '3', action: 'restore', version: 3 }),
        createEntry({ id: '4', action: 'delete', version: null, diff_type: 'audit' }),
        createEntry({ id: '5', action: 'undelete', version: null, diff_type: 'audit' }),
        createEntry({ id: '6', action: 'archive', version: null, diff_type: 'audit' }),
        createEntry({ id: '7', action: 'unarchive', version: null, diff_type: 'audit' }),
      ]

      mockUseEntityHistory.mockReturnValue({
        data: { items: entries, total: entries.length, offset: 0, limit: 50, has_more: false },
        isLoading: false,
      })

      renderSidebar()

      expect(screen.getByText('Created')).toBeInTheDocument()
      expect(screen.getByText('Updated')).toBeInTheDocument()
      expect(screen.getByText('Restored')).toBeInTheDocument()
      expect(screen.getByText('Deleted')).toBeInTheDocument()
      expect(screen.getByText('Undeleted')).toBeInTheDocument()
      expect(screen.getByText('Archived')).toBeInTheDocument()
      expect(screen.getByText('Unarchived')).toBeInTheDocument()
    })
  })

  describe('audit action display', () => {
    it('test__audit_actions__do_not_show_version_badge', () => {
      const entries = [
        createEntry({ id: '1', action: 'update', version: 2 }),
        createEntry({ id: '2', action: 'delete', version: null, diff_type: 'audit' }),
        createEntry({ id: '3', action: 'undelete', version: null, diff_type: 'audit' }),
        createEntry({ id: '4', action: 'archive', version: null, diff_type: 'audit' }),
        createEntry({ id: '5', action: 'unarchive', version: null, diff_type: 'audit' }),
        createEntry({ id: '6', action: 'create', version: 1 }),
      ]

      mockUseEntityHistory.mockReturnValue({
        data: { items: entries, total: entries.length, offset: 0, limit: 50, has_more: false },
        isLoading: false,
      })

      renderSidebar()

      // Content actions show version badges
      expect(screen.getByText('v2')).toBeInTheDocument()
      expect(screen.getByText('v1')).toBeInTheDocument()

      // Audit actions should NOT show version badges (no v for null versions)
      // Total version badges should be exactly 2 (v1 and v2)
      const versionBadges = screen.getAllByText(/^v\d+$/)
      expect(versionBadges).toHaveLength(2)
    })

    it('test__audit_actions__do_not_show_restore_button', () => {
      const entries = [
        createEntry({ id: '1', action: 'update', version: 3 }),
        createEntry({ id: '2', action: 'delete', version: null, diff_type: 'audit' }),
        createEntry({ id: '3', action: 'update', version: 2 }),
        createEntry({ id: '4', action: 'create', version: 1 }),
      ]

      mockUseEntityHistory.mockReturnValue({
        data: { items: entries, total: entries.length, offset: 0, limit: 50, has_more: false },
        isLoading: false,
      })

      renderSidebar()

      // Restore buttons should only appear for non-latest content versions (v2 and v1)
      const restoreButtons = screen.getAllByText('Restore')
      expect(restoreButtons).toHaveLength(2)
    })

    it('test__content_actions__show_version_badge', () => {
      const entries = [
        createEntry({ id: '1', action: 'restore', version: 3 }),
        createEntry({ id: '2', action: 'update', version: 2 }),
        createEntry({ id: '3', action: 'create', version: 1 }),
      ]

      mockUseEntityHistory.mockReturnValue({
        data: { items: entries, total: entries.length, offset: 0, limit: 50, has_more: false },
        isLoading: false,
      })

      renderSidebar()

      expect(screen.getByText('v3')).toBeInTheDocument()
      expect(screen.getByText('v2')).toBeInTheDocument()
      expect(screen.getByText('v1')).toBeInTheDocument()
    })

    it('test__restore_action__shows_restore_button_like_update', () => {
      const entries = [
        createEntry({ id: '1', action: 'update', version: 4 }),
        createEntry({ id: '2', action: 'restore', version: 3 }),
        createEntry({ id: '3', action: 'update', version: 2 }),
        createEntry({ id: '4', action: 'create', version: 1 }),
      ]

      mockUseEntityHistory.mockReturnValue({
        data: { items: entries, total: entries.length, offset: 0, limit: 50, has_more: false },
        isLoading: false,
      })

      renderSidebar()

      // v3 (restore), v2 (update), v1 (create) should all have restore buttons
      const restoreButtons = screen.getAllByText('Restore')
      expect(restoreButtons).toHaveLength(3)
    })
  })

  describe('latestVersion computation', () => {
    it('test__latest_version__ignores_audit_entries_with_null_version', () => {
      // Audit entries at the top (most recent) should be skipped
      const entries = [
        createEntry({ id: '1', action: 'archive', version: null, diff_type: 'audit' }),
        createEntry({ id: '2', action: 'delete', version: null, diff_type: 'audit' }),
        createEntry({ id: '3', action: 'update', version: 3 }),
        createEntry({ id: '4', action: 'update', version: 2 }),
        createEntry({ id: '5', action: 'create', version: 1 }),
      ]

      mockUseEntityHistory.mockReturnValue({
        data: { items: entries, total: entries.length, offset: 0, limit: 50, has_more: false },
        isLoading: false,
      })

      renderSidebar()

      // latestVersion should be 3 (first non-null), so v2 and v1 get restore buttons
      const restoreButtons = screen.getAllByText('Restore')
      expect(restoreButtons).toHaveLength(2) // v2 and v1
    })

    it('test__latest_version__first_content_entry_has_no_restore_button', () => {
      const entries = [
        createEntry({ id: '1', action: 'undelete', version: null, diff_type: 'audit' }),
        createEntry({ id: '2', action: 'update', version: 3 }),
        createEntry({ id: '3', action: 'create', version: 1 }),
      ]

      mockUseEntityHistory.mockReturnValue({
        data: { items: entries, total: entries.length, offset: 0, limit: 50, has_more: false },
        isLoading: false,
      })

      renderSidebar()

      // v3 is the latest content version - no restore button
      // v1 gets a restore button
      const restoreButtons = screen.getAllByText('Restore')
      expect(restoreButtons).toHaveLength(1)
    })
  })

  describe('diff view interaction', () => {
    it('test__clicking_content_entry__opens_diff_view', () => {
      mockUseContentAtVersion.mockReturnValue({
        data: { content: 'test content', warnings: null },
      })

      const entries = [
        createEntry({ id: '1', action: 'update', version: 2 }),
        createEntry({ id: '2', action: 'create', version: 1 }),
      ]

      mockUseEntityHistory.mockReturnValue({
        data: { items: entries, total: entries.length, offset: 0, limit: 50, has_more: false },
        isLoading: false,
      })

      renderSidebar()

      // Click on v2 entry
      fireEvent.click(screen.getByText('v2'))

      // The entry should be highlighted (bg-blue-50 class)
      const v2Element = screen.getByText('v2').closest('[class*="bg-blue-50"]')
      expect(v2Element).toBeInTheDocument()
    })

    it('test__clicking_audit_entry__closes_open_diff_view', () => {
      mockUseContentAtVersion.mockReturnValue({
        data: { content: 'test content', warnings: null },
      })

      const entries = [
        createEntry({ id: '1', action: 'update', version: 3 }),
        createEntry({ id: '2', action: 'delete', version: null, diff_type: 'audit' }),
        createEntry({ id: '3', action: 'create', version: 1 }),
      ]

      mockUseEntityHistory.mockReturnValue({
        data: { items: entries, total: entries.length, offset: 0, limit: 50, has_more: false },
        isLoading: false,
      })

      renderSidebar()

      // Click on v3 to open diff
      fireEvent.click(screen.getByText('v3'))
      expect(screen.getByText('v3').closest('[class*="bg-blue-50"]')).toBeInTheDocument()

      // Click on the audit entry (Deleted) - should close v3's diff
      fireEvent.click(screen.getByText('Deleted'))
      expect(screen.getByText('v3').closest('[class*="bg-blue-50"]')).toBeNull()
    })
  })
})
