/**
 * Command definitions for the editor command menu (Cmd+/).
 *
 * Each command maps to an existing formatting function or app-level callback.
 * Commands are grouped into sections: Actions, Format, Insert.
 */
import type { ReactNode } from 'react'
import type { EditorView } from '@codemirror/view'
import { useRightSidebarStore } from '../../stores/rightSidebarStore'
import {
  toggleWrapMarkers,
  toggleLinePrefix,
  insertLink,
  insertCodeBlock,
  insertHorizontalRule,
  insertText,
} from '../../utils/editorFormatting'
import { JINJA_VARIABLE, JINJA_IF_BLOCK, JINJA_IF_BLOCK_TRIM } from './jinjaTemplates'

/** A single command in the editor command menu. */
export interface EditorCommand {
  id: string
  label: string
  section: string
  icon: ReactNode
  shortcut?: string[]
  disabled?: boolean
  action: (view: EditorView) => void
}

/** App-level callbacks for save/discard actions. */
export interface MenuCallbacks {
  onSaveAndClose?: () => void
  onDiscard?: () => void
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
  taskList: () => ReactNode
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
      id: 'save-and-close',
      label: 'Save and close',
      section: 'Actions',
      icon: icons.save(),
      shortcut: ['\u2318', '\u21e7', 'S'],
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
      id: 'toggle-toc',
      label: 'Table of Contents',
      section: 'Actions',
      icon: icons.tableOfContents(),
      shortcut: ['⌥', 'T'],
      action: () => { useRightSidebarStore.getState().togglePanel('toc') },
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
    id: 'bold',
    label: 'Bold',
    section: 'Format',
    icon: icons.bold(),
    shortcut: ['\u2318', 'B'],
    action: (view) => { toggleWrapMarkers(view, '**', '**') },
  })
  commands.push({
    id: 'italic',
    label: 'Italic',
    section: 'Format',
    icon: icons.italic(),
    shortcut: ['\u2318', 'I'],
    action: (view) => { toggleWrapMarkers(view, '*', '*') },
  })
  commands.push({
    id: 'strikethrough',
    label: 'Strikethrough',
    section: 'Format',
    icon: icons.strikethrough(),
    shortcut: ['\u2318', '\u21e7', 'X'],
    action: (view) => { toggleWrapMarkers(view, '~~', '~~') },
  })
  commands.push({
    id: 'inline-code',
    label: 'Inline code',
    section: 'Format',
    icon: icons.inlineCode(),
    shortcut: ['\u2318', 'E'],
    action: (view) => { toggleWrapMarkers(view, '`', '`') },
  })
  commands.push({
    id: 'highlight',
    label: 'Highlight',
    section: 'Format',
    icon: icons.highlight(),
    shortcut: ['\u2318', '\u21e7', 'H'],
    action: (view) => { toggleWrapMarkers(view, '==', '==') },
  })

  // --- Insert section ---
  commands.push({
    id: 'heading-1',
    label: 'Heading 1',
    section: 'Insert',
    icon: icons.heading1(),
    action: (view) => { toggleLinePrefix(view, '# ') },
  })
  commands.push({
    id: 'heading-2',
    label: 'Heading 2',
    section: 'Insert',
    icon: icons.heading2(),
    action: (view) => { toggleLinePrefix(view, '## ') },
  })
  commands.push({
    id: 'heading-3',
    label: 'Heading 3',
    section: 'Insert',
    icon: icons.heading3(),
    action: (view) => { toggleLinePrefix(view, '### ') },
  })
  commands.push({
    id: 'bullet-list',
    label: 'Bulleted list',
    section: 'Insert',
    icon: icons.bulletList(),
    shortcut: ['\u2318', '\u21e7', '8'],
    action: (view) => { toggleLinePrefix(view, '- ') },
  })
  commands.push({
    id: 'numbered-list',
    label: 'Numbered list',
    section: 'Insert',
    icon: icons.orderedList(),
    shortcut: ['\u2318', '\u21e7', '7'],
    action: (view) => { toggleLinePrefix(view, '1. ') },
  })
  commands.push({
    id: 'todo-list',
    label: 'To-do list',
    section: 'Insert',
    icon: icons.taskList(),
    shortcut: ['\u2318', '\u21e7', '9'],
    action: (view) => { toggleLinePrefix(view, '- [ ] ') },
  })
  commands.push({
    id: 'code-block',
    label: 'Code block',
    section: 'Insert',
    icon: icons.codeBlock(),
    shortcut: ['\u2318', '\u21e7', 'E'],
    action: (view) => { insertCodeBlock(view) },
  })
  commands.push({
    id: 'blockquote',
    label: 'Blockquote',
    section: 'Insert',
    icon: icons.blockquote(),
    shortcut: ['\u2318', '\u21e7', '.'],
    action: (view) => { toggleLinePrefix(view, '> ') },
  })
  commands.push({
    id: 'link',
    label: 'Link',
    section: 'Insert',
    icon: icons.link(),
    shortcut: ['\u2318', 'K'],
    action: (view) => { insertLink(view) },
  })
  commands.push({
    id: 'horizontal-rule',
    label: 'Horizontal rule',
    section: 'Insert',
    icon: icons.horizontalRule(),
    shortcut: ['\u2318', '\u21e7', '-'],
    action: (view) => { insertHorizontalRule(view) },
  })

  return commands
}
