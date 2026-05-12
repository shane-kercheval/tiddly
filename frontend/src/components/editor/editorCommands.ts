/**
 * Command definitions for the editor command menu (Cmd+/).
 *
 * Each command maps to an existing formatting function or app-level callback.
 * Commands are grouped into sections: Actions, Format, Insert.
 *
 * REGISTRY INTEGRATION
 * --------------------
 * Entries whose `id` is a `ShortcutId` (e.g., `editor.bold`) get their
 * keyboard hint at render time via `isShortcutId(cmd.id) ? getShortcut(cmd.id).keys : undefined`.
 * Entries with local ids (`heading-1`, `save-and-close`, etc.) don't have a
 * registry shortcut — they render without a keyboard hint.
 *
 * LABELS ARE SURFACE-LOCAL
 * ------------------------
 * Command-menu labels may intentionally differ from registry labels:
 *   - "Link" here vs "Insert Link" in the registry/dialog
 *   - "Version History" vs "Toggle History Sidebar"
 *   - "Bulleted list" vs "Bullet List"
 *   - "Table of Contents" vs "Toggle Table of Contents"
 * The command menu uses concise nouns; the dialog uses verb-prefixed
 * descriptions. These are intentional, not drift.
 *
 * SAVE-AND-CLOSE NOTE
 * -------------------
 * `save-and-close` binds Cmd+Shift+S at the page-scoped handler in
 * Note/Bookmark/Prompt — the registry doesn't model page-scope, so no
 * `ShortcutId` exists for this entry. The narrow `shortcutKeys` carve-out
 * field on `EditorCommand` surfaces the hint in the command menu without
 * reopening the broader drift class: only entries with a non-`ShortcutId`
 * id may use it, enforced at runtime by `editorCommands.test.ts`.
 */
import type { ReactNode } from 'react'
import type { EditorView } from '@codemirror/view'
import { useRightSidebarStore } from '../../stores/rightSidebarStore'
import type { ShortcutId } from '../../shortcuts/registry'
import { PAGE_SCOPED_SAVE_AND_CLOSE_KEYS } from '../../shortcuts/pageScoped'
import {
  toggleWrapMarkers,
  toggleLinePrefix,
  insertLink,
  insertCodeBlock,
  insertHorizontalRule,
  insertText,
  LINE_PREFIXES,
} from '../../utils/editorFormatting'
import { JINJA_VARIABLE, JINJA_IF_BLOCK, JINJA_IF_BLOCK_TRIM } from './jinjaTemplates'

/**
 * Ids for commands that don't have a corresponding registry shortcut.
 *
 * Single source of truth: the `as const` literal array gives us both the
 * runtime set (for invariant tests) and the type union (`LocalCommandId`)
 * for compile-time enforcement on `EditorCommand.id`.
 *
 * Adding a new local-id command below requires adding the id here too —
 * TypeScript will flag the mismatch at the entry's literal.
 */
export const LOCAL_COMMAND_IDS = [
  'save-and-close',
  'discard',
  'heading-1',
  'heading-2',
  'heading-3',
  'jinja-variable',
  'jinja-if-block',
  'jinja-if-block-trim',
] as const

export type LocalCommandId = typeof LOCAL_COMMAND_IDS[number]

/** A single command in the editor command menu. */
export interface EditorCommand {
  /**
   * Either a registry `ShortcutId` (e.g., `editor.bold`) — consumers derive
   * the keyboard hint via `isShortcutId(cmd.id) ? getShortcut(cmd.id).keys`,
   * or a `LocalCommandId` for entries without a registry shortcut. Loose
   * `string` would let typos like `'editor.boldd'` silently drop the hint —
   * the union catches those at compile time.
   */
  id: ShortcutId | LocalCommandId
  label: string
  section: string
  icon: ReactNode
  /**
   * Carve-out for page-scoped shortcuts that can't have a registry entry
   * (the registry doesn't model page-scope binding context).
   *
   * **STRICT RULE**: only entries whose `id` is NOT a `ShortcutId` may set
   * this field. Registry-backed entries MUST derive keys via `getShortcut`,
   * not via this field. The `editorCommands.test.ts` invariant test enforces
   * the rule at runtime.
   *
   * Today's only user: `save-and-close` (⌘⇧S, page-scoped in Note/Bookmark/
   * Prompt). Without this field, the command menu wouldn't show ⌘⇧S — a
   * discovery regression on one of the highest-value shortcuts in the app.
   */
  shortcutKeys?: readonly string[]
  disabled?: boolean
  action: (view: EditorView) => void
}

