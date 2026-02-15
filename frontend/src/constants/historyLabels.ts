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

/** Dot styles for each action type. Solid fill or ring (hollow circle for "undo" actions). */
export const ACTION_DOT_STYLES: Record<HistoryActionType, string> = {
  create: 'bg-emerald-400',
  update: 'bg-blue-400',
  delete: 'bg-red-400',
  restore: 'bg-violet-400',
  undelete: 'border-2 border-red-400 bg-white',
  archive: 'bg-amber-500',
  unarchive: 'border-2 border-amber-500 bg-white',
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
