/**
 * "Public" status indicator for ContentCard.
 *
 * A small, muted globe shown when an item is published to a public share link —
 * an at-a-glance answer to "what of mine is public?" from a list. This is passive
 * *status*, not an action (the share controls live on the item's detail page), so
 * it's deliberately quiet and icon-only — a globe (not the share-action glyph),
 * which reads as "visible on the web."
 */
import type { ReactNode } from 'react'
import { GlobeIcon } from '../icons'
import { Tooltip } from '../ui'

interface ContentCardPublicStatusProps {
  isPublic: boolean
}

export function ContentCardPublicStatus({ isPublic }: ContentCardPublicStatusProps): ReactNode {
  if (!isPublic) return null
  return (
    <Tooltip content="Public — anyone with the link can view" compact position="left" delay={500}>
      {/* relative top-px nudges the glyph down to optically center it against the date text. */}
      <span className="relative top-px flex items-center text-gray-400" aria-label="Public">
        <GlobeIcon className="w-3.5 h-3.5" />
      </span>
    </Tooltip>
  )
}
