/**
 * History sidebar component for viewing entity version history.
 *
 * Displays a list of versions with diff visualization
 * and restore functionality with inline confirmation.
 */
import { useState, useMemo } from 'react'
import type { ReactNode } from 'react'
import * as Diff from 'diff'
import { useEntityHistory, useContentAtVersion, useRevertToVersion } from '../hooks/useHistory'
import { CloseIcon, RestoreIcon } from './icons'
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

/** Format auth type for display */
function formatAuthType(authType: string): string {
  const labels: Record<string, string> = {
    auth0: 'Auth0',
    pat: 'Token',
    dev: 'Dev',
  }
  return labels[authType] ?? authType
}

/** Simple diff view component using the diff library */
function DiffView({
  oldContent,
  newContent,
  isLoading,
}: {
  oldContent: string
  newContent: string
  isLoading: boolean
}): ReactNode {
  const diffParts = useMemo(() => {
    if (isLoading) return []
    return Diff.diffLines(oldContent, newContent)
  }, [oldContent, newContent, isLoading])

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-900" />
      </div>
    )
  }

  if (oldContent === newContent) {
    return (
      <div className="flex-1 p-4 text-sm text-gray-500">
        No content changes in this version (metadata only).
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto font-mono text-xs">
      {diffParts.map((part, index) => {
        const lines = part.value.split('\n')
        // Remove last empty line if present (from split)
        if (lines[lines.length - 1] === '') {
          lines.pop()
        }

        return lines.map((line, lineIndex) => (
          <div
            key={`${index}-${lineIndex}`}
            className={`px-3 py-0.5 border-l-4 ${
              part.added
                ? 'bg-green-50 border-green-500 text-green-800'
                : part.removed
                  ? 'bg-red-50 border-red-500 text-red-800'
                  : 'bg-white border-transparent text-gray-600'
            }`}
          >
            <span className="select-none text-gray-400 mr-2 inline-block w-4">
              {part.added ? '+' : part.removed ? '-' : ' '}
            </span>
            {line || ' '}
          </div>
        ))
      })}
    </div>
  )
}

export function HistorySidebar({
  entityType,
  entityId,
  onClose,
  onReverted,
}: HistorySidebarProps): ReactNode {
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null)
  const [confirmingRevert, setConfirmingRevert] = useState<number | null>(null)

  const { data: history, isLoading } = useEntityHistory(entityType, entityId, { limit: 50 })

  // Fetch content at the selected version (the "after" state)
  const { data: versionContent, isLoading: isLoadingVersion } = useContentAtVersion(
    entityType,
    entityId,
    selectedVersion
  )

  // Fetch content at the previous version (the "before" state) for diff comparison
  const previousVersion = selectedVersion !== null && selectedVersion > 1 ? selectedVersion - 1 : null
  const { data: previousVersionContent, isLoading: isLoadingPreviousVersion } = useContentAtVersion(
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

  // Reset confirmation when clicking elsewhere
  const handleVersionClick = (version: number): void => {
    setSelectedVersion(version)
    if (confirmingRevert !== null) {
      setConfirmingRevert(null)
    }
  }

  return (
    <div className="fixed right-0 top-0 h-full w-96 bg-white shadow-lg border-l border-gray-200 flex flex-col z-50">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 shrink-0">
        <h2 className="text-lg font-semibold text-gray-900">Version History</h2>
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-gray-700 p-1 rounded-md hover:bg-gray-100"
          aria-label="Close history sidebar"
        >
          <CloseIcon className="w-5 h-5" />
        </button>
      </div>

      {/* Version list */}
      <div className={`overflow-y-auto ${selectedVersion ? 'h-1/2' : 'flex-1'}`}>
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
              <li
                key={entry.id}
                className={`p-4 cursor-pointer hover:bg-gray-50 transition-colors ${
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
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      {new Date(entry.created_at).toLocaleString()}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {formatSource(entry.source)} · {formatAuthType(entry.auth_type)}
                      {entry.token_prefix && ` · ${entry.token_prefix}...`}
                    </div>
                  </div>
                  {/* Show "Restore" button on older versions (not the latest) */}
                  {entry.version < latestVersion && (
                    <button
                      onClick={(e) => handleRevertClick(entry.version, e)}
                      disabled={revertMutation.isPending}
                      className={`shrink-0 flex items-center gap-1 px-3 py-1.5 text-sm rounded-md transition-colors ${
                        confirmingRevert === entry.version
                          ? 'bg-red-600 text-white hover:bg-red-700'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      } ${revertMutation.isPending ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      <RestoreIcon className="w-3.5 h-3.5" />
                      {confirmingRevert === entry.version ? 'Confirm' : 'Restore'}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Diff view */}
      {selectedVersion && (
        <div className="border-t border-gray-200 h-1/2 flex flex-col">
          <div className="bg-gray-50 border-b border-gray-200 shrink-0">
            <div className="flex items-center justify-between p-3">
              <span className="text-sm font-medium text-gray-700">
                Changes in v{selectedVersion}
                {previousVersion && (
                  <span className="text-gray-400 font-normal"> (from v{previousVersion})</span>
                )}
              </span>
              <button
                onClick={() => setSelectedVersion(null)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-md hover:bg-gray-200"
                aria-label="Close diff view"
              >
                <CloseIcon className="w-4 h-4" />
              </button>
            </div>
            {versionContent?.warnings && versionContent.warnings.length > 0 && (
              <div className="px-3 pb-2 text-xs text-yellow-600">
                Warning: Some changes could not be fully reconstructed
              </div>
            )}
          </div>
          <DiffView
            oldContent={previousVersionContent?.content ?? ''}
            newContent={versionContent?.content ?? ''}
            isLoading={isLoadingVersion || isLoadingPreviousVersion}
          />
        </div>
      )}
    </div>
  )
}
