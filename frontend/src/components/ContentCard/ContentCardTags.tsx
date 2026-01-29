/**
 * Tags section for ContentCard.
 *
 * Renders a list of Tag components with optional click and remove handlers.
 * Returns null when there are no tags to display.
 */
import type { ReactNode } from 'react'
import { Tag } from '../Tag'

interface ContentCardTagsProps {
  /** Array of tag strings to display */
  tags: string[]
  /** Called when a tag is clicked (e.g., to filter by tag) */
  onTagClick?: (tag: string) => void
  /** Called when a tag's remove button is clicked */
  onTagRemove?: (tag: string) => void
}

export function ContentCardTags({
  tags,
  onTagClick,
  onTagRemove,
}: ContentCardTagsProps): ReactNode {
  if (tags.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1 md:justify-end md:w-32 md:shrink-0">
      {tags.map((tag) => (
        <Tag
          key={tag}
          tag={tag}
          onClick={onTagClick ? () => onTagClick(tag) : undefined}
          onRemove={onTagRemove ? () => onTagRemove(tag) : undefined}
        />
      ))}
    </div>
  )
}