/** App-level callbacks for save/discard actions. */
export interface MenuCallbacks {
  onSaveAndClose?: () => void
  onDiscard?: () => void
  onToggleReadingMode?: () => void
}

/** Icon factory type - commands receive icon-building functions to avoid importing React components here. */
interface IconFactories {
  bold: () => ReactNode
  italic: () => ReactNode
  strikethrough: () => ReactNode
  highlight: () => ReactNode
  inlineCode: () => ReactNode
  codeBlock: () => ReactNode
  link: () => ReactNode
  bulletList: () => ReactNode
  orderedList: () => ReactNode
  checklist: () => ReactNode
  blockquote: () => ReactNode
  horizontalRule: () => ReactNode
  heading1: () => ReactNode
  heading2: () => ReactNode
  heading3: () => ReactNode
  jinjaVariable: () => ReactNode
  jinjaIf: () => ReactNode
  jinjaIfTrim: () => ReactNode
  save: () => ReactNode
  close: () => ReactNode
  tableOfContents: () => ReactNode
  versionHistory: () => ReactNode
  readingMode: () => ReactNode
}

interface BuildOptions {
  showJinja: boolean
  callbacks: MenuCallbacks
  icons: IconFactories
  /** Whether the editor has unsaved changes (controls discard command state). */
  isDirty?: boolean
  /** Whether to include the Table of Contents toggle command. */
  showTocToggle?: boolean
}

/**
 * Build the list of editor commands based on options.
 */
