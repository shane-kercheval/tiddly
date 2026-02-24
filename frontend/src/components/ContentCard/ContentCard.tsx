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
import { ContentCardArchiveStatus } from './ContentCardArchiveStatus'
import { AddTagAction, ArchiveAction, RestoreAction, DeleteAction } from './actions'

interface ContentCardProps {
  /** Current view context - determines which actions are available */
  view?: ContentCardView
  /** Click handler for the card */
  onClick?: () => void
  /** URL for cmd/ctrl+click to open in new tab */
  href?: string
  /** Whether to show interactive hover styles (background, rounded corners). Defaults to true. */
  interactive?: boolean
  /** Card content */
  children: ReactNode
  /** Additional CSS classes */
  className?: string
}

function ContentCardBase({
  view = 'active',
  onClick,
  href,
  interactive = true,
  children,
  className = '',
}: ContentCardProps): ReactNode {
  const handleClick = (e: React.MouseEvent): void => {
    if (href && (e.metaKey || e.ctrlKey)) {
      window.open(href, '_blank')
      return
    }
    onClick?.()
  }

  return (
    <ContentCardContext.Provider value={{ view }}>
      <div
        className={`card ${interactive ? 'card-interactive' : ''} group ${onClick ? 'cursor-pointer' : ''} ${className}`.trim()}
        onClick={(onClick || href) ? handleClick : undefined}
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
  ArchiveStatus: ContentCardArchiveStatus,
  AddTagAction,
  ArchiveAction,
  RestoreAction,
  DeleteAction,
})
