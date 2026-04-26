/**
 * Render a tip in any context. Two variants:
 *
 * - `full` — list-row style for the /docs/tips page (M3). Title with badges
 *   (audience + category), shortcut keys when present, body, optional media,
 *   related-doc links.
 * - `compact` — small standalone card for use inside an empty state (M7).
 *   Title and body only; badges/shortcut/media/related-docs are intentionally
 *   omitted to keep the card lean inside a centered empty state.
 */
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { Tip, TipAudience } from '../../data/tips/types'
import { TipBody } from './TipBody'
import { TipMedia } from './TipMedia'

interface TipCardProps {
  tip: Tip
  variant: 'full' | 'compact'
}

const AUDIENCE_LABELS: Record<TipAudience, string> = {
  beginner: 'Beginner',
  power: 'Power user',
  all: 'All',
}

export function TipCard({ tip, variant }: TipCardProps): ReactNode {
  if (variant === 'compact') {
    return (
      <div
        className="rounded-lg border border-gray-200 bg-white p-3 text-left"
        data-tip-id={tip.id}
      >
        <h4 className="mb-1 text-sm font-medium text-gray-900">{tip.title}</h4>
        <TipBody body={tip.body} />
      </div>
    )
  }

  // Anchor convention: DOM id is `tip-<id>` (kebab-slug ids could otherwise
  // collide with unrelated page elements). Deep-link URLs from M3/M8/M9 must
  // generate `/docs/tips#tip-<id>` to match — keep these in sync.
  return (
    <div
      id={`tip-${tip.id}`}
      className="border-b border-gray-100 py-5 last:border-b-0"
      data-tip-id={tip.id}
    >
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <h3 className="text-base font-medium text-gray-900">{tip.title}</h3>
        {tip.audience !== 'all' && <Badge>{AUDIENCE_LABELS[tip.audience]}</Badge>}
        <Badge>{tip.category}</Badge>
      </div>

      {tip.shortcut && tip.shortcut.length > 0 && (
        <div className="mb-3 flex items-center gap-1.5 text-xs text-gray-500">
          <span>Shortcut:</span>
          {tip.shortcut.map((key, index) => (
            <span key={index} className="inline-flex items-center gap-1">
              {index > 0 && <span className="text-gray-400">+</span>}
              <Kbd>{key}</Kbd>
            </span>
          ))}
        </div>
      )}

      <TipBody body={tip.body} />

      {tip.media && (
        <div className="mt-3">
          <TipMedia media={tip.media} />
        </div>
      )}

      {tip.relatedDocs && tip.relatedDocs.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
          <span className="text-gray-400">Related:</span>
          {tip.relatedDocs.map((doc) => (
            <Link
              key={doc.path}
              to={doc.path}
              className="text-blue-600 hover:underline"
            >
              {doc.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

function Badge({ children }: { children: ReactNode }): ReactNode {
  return (
    <span className="inline-block rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-600">
      {children}
    </span>
  )
}

function Kbd({ children }: { children: ReactNode }): ReactNode {
  return (
    <kbd className="inline-flex min-w-[24px] items-center justify-center rounded border border-gray-300 bg-gray-100 px-1.5 py-0.5 font-mono text-xs font-medium text-gray-700">
      {children}
    </kbd>
  )
}