export function buildEditorCommands({ showJinja, callbacks, icons, isDirty = false, showTocToggle = false }: BuildOptions): EditorCommand[] {
  const commands: EditorCommand[] = []

  // --- Actions section (first, most important for quick access) ---
  if (callbacks.onSaveAndClose) {
    const onSaveAndClose = callbacks.onSaveAndClose
    commands.push({
      // Local id — page-scoped Cmd+Shift+S has no registry entry. The
      // `shortcutKeys` carve-out surfaces the hint in the command menu.
      id: 'save-and-close',
      label: 'Save and close',
      section: 'Actions',
      icon: icons.save(),
      shortcutKeys: PAGE_SCOPED_SAVE_AND_CLOSE_KEYS,
      action: () => { onSaveAndClose() },
    })
  }
  if (callbacks.onDiscard) {
    const onDiscard = callbacks.onDiscard
    commands.push({
      id: 'discard',
      label: 'Discard changes',
      section: 'Actions',
      icon: icons.close(),
      disabled: !isDirty,
      action: () => { onDiscard() },
    })
  }
  if (showTocToggle) {
    commands.push({
      id: 'editor.toggleToc',
      label: 'Table of Contents',
      section: 'Actions',
      icon: icons.tableOfContents(),
      action: () => { useRightSidebarStore.getState().togglePanel('toc') },
    })
  }
  commands.push({
    id: 'app.toggleHistorySidebar',
    label: 'Version History',
    section: 'Actions',
    icon: icons.versionHistory(),
    action: () => { useRightSidebarStore.getState().togglePanel('history') },
  })
  if (callbacks.onToggleReadingMode) {
    const onToggleReadingMode = callbacks.onToggleReadingMode
    commands.push({
      id: 'editor.toggleReadingMode',
      label: 'Toggle Reading Mode',
      section: 'Actions',
      icon: icons.readingMode(),
      action: () => { onToggleReadingMode() },
    })
  }

  // --- Jinja2 section (prompt pages only, before Format for quick access) ---
  if (showJinja) {
    commands.push({
      id: 'jinja-variable',
      label: 'Variable',
      section: 'Jinja2',
      icon: icons.jinjaVariable(),
      action: (view) => { insertText(view, JINJA_VARIABLE) },
    })
    commands.push({
      id: 'jinja-if-block',
      label: 'If block',
      section: 'Jinja2',
      icon: icons.jinjaIf(),
      action: (view) => { insertText(view, JINJA_IF_BLOCK) },
    })
    commands.push({
      id: 'jinja-if-block-trim',
      label: 'If block (trim)',
      section: 'Jinja2',
      icon: icons.jinjaIfTrim(),
      action: (view) => { insertText(view, JINJA_IF_BLOCK_TRIM) },
    })
  }

  // --- Format section ---
  commands.push({
    id: 'editor.bold',
    label: 'Bold',
    section: 'Format',
    icon: icons.bold(),
    action: (view) => { toggleWrapMarkers(view, '**', '**') },
  })
  commands.push({
    id: 'editor.italic',
    label: 'Italic',
    section: 'Format',
    icon: icons.italic(),
    action: (view) => { toggleWrapMarkers(view, '*', '*') },
  })
  commands.push({
    id: 'editor.strikethrough',
    label: 'Strikethrough',
    section: 'Format',
    icon: icons.strikethrough(),
    action: (view) => { toggleWrapMarkers(view, '~~', '~~') },
  })
  commands.push({
    id: 'editor.inlineCode',
    label: 'Inline code',
    section: 'Format',
    icon: icons.inlineCode(),
    action: (view) => { toggleWrapMarkers(view, '`', '`') },
  })
  commands.push({
    id: 'editor.highlight',
    label: 'Highlight',
    section: 'Format',
    icon: icons.highlight(),
    action: (view) => { toggleWrapMarkers(view, '==', '==') },
  })

  // --- Insert section ---
  commands.push({
    id: 'heading-1',
    label: 'Heading 1',
    section: 'Insert',
    icon: icons.heading1(),
    action: (view) => { toggleLinePrefix(view, LINE_PREFIXES.h1) },
  })
  commands.push({
    id: 'heading-2',
    label: 'Heading 2',
    section: 'Insert',
    icon: icons.heading2(),
    action: (view) => { toggleLinePrefix(view, LINE_PREFIXES.h2) },
  })
  commands.push({
    id: 'heading-3',
    label: 'Heading 3',
    section: 'Insert',
    icon: icons.heading3(),
    action: (view) => { toggleLinePrefix(view, LINE_PREFIXES.h3) },
  })
  commands.push({
    id: 'editor.bulletList',
    label: 'Bulleted list',
    section: 'Insert',
    icon: icons.bulletList(),
    action: (view) => { toggleLinePrefix(view, LINE_PREFIXES.bulletList) },
  })
  commands.push({
    id: 'editor.numberedList',
    label: 'Numbered list',
    section: 'Insert',
    icon: icons.orderedList(),
    action: (view) => { toggleLinePrefix(view, LINE_PREFIXES.numberedList) },
  })
  commands.push({
    id: 'editor.checklist',
    label: 'Checklist',
    section: 'Insert',
    icon: icons.checklist(),
    action: (view) => { toggleLinePrefix(view, LINE_PREFIXES.checklist) },
  })
  commands.push({
    id: 'editor.codeBlock',
    label: 'Code block',
    section: 'Insert',
    icon: icons.codeBlock(),
    action: (view) => { insertCodeBlock(view) },
  })
  commands.push({
    id: 'editor.blockquote',
    label: 'Blockquote',
    section: 'Insert',
    icon: icons.blockquote(),
    action: (view) => { toggleLinePrefix(view, LINE_PREFIXES.blockquote) },
  })
  commands.push({
    id: 'editor.insertLink',
    label: 'Link',
    section: 'Insert',
    icon: icons.link(),
    action: (view) => { insertLink(view) },
  })
  commands.push({
    id: 'editor.horizontalRule',
    label: 'Horizontal rule',
    section: 'Insert',
    icon: icons.horizontalRule(),
    action: (view) => { insertHorizontalRule(view) },
  })

  return commands
}
