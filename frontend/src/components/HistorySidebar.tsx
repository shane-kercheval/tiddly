/**
 * History sidebar component for viewing entity version history.
 *
 * Displays a list of versions with diff visualization
 * and restore functionality with inline confirmation.
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import type { ReactNode } from 'react'
import { useEntityHistory, useVersionDiff, useRestoreToVersion } from '../hooks/useHistory'
import { useHistorySidebarStore, MIN_SIDEBAR_WIDTH, MIN_CONTENT_WIDTH } from '../stores/historySidebarStore'
import { CloseIcon, RestoreIcon, HelpIcon, ChevronLeftIcon, ChevronRightIcon } from './icons'
import type { ContentType, HistoryActionType } from '../types'
import { Tooltip } from './ui/Tooltip'
import { ActionDot } from './ActionDot'
import { ChangeIndicators } from './ChangeIndicators'
import { VersionDiffPanel } from './VersionDiffPanel'
import { formatAction, formatSource, isAuditAction } from '../constants/historyLabels'

interface HistorySidebarProps {
  entityType: ContentType
  entityId: string
  onClose: () => void
  onRestored?: () => void
  /** When true, hides all restore buttons (e.g. entity is soft-deleted) */
  isDeleted?: boolean
}

/** Tooltip text explaining why audit actions don't support restore */
const AUDIT_TOOLTIPS: Partial<Record<HistoryActionType, string>> = {
  archive: 'Archived items can be restored from the Archives section.',
  unarchive: 'To archive this item, use the archive action from the item menu.',
  delete: 'Deleted items can be restored from the Trash section.',
  undelete: 'To delete this item, use the delete action from the item menu.',
}

const PAGE_SIZE = 50

/** Tailwind md breakpoint */
const MD_BREAKPOINT = 768

/** Calculate the maximum allowed sidebar width based on current viewport */
function calculateMaxWidth(): number {
  const leftSidebar = document.getElementById('desktop-sidebar')
  const leftSidebarWidth = leftSidebar?.getBoundingClientRect().width ?? 0
  // Clamp to MIN_SIDEBAR_WIDTH to prevent negative values on narrow viewports
  return Math.max(MIN_SIDEBAR_WIDTH, window.innerWidth - leftSidebarWidth - MIN_CONTENT_WIDTH)
}

