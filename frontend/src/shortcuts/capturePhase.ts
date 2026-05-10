/**
 * Single source of truth for ids handled by capture-phase listeners.
 *
 * `dispatchRegistryShortcut` consults this list to refuse synthetic dispatch
 * for capture-phase ids (the synthetic event would re-traverse the document
 * capture phase and double-fire the original handler).
 *
 * The capture-phase listener (currently in `CodeMirrorEditor.tsx`, migrating
 * to a registry-driven form in M3) imports the same constant and iterates it.
 * Keeping the list here means both consumers reference the same data — no
 * source-of-truth fork.
 *
 * Empty in M2; M3 populates as Alt+Z/L/M/T, Cmd+/, Cmd+Shift+M land in the
 * registry as capture-phase entries.
 */

import type { ShortcutId } from './registry'

export const CAPTURE_PHASE_IDS: readonly ShortcutId[] = []
