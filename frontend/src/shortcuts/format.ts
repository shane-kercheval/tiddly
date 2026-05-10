/**
 * Format helpers that turn registry entries into human-readable strings.
 *
 * Used by toolbar tooltips, command-menu rows, and other display surfaces
 * that need a short "Label (⌘B)" representation of a shortcut.
 */

import { getShortcut, type ShortcutId } from './registry'
import { formatShortcut } from '../utils/platform'

/**
 * Format a registry entry as `"Label (⌘B)"` (Mac) or `"Label (Ctrl+B)"`
 * (Windows/Linux). Suitable for toolbar button tooltips and similar.
 */
export function tooltipFor(id: ShortcutId): string {
  const entry = getShortcut(id)
  return `${entry.label} (${formatShortcut(entry.keys)})`
}
