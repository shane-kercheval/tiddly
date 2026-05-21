/**
 * Editor-toolbar tooltip content for a registry shortcut.
 *
 * Renders the registry's label on one line and the platform-localized
 * shortcut combo on a second muted line. The multi-line layout avoids
 * truncation when the localized combo is long ("Ctrl+Shift+M" on
 * Windows/Linux is wider than "⌘⇧M" on Mac).
 *
 * This helper lives in the editor UI layer (not in `shortcuts/`) because it
 * encodes tooltip-specific UI decisions — the multi-line layout, the `<br>`
 * separator, the `opacity-75` muted styling. The shortcuts layer stays a
 * pure data/logic layer (registry, matcher, adapter, dispatch).
 *
 * Consumers: `CodeMirrorEditor` toolbar buttons + view-toggle tooltips, and
 * (vestigially) `MilkdownEditor` toolbar buttons.
 */
import type { ReactNode } from 'react'
import { getShortcut, type ShortcutId } from '../../shortcuts/registry'
import { formatShortcut } from '../../utils/platform'

/**
 * @param labelOverride - replaces the registry label on the first line (the
 *   shortcut combo stays registry-driven). For buttons whose label depends on
 *   state, e.g. "Maximize" vs "Restore" for a single toggle id.
 */
export function shortcutTooltipContent(id: ShortcutId, labelOverride?: string): ReactNode {
  const entry = getShortcut(id)
  return (
    <>
      {labelOverride ?? entry.label}
      <br />
      <span className="opacity-75">{formatShortcut(entry.keys)}</span>
    </>
  )
}
