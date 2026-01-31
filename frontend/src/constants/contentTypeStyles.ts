/**
 * Centralized styling constants for content types (bookmark, note, prompt).
 *
 * Use these constants to ensure consistent icon colors and backgrounds across the app.
 * Colors are muted/desaturated for a calmer visual appearance.
 *
 * Brand color palette (defined in index.css):
 * - Bookmark: #6b9fd4 (muted blue)
 * - Note: #7dcec4 (muted teal)
 * - Prompt: #e2a66b (muted orange)
 * - All Content: #6855aa (muted purple)
 *
 * Danger/delete actions use Tailwind's built-in red classes directly.
 */
import type { ContentType } from '../types'

/**
 * Tailwind CSS classes for content type icons.
 * These are the text colors used for icons in cards, sidebars, and lists.
 */
export const CONTENT_TYPE_ICON_COLORS: Record<ContentType, string> = {
  bookmark: 'text-brand-bookmark',
  note: 'text-brand-note',
  prompt: 'text-brand-prompt',
}

/**
 * Tailwind CSS classes for content type badge backgrounds.
 * Used for filter chips, tags, and other badge-like elements.
 */
export const CONTENT_TYPE_BADGE_STYLES: Record<ContentType, string> = {
  bookmark: 'bg-brand-bookmark-light text-brand-bookmark',
  note: 'bg-brand-note-light text-brand-note',
  prompt: 'bg-brand-prompt-light text-brand-prompt',
}

/**
 * Color for "all content" views (purple).
 */
export const ALL_CONTENT_COLOR = 'text-brand-all'
export const ALL_CONTENT_BADGE_STYLE = 'bg-brand-all-light text-brand-all'
