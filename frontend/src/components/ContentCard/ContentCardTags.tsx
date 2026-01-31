/**
 * Tags section for ContentCard.
 *
 * Renders tags inline with the title.
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
    <div className="inline-flex flex-wrap items-center gap-1">
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
