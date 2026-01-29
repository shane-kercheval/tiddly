/**
 * Add tag action button for ContentCard.
 *
 * Wraps the AddTagButton component. Does NOT gate on view internally -
 * the parent controls when to render by passing/not passing the handler.
 * This matches existing behavior where parent components conditionally
 * render based on view state.
 */
import type { ReactNode } from 'react'
import { AddTagButton } from '../../AddTagButton'
import type { TagCount } from '../../../types'

interface AddTagActionProps {
  /** Tags already on this item (excluded from suggestions) */
  existingTags: string[]
  /** Available tags for autocomplete suggestions */
  suggestions: TagCount[]
  /** Called when a tag is added */
  onAdd: (tag: string) => void
}

export function AddTagAction({ existingTags, suggestions, onAdd }: AddTagActionProps): ReactNode {
  return (
    <AddTagButton
      existingTags={existingTags}
      suggestions={suggestions}
      onAdd={onAdd}
    />
  )
}
