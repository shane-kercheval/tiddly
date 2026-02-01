/**
 * ContentCard - Composable card container for content items.
 *
 * Uses CSS Grid with two columns:
 * - Icon column: Fixed width for content type icon
 * - Content column: Flexible width for all other content
 *
 * Layout structure:
 * ```
 * [icon] [Title] [favicon?] [tags]                    [date]
 *        [domain/subtitle]                     [actions on hover]
 *        [description]
 * ```
 */
import type { ReactNode } from 'react'
import { ContentCardContext } from './ContentCardContext'
import type { ContentCardView } from './ContentCardContext'
import { ContentCardFooter } from './ContentCardFooter'
import { ContentCardTags } from './ContentCardTags'
import { ContentCardDateDisplay } from './ContentCardDateDisplay'
import { ContentCardActions } from './ContentCardActions'
import { ContentCardScheduledArchive } from './ContentCardScheduledArchive'
import { AddTagAction, ArchiveAction, RestoreAction, DeleteAction } from './actions'

interface ContentCardProps {
  /** Current view context - determines which actions are available */
  view?: ContentCardView
  /** Click handler for the card */
  onClick?: () => void
  /** Card content */
  children: ReactNode
  /** Additional CSS classes */
  className?: string
}

function ContentCardBase({
  view = 'active',
  onClick,
  children,
  className = '',
}: ContentCardProps): ReactNode {
  return (
    <ContentCardContext.Provider value={{ view }}>
      <div
        className={`card card-interactive group ${onClick ? 'cursor-pointer' : ''} ${className}`.trim()}
        onClick={onClick}
      >
        <div className="grid grid-cols-[auto_1fr] gap-x-2 items-start">
          {children}
        </div>
      </div>
    </ContentCardContext.Provider>
  )
}

// Static properties are attached here for compound component pattern.
export const ContentCard = Object.assign(ContentCardBase, {
  Footer: ContentCardFooter,
  Tags: ContentCardTags,
  DateDisplay: ContentCardDateDisplay,
  Actions: ContentCardActions,
  ScheduledArchive: ContentCardScheduledArchive,
  AddTagAction,
  ArchiveAction,
  RestoreAction,
  DeleteAction,
})
