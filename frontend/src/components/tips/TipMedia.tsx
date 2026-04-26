/**
 * Render a tip's optional media (image, video, or component placeholder).
 *
 * The `component` variant exists in the schema for future custom-animated tips
 * but its renderer registry is intentionally empty in v1 — those tips render
 * as no-op until a registry lands.
 */
import type { ReactNode } from 'react'
import type { TipMedia as TipMediaValue } from '../../data/tips/types'

interface TipMediaProps {
  media: TipMediaValue
}

export function TipMedia({ media }: TipMediaProps): ReactNode {
  if (media.kind === 'image') {
    return (
      <img
        src={media.src}
        alt={media.alt}
        loading="lazy"
        className="rounded-md border border-gray-200"
      />
    )
  }

  if (media.kind === 'video') {
    return (
      <video
        src={media.src}
        poster={media.poster}
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        aria-label={media.alt}
        className="rounded-md border border-gray-200"
      />
    )
  }

  // media.kind === 'component' — registry is empty in v1.
  return null
}
