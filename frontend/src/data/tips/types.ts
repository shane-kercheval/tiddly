/**
 * Tip data model for the user-education system.
 *
 * Tips are small, self-contained pieces of guidance shown across the app:
 * the /docs/tips page, command palette, new-user empty states, and ambient
 * callouts. The schema is deliberately minimal — visual divergence between
 * surfaces lives in renderers, not extra fields.
 */
import type { ShortcutId } from '../../shortcuts/registry'
import type { ContentExtraShortcutId } from './contentExtraShortcuts'

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

/**
 * Subscription tier required to use the feature the tip describes.
 * `undefined` = available on all tiers (free implicit baseline). Aligns with
 * the runtime `Tier` constants (`FREE` / `STANDARD` / `PRO`); `DEV` is a
 * runtime-only override and isn't expressed here.
 *
 * Renderer-side handling (tier badge + upgrade CTA) is part of Follow-up #1
 * in the user-education plan and lands separately — authoring sets the field
 * now so the corpus carries the right metadata when the UI catches up.
 */
export type TipMinTier = 'standard' | 'pro'

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
  /**
   * Stable id pointing at a shortcut definition. Preferred over `shortcut`
   * because chip row and body tokens both resolve through the registry — when
   * a binding moves, every display surface updates. Mutually exclusive with
   * `shortcut`; enforced by `validateTips`.
   */
  shortcutId?: ContentShortcutId
  /**
   * Literal display tokens — fallback for shortcuts no registry covers (none
   * currently). Author as OS-agnostic tokens (`['Mod', 'V']`); localization
   * happens at render. Prefer `shortcutId` when the shortcut maps to a registry entry.
   */
  shortcut?: readonly string[]
  /** Links to deeper docs. */
  relatedDocs?: RelatedDoc[]
  /** Optional media (most tips have none). */
  media?: TipMedia
  /**
   * Minimum subscription tier required to use the feature this tip describes.
   * Omit for features available on all tiers. See `TipMinTier` for the
   * renderer-handoff note.
   */
  minTier?: TipMinTier
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

/**
 * Union of shortcut ids that authored content (tips + docs prose) can reference.
 * `ShortcutId` covers the main `frontend/src/shortcuts/registry.ts`;
 * `ContentExtraShortcutId` covers the content-scoped extras the main registry
 * intentionally excludes (page-scoped saves, Chrome extension popup, upstream
 * CodeMirror editor chords, and the raw-editor link modifier) — see
 * `contentExtraShortcuts.ts` for the per-category rationale.
 */
export type ContentShortcutId = ShortcutId | ContentExtraShortcutId
