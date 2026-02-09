/**
 * Shared labels and formatting for history records.
 *
 * Used by HistorySidebar and SettingsVersionHistory to ensure consistent
 * display of action types and source values.
 */
import type { HistoryActionType } from '../types'

/** Display labels for action types (past tense) */
const ACTION_LABELS: Record<HistoryActionType, string> = {
  create: 'Created',
  update: 'Updated',
  delete: 'Deleted',
  restore: 'Restored',
  undelete: 'Undeleted',
  archive: 'Archived',
  unarchive: 'Unarchived',
}

/** Display labels for known source values */
const SOURCE_LABELS: Record<string, string> = {
  web: 'Web',
  api: 'API',
  'mcp-content': 'MCP',
  'mcp-prompt': 'MCP',
  iphone: 'iPhone',
  unknown: 'Unknown',
}

/** Audit actions are lifecycle state transitions, not content changes */
const AUDIT_ACTIONS: Set<string> = new Set(['delete', 'undelete', 'archive', 'unarchive'])

/** Format an action type for display */
export function formatAction(action: HistoryActionType): string {
  return ACTION_LABELS[action] ?? action
}

/** Format a source value for display. Unknown sources pass through as-is. */
export function formatSource(source: string): string {
  return SOURCE_LABELS[source] ?? source
}

/** Check if an action is an audit-only action (lifecycle state transition, no content change) */
export function isAuditAction(action: HistoryActionType): boolean {
  return AUDIT_ACTIONS.has(action)
}
