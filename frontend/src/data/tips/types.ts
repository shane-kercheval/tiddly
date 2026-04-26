/**
 * Tip data model for the user-education system.
 *
 * Tips are small, self-contained pieces of guidance shown across the app:
 * the /docs/tips page, command palette, new-user empty states, and ambient
 * callouts. The schema is deliberately minimal — visual divergence between
 * surfaces lives in renderers (M2), not extra fields.
 */

export type TipCategory =
  | 'editor'
  | 'search'
  | 'filters'
  | 'tags'
  | 'cli'
  | 'extension'
  | 'mcp'
  | 'prompts'
  | 'bookmarks'
  | 'notes'
  | 'ai'
  | 'shortcuts'
  | 'account'

export type TipAudience = 'beginner' | 'power' | 'all'

export type TipMedia =
  | { kind: 'image'; src: string; alt: string }
  | { kind: 'video'; src: string; alt: string; poster?: string }
  | { kind: 'component'; id: string }

export interface RelatedDoc {
  label: string
  path: string
}

export interface Tip {
  /** Stable kebab-case slug, unique across all tips. */
  id: string
  /** Title — enforced ≤ 80 chars by validation. */
  title: string
  /** Markdown body — enforced ≤ 500 chars by validation. */
  body: string
  category: TipCategory
  audience: TipAudience
  /**
   * Route prefixes (not glob patterns) where this tip is contextually relevant.
   * A tip with `areas: ['/app/content']` covers `/app/content` and any descendant
   * path. Do not include trailing `*` — matching is exact-or-longest-prefix, not glob.
   */
  areas?: string[]
  /** Keyboard shortcut tokens, if applicable. */
  shortcut?: string[]
  /** Links to deeper docs. */
  relatedDocs?: RelatedDoc[]
  /** Optional media (most tips have none). */
  media?: TipMedia
  /** True for the curated new-user starter set; used in empty states. */
  starter?: boolean
  /**
   * Sort priority among starter tips (lower = higher priority).
   * Required when starter=true; must be unique within each category.
   */
  starterPriority?: number
}

export const TITLE_MAX_LENGTH = 80
export const BODY_MAX_LENGTH = 500
