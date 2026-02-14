/**
 * Colored dot indicator for history action types.
 *
 * Each action type has a distinct color so users can scan
 * history at a glance. Tooltip shows the action label on hover.
 */
import type { ReactNode } from 'react'
import { Tooltip } from './ui'
import { formatAction, ACTION_DOT_STYLES } from '../constants/historyLabels'
import type { HistoryActionType } from '../types'

interface ActionDotProps {
  action: HistoryActionType
}

export function ActionDot({ action }: ActionDotProps): ReactNode {
  const style = ACTION_DOT_STYLES[action] ?? 'bg-gray-400'

  return (
    <Tooltip content={formatAction(action)} compact delay={0}>
      <span
        className={`inline-block h-2.5 w-2.5 rounded-full shrink-0 ${style}`}
        data-testid="action-dot"
      />
    </Tooltip>
  )
}
