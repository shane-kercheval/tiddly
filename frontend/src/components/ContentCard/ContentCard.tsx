/**
 * ContentCard - Composable card container for content items.
 *
 * Uses the compound component pattern to provide reusable subcomponents
 * for tags, actions, date display, etc. that can be composed by
 * BookmarkCard, NoteCard, PromptCard, and future content type cards.
 *
 * Usage:
 * ```tsx
 * <ContentCard view="active" onClick={handleClick}>
 *   <Header>...</Header>
 *   <ContentCard.Footer>
 *     <ContentCard.Tags tags={tags} onTagClick={onTagClick} />
 *     <ContentCard.Actions meta={<ContentCard.DateDisplay ... />}>
 *       <ContentCard.ArchiveAction onArchive={onArchive} entityName="note" />
 *       <ContentCard.DeleteAction onDelete={onDelete} entityName="note" />
 *     </ContentCard.Actions>
 *   </ContentCard.Footer>
 * </ContentCard>
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
  /** Card content (header + ContentCard.Footer) */
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
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:gap-4">
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
