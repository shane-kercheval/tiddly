/**
 * Single source of truth for ids handled by capture-phase listeners.
 *
 * `dispatchRegistryShortcut` consults this list to refuse synthetic dispatch
 * for capture-phase ids — the synthetic event would re-traverse the document
 * capture phase and double-fire the original handler.
 *
 * CodeMirrorEditor's capture-phase listener iterates this same list to drive
 * its keydown matching, so both consumers reference one source — no fork.
 */

import type { ShortcutId } from './registry'

export const CAPTURE_PHASE_IDS = [
  'editor.toggleReadingMode',
  'editor.toggleWordWrap',
  'editor.toggleLineNumbers',
  'editor.toggleMonoFont',
  'editor.toggleToc',
  'editor.commandMenu',
] as const satisfies readonly ShortcutId[]
