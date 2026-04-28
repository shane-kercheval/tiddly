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

// Note for the first author of a media tip: extend `image`/`video` variants
// with explicit width/height (or aspectRatio) before shipping. Without
// reserved dimensions, the loaded media will cause cumulative layout shift
// inside scroll-heavy contexts like /docs/tips.
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
  /**
   * Categories the tip belongs to. Non-empty. A tip can claim multiple
   * categories — e.g. slash commands apply to both `notes` and `prompts`;
   * paste-URL is both a `bookmarks` tip and a `shortcuts` tip. The /docs/tips
   * page renders the tip under each section it claims (deliberate duplication
   * for browsability); empty-state pickers dedupe by id so the same tip never
   * shows up twice in one list.
   */
  categories: TipCategory[]
  audience: TipAudience
  /**
   * Global display priority for /docs/tips and similar ranked surfaces.
   * Lower = higher rank. Tips without a priority sort to the bottom (id asc).
   * Independent of `starterPriority`, which governs empty-state picking only.
   */
  priority?: number
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
   * Required when starter=true; must be unique within EACH category the tip
   * claims (a multi-category starter must not collide with another starter at
   * the same priority in any of its declared categories).
   */
  starterPriority?: number
}

export const TITLE_MAX_LENGTH = 80
export const BODY_MAX_LENGTH = 500
