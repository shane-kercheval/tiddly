/**
 * Shared component for rendering version diff content.
 *
 * Displays warnings, metadata changes, and content diff for a version.
 * Used by HistorySidebar and SettingsVersionHistory.
 */
import type { ReactNode } from 'react'
import { DiffView } from './DiffView'
import { MetadataChanges } from './MetadataChanges'
import type { ContentType, HistoryActionType, VersionDiffResponse } from '../types'

interface VersionDiffPanelProps {
  diffData: VersionDiffResponse | null
  entityType: ContentType
  action: HistoryActionType
  maxHeight?: number
}

export function VersionDiffPanel({
  diffData,
  entityType,
  action,
  maxHeight,
}: VersionDiffPanelProps): ReactNode {
  if (!diffData) {
    return <DiffView oldContent="" newContent="" isLoading={true} maxHeight={maxHeight} />
  }

  return (
    <>
      {diffData.warnings && diffData.warnings.length > 0 && (
        <div className="px-3 py-1 text-xs text-yellow-600 border-b border-gray-200">
          Warning: Some changes could not be fully reconstructed
        </div>
      )}
      <MetadataChanges
        beforeMetadata={diffData.before_metadata}
        afterMetadata={diffData.after_metadata}
        entityType={entityType}
        action={action}
      />
      {(diffData.before_content != null || diffData.after_content != null) && (
        <div className="space-y-1">
          <span className="text-sm font-medium text-gray-600 px-3 pt-2 block">Content:</span>
          <DiffView
            oldContent={diffData.before_content ?? ''}
            newContent={diffData.after_content ?? ''}
            isLoading={false}
            maxHeight={maxHeight}
          />
        </div>
      )}
    </>
  )
}
