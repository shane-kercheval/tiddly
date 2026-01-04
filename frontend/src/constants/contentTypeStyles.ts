/**
 * Centralized styling constants for content types (bookmark, note, prompt).
 *
 * Use these constants to ensure consistent icon colors and backgrounds across the app.
 */
import type { ContentType } from '../types'

/**
 * Tailwind CSS classes for content type icons.
 * These are the text colors used for icons in cards, sidebars, and lists.
 */
export const CONTENT_TYPE_ICON_COLORS: Record<ContentType, string> = {
  bookmark: 'text-blue-500',
  note: 'text-green-500',
  prompt: 'text-orange-500',
}

/**
 * Tailwind CSS classes for content type badge backgrounds.
 * Used for filter chips, tags, and other badge-like elements.
 */
export const CONTENT_TYPE_BADGE_STYLES: Record<ContentType, string> = {
  bookmark: 'bg-blue-100 text-blue-700',
  note: 'bg-green-100 text-green-700',
  prompt: 'bg-orange-100 text-orange-700',
}
