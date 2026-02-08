/**
 * History sidebar component for viewing entity version history.
 *
 * Displays a list of versions with diff visualization
 * and restore functionality with inline confirmation.
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import type { ReactNode } from 'react'
import { useEntityHistory, useContentAtVersion, useRevertToVersion } from '../hooks/useHistory'
import { useHistorySidebarStore, MIN_SIDEBAR_WIDTH, MIN_CONTENT_WIDTH } from '../stores/historySidebarStore'
import { CloseIcon, RestoreIcon } from './icons'
import { WrapIcon } from './editor/EditorToolbarIcons'
import { Tooltip } from './ui/Tooltip'
import { DiffView } from './DiffView'
import type { HistoryEntityType, HistoryActionType } from '../types'

interface HistorySidebarProps {
  entityType: HistoryEntityType
  entityId: string
  onClose: () => void
  onReverted?: () => void
}

/** Format action type for display */
function formatAction(action: HistoryActionType): string {
  const labels: Record<HistoryActionType, string> = {
    create: 'Created',
    update: 'Updated',
    delete: 'Deleted',
    restore: 'Restored',
    archive: 'Archived',
    unarchive: 'Unarchived',
  }
  return labels[action] ?? action
}

/** Format source for display */
function formatSource(source: string): string {
  const labels: Record<string, string> = {
    web: 'Web',
    api: 'API',
    'mcp-content': 'MCP',
    'mcp-prompt': 'MCP',
    unknown: 'Unknown',
  }
  return labels[source] ?? source
}

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
  onReverted,
}: HistorySidebarProps): ReactNode {
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null)
  const [confirmingRevert, setConfirmingRevert] = useState<number | null>(null)
  const confirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= MD_BREAKPOINT : true
  )
  const [wrapText, setWrapText] = useState(true)

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
    if (confirmingRevert !== null) {
      confirmTimeoutRef.current = setTimeout(() => {
        setConfirmingRevert(null)
      }, 3000)
    }
    return () => {
      if (confirmTimeoutRef.current) {
        clearTimeout(confirmTimeoutRef.current)
        confirmTimeoutRef.current = null
      }
    }
  }, [confirmingRevert])

  const { data: history, isLoading } = useEntityHistory(entityType, entityId, { limit: 50 })

  // Fetch content at the selected version (the "after" state)
  const { data: versionContent } = useContentAtVersion(
    entityType,
    entityId,
    selectedVersion
  )

  // Fetch content at the previous version (the "before" state) for diff comparison
  const previousVersion = selectedVersion !== null && selectedVersion > 1 ? selectedVersion - 1 : null
  const { data: previousVersionContent } = useContentAtVersion(
    entityType,
    entityId,
    previousVersion
  )

  const revertMutation = useRevertToVersion()

  const latestVersion = history?.items[0]?.version ?? 0

  const handleRevertClick = (version: number, e: React.MouseEvent): void => {
    e.stopPropagation()
    if (confirmingRevert === version) {
      // Second click - execute revert
      revertMutation.mutate(
        { entityType, entityId, version },
        {
          onSuccess: () => {
            setConfirmingRevert(null)
            onReverted?.()
          },
        }
      )
    } else {
      // First click - show confirm
      setConfirmingRevert(version)
    }
  }

  // Toggle version selection - clicking same version closes diff view
  const handleVersionClick = (version: number): void => {
    setSelectedVersion(selectedVersion === version ? null : version)
    if (confirmingRevert !== null) {
      setConfirmingRevert(null)
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
          title="Drag to resize"
        />
      )}
      {/* Header - matches item header height (pt-3 pb-3) for alignment */}
      <div className="flex items-center justify-between py-3 px-4 border-b border-gray-200 shrink-0">
        <h2 className="text-lg font-semibold text-gray-900">Version History</h2>
        <button
          onClick={onClose}
          className="h-[30px] w-[30px] flex items-center justify-center text-gray-500 hover:text-gray-700 rounded-md hover:bg-gray-100"
          aria-label="Close history sidebar"
        >
          <CloseIcon className="w-5 h-5" />
        </button>
      </div>

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
                  className={`px-4 py-2.5 cursor-pointer hover:bg-gray-100 transition-colors ${
                    selectedVersion === entry.version ? 'bg-blue-50' : ''
                  }`}
                  onClick={() => handleVersionClick(entry.version)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900">v{entry.version}</span>
                        <span className="text-sm text-gray-500">
                          {formatAction(entry.action)}
                        </span>
                        <span className="text-xs text-gray-400">
                          {formatSource(entry.source)}
                        </span>
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {new Date(entry.created_at).toLocaleString()}
                      </div>
                    </div>
                    {/* Show "Restore" button on older versions (not the latest) */}
                    {entry.version < latestVersion && (
                      <button
                        onClick={(e) => handleRevertClick(entry.version, e)}
                        disabled={revertMutation.isPending}
                        className={`shrink-0 flex items-center gap-1.5 ${
                          confirmingRevert === entry.version
                            ? 'btn-secondary text-red-600 hover:text-red-700 hover:border-red-300 bg-red-50'
                            : 'btn-secondary hover:text-red-600'
                        }`}
                      >
                        <RestoreIcon className="w-3.5 h-3.5" />
                        {confirmingRevert === entry.version ? 'Confirm' : 'Restore'}
                      </button>
                    )}
                  </div>
                </div>
                {/* Inline diff view - shown below selected version */}
                {selectedVersion === entry.version && (
                  <div className="border-t border-gray-200 bg-gray-50">
                    {versionContent?.warnings && versionContent.warnings.length > 0 && (
                      <div className="px-3 py-1 text-xs text-yellow-600 border-b border-gray-200">
                        Warning: Some changes could not be fully reconstructed
                      </div>
                    )}
                    <div className="max-h-[500px] overflow-auto relative">
                      {/* Wrap toggle button - sticky so it stays visible during scroll */}
                      <div className="sticky top-1 right-1 float-right z-10 mr-1 mt-1">
                        <Tooltip content={wrapText ? 'Disable wrap' : 'Enable wrap'} compact delay={0} position="left">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setWrapText(!wrapText)
                            }}
                            className={`p-0.5 rounded transition-colors border ${
                              wrapText
                                ? 'text-gray-700 bg-gray-200 hover:bg-gray-300 border-transparent'
                                : 'text-gray-500 bg-white hover:text-gray-700 hover:bg-gray-100 shadow-sm border-gray-200'
                            }`}
                            aria-label={wrapText ? 'Disable text wrap' : 'Enable text wrap'}
                          >
                            <WrapIcon />
                          </button>
                        </Tooltip>
                      </div>
                      <DiffView
                        oldContent={previousVersionContent?.content ?? ''}
                        newContent={versionContent?.content ?? ''}
                        isLoading={
                          // Show spinner while waiting for required data
                          // Check data existence directly rather than relying on React Query flags
                          !versionContent || (previousVersion !== null && !previousVersionContent)
                        }
                        wrapText={wrapText}
                      />
                    </div>
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