export function HistorySidebar({
  entityType,
  entityId,
  onClose,
  onRestored,
  isDeleted = false,
}: HistorySidebarProps): ReactNode {
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null)
  const [confirmingRestore, setConfirmingRestore] = useState<number | null>(null)
  const confirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [page, setPageRaw] = useState(0)
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= MD_BREAKPOINT : true
  )

  // Wrap setPage to also clear selection state
  const setPage = useCallback((newPage: number) => {
    setPageRaw(newPage)
    setSelectedVersion(null)
    setConfirmingRestore(null)
  }, [])

  // Get width from store
  const storeWidth = useHistorySidebarStore((state) => state.width)
  const setWidth = useHistorySidebarStore((state) => state.setWidth)

  // Constrain width to current viewport on mount and window resize
  useEffect(() => {
    const constrainWidth = (): void => {
      const maxWidth = calculateMaxWidth()
      if (storeWidth > maxWidth) {
        setWidth(maxWidth)
      }
      setIsDesktop(window.innerWidth >= MD_BREAKPOINT)
    }

    // Check on mount
    constrainWidth()

    // Check on window resize
    window.addEventListener('resize', constrainWidth)
    return () => window.removeEventListener('resize', constrainWidth)
  }, [storeWidth, setWidth])

  // Calculate effective width (clamped to current max)
  const width = isDesktop ? Math.min(storeWidth, calculateMaxWidth()) : storeWidth

  // Handle drag resize
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      // Width is calculated from the right edge of the window
      const newWidth = window.innerWidth - e.clientX
      const maxWidth = calculateMaxWidth()

      // Clamp to dynamic max (store handles min clamping)
      setWidth(Math.min(newWidth, maxWidth))
    }

    const handleMouseUp = () => {
      setIsDragging(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    // Prevent text selection while dragging
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'ew-resize'

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
  }, [isDragging, setWidth])

  // Auto-reset confirmation after 3 seconds
  useEffect(() => {
    if (confirmingRestore !== null) {
      confirmTimeoutRef.current = setTimeout(() => {
        setConfirmingRestore(null)
      }, 3000)
    }
    return () => {
      if (confirmTimeoutRef.current) {
        clearTimeout(confirmTimeoutRef.current)
        confirmTimeoutRef.current = null
      }
    }
  }, [confirmingRestore])

  const { data: history, isLoading } = useEntityHistory(entityType, entityId, { limit: PAGE_SIZE, offset: page * PAGE_SIZE })

  // Fetch diff between selected version and its predecessor
  const { data: diffData } = useVersionDiff(
    entityType,
    entityId,
    selectedVersion
  )

  const restoreMutation = useRestoreToVersion()

  // Only page 0 contains the true latest version; on later pages all entries are older
  const latestVersion = page === 0
    ? history?.items.find(e => e.version !== null)?.version ?? 0
    : Infinity

  const handleRestoreClick = (version: number, e: React.MouseEvent): void => {
    e.stopPropagation()
    if (confirmingRestore === version) {
      // Second click - execute restore
      restoreMutation.mutate(
        { contentType: entityType, contentId: entityId, version },
        {
          onSuccess: () => {
            setConfirmingRestore(null)
            onRestored?.()
          },
        }
      )
    } else {
      // First click - show confirm
      setConfirmingRestore(version)
    }
  }

  // Toggle entry selection - clicking same entry closes diff view
  // Audit entries (null version) close any open selection but don't open a new one
  const handleVersionClick = (version: number | null): void => {
    if (version === null) {
      setSelectedVersion(null)
      setConfirmingRestore(null)
      return
    }
    setSelectedVersion(selectedVersion === version ? null : version)
    if (confirmingRestore !== null) {
      setConfirmingRestore(null)
    }
  }

  return (
    <div
      className="fixed right-0 top-0 h-full bg-white shadow-lg border-l border-gray-200 flex flex-col z-50 w-full md:w-auto"
      style={isDesktop ? { width: `${width}px` } : undefined}
    >
      {/* Drag handle - hidden on mobile */}
      {isDesktop && (
        <div
          className="absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-blue-400 active:bg-blue-500 transition-colors z-10"
          onMouseDown={handleMouseDown}
        />
      )}
      {/* Header - matches item header height for alignment */}
      <div className="flex items-center justify-between py-1.5 px-4 border-b border-gray-200 shrink-0">
        <div className="flex items-center gap-1.5">
          <h2 className="text-base font-semibold text-gray-900">Version History</h2>
          <Tooltip
            content="Restoring a version replaces your current content with how it looked after that version was saved — it does not undo that version's changes. A new version is created, so no history is lost."
            position="bottom"
          >
            <HelpIcon className="h-4 w-4 text-gray-400 hover:text-gray-600 cursor-help" />
          </Tooltip>
        </div>
        <button
          onClick={onClose}
          className="h-[28px] w-[28px] flex items-center justify-center text-gray-500 hover:text-gray-700 rounded-md hover:bg-gray-100"
          aria-label="Close history sidebar"
        >
          <CloseIcon className="w-5 h-5" />
        </button>
      </div>

      {/* Pagination - only shown when there's more than one page */}
      {history && history.total > PAGE_SIZE && (
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 shrink-0">
          <span className="text-sm text-gray-500">
            Showing {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, history.total)} of {history.total}
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="btn-ghost"
              aria-label="Previous page"
            >
              <ChevronLeftIcon className="h-4 w-4" />
            </button>
            <button
              onClick={() => setPage(page + 1)}
              disabled={!history.has_more}
              className="btn-ghost"
              aria-label="Next page"
            >
              <ChevronRightIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Version list with inline diff view */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center p-8">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-900" />
          </div>
        ) : history?.items.length === 0 ? (
          <div className="p-4 text-sm text-gray-500 text-center">
            No history available
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {history?.items.map((entry) => (
              <li key={entry.id}>
                <div
                  className={`px-4 py-1.5 transition-colors ${
                    isAuditAction(entry.action)
                      ? 'bg-gray-50/50'
                      : 'cursor-pointer hover:bg-gray-100'
                  } ${
                    selectedVersion === entry.version && entry.version !== null ? 'bg-blue-50' : ''
                  }`}
                  onClick={() => handleVersionClick(entry.version)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <ActionDot action={entry.action} />
                        {entry.version !== null ? (
                          <span className="text-sm font-medium text-gray-900">
                            {entry.version === latestVersion ? 'Current' : `v${entry.version}`}
                          </span>
                        ) : (
                          <span className="text-sm text-gray-500">{formatAction(entry.action)}</span>
                        )}
                        <span className="text-xs text-gray-400">
                          {formatSource(entry.source)}
                        </span>
                        <ChangeIndicators changed={entry.changed_fields} />
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {new Date(entry.created_at).toLocaleString()}
                      </div>
                    </div>
                    {/* Show "Restore" button on older content versions (not audit actions, not deleted entities) */}
                    {!isDeleted && entry.version !== null && entry.version < latestVersion && !isAuditAction(entry.action) && (
                      <button
                        onClick={(e) => handleRestoreClick(entry.version!, e)}
                        disabled={restoreMutation.isPending}
                        className={`shrink-0 flex items-center gap-1.5 ${
                          confirmingRestore === entry.version
                            ? 'btn-ghost text-red-600 hover:text-red-700 bg-red-50'
                            : 'btn-ghost hover:bg-gray-200 hover:text-red-600'
                        }`}
                      >
                        <RestoreIcon className="w-3.5 h-3.5" />
                        {confirmingRestore === entry.version ? 'Confirm' : 'Restore'}
                      </button>
                    )}
                    {/* Info tooltip on audit entries explaining how to undo the action */}
                    {isAuditAction(entry.action) && AUDIT_TOOLTIPS[entry.action] && (
                      <Tooltip
                        content={AUDIT_TOOLTIPS[entry.action]}
                        position="left"
                        compact
                      >
                        <HelpIcon className="h-4 w-4 text-gray-300 hover:text-gray-500 cursor-help shrink-0" />
                      </Tooltip>
                    )}
                  </div>
                </div>
                {/* Inline diff/info view - shown below selected version */}
                {selectedVersion === entry.version && entry.version !== null && (
                  <div className="border-t border-gray-200 bg-gray-50">
                    <VersionDiffPanel
                      diffData={diffData ?? null}
                      entityType={entityType}
                      action={entry.action}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
