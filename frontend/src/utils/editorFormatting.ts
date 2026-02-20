/**
 * Shared editor formatting functions for CodeMirror.
 *
 * These are pure functions that operate on an EditorView instance.
 * Used by both the toolbar buttons/keybindings in CodeMirrorEditor
 * and the editor command menu.
 */
import { EditorView } from '@codemirror/view'
import { getToggleMarkerAction } from './markdownToggle'

/**
 * Toggle markdown markers around selected text (smart toggle).
 * - If selection includes markers: unwrap
 * - If markers are just outside selection: unwrap
 * - Otherwise: wrap
 * If no selection, insert markers and place cursor between them.
 */
export function toggleWrapMarkers(view: EditorView, before: string, after: string): boolean {
  const { state } = view
  const { from, to } = state.selection.main
  const selectedText = state.sliceDoc(from, to)

  // Get surrounding text for smart detection
  const expandedFrom = Math.max(0, from - before.length)
  const expandedTo = Math.min(state.doc.length, to + after.length)
  const surroundingBefore = state.sliceDoc(expandedFrom, from)
  const surroundingAfter = state.sliceDoc(to, expandedTo)

  // Get one more char on each side to detect if markers are part of longer sequences
  // E.g., to distinguish `*` (italic) from `**` (bold)
  const charBeforeSurrounding = expandedFrom > 0 ? state.sliceDoc(expandedFrom - 1, expandedFrom) : ''
  const charAfterSurrounding = expandedTo < state.doc.length ? state.sliceDoc(expandedTo, expandedTo + 1) : ''

  const action = getToggleMarkerAction(
    selectedText,
    surroundingBefore,
    surroundingAfter,
    before,
    after,
    charBeforeSurrounding,
    charAfterSurrounding
  )

  switch (action.type) {
    case 'insert':
      view.dispatch({
        changes: { from, insert: `${before}${after}` },
        selection: { anchor: from + before.length },
      })
      break

    case 'unwrap-selection': {
      const inner = selectedText.slice(before.length, -after.length || undefined)
      view.dispatch({
        changes: { from, to, insert: inner },
        selection: { anchor: from, head: from + inner.length },
      })
      break
    }

    case 'unwrap-surrounding':
      view.dispatch({
        changes: { from: expandedFrom, to: expandedTo, insert: selectedText },
        selection: { anchor: expandedFrom, head: expandedFrom + selectedText.length },
      })
      break

    case 'wrap':
      view.dispatch({
        changes: { from, to, insert: `${before}${selectedText}${after}` },
        selection: { anchor: from + before.length, head: to + before.length },
      })
      break
  }

  return true
}

/**
 * Insert a markdown link. If text is selected, use it as the link text.
 */
export function insertLink(view: EditorView): boolean {
  const { state } = view
  const { from, to } = state.selection.main
  const selectedText = state.sliceDoc(from, to)

  if (selectedText) {
    // Use selected text as link text, place cursor in URL position
    const linkText = `[${selectedText}](url)`
    view.dispatch({
      changes: { from, to, insert: linkText },
      selection: { anchor: from + selectedText.length + 3, head: from + selectedText.length + 6 },
    })
  } else {
    // Insert empty link template, place cursor in text position
    view.dispatch({
      changes: { from, insert: '[text](url)' },
      selection: { anchor: from + 1, head: from + 5 },
    })
  }
  return true
}

/**
 * Insert a code block. Wraps selection in fenced code block markers, or inserts empty block at cursor.
 * Note: This inserts only; it does not detect/remove existing code blocks (that would require parsing).
 */
export function insertCodeBlock(view: EditorView): boolean {
  const { state } = view
  const { from, to } = state.selection.main
  const selectedText = state.sliceDoc(from, to)

  if (selectedText) {
    // Wrap selected text in code block
    view.dispatch({
      changes: { from, to, insert: `\`\`\`\n${selectedText}\n\`\`\`` },
      selection: { anchor: from + 4, head: from + 4 + selectedText.length },
    })
  } else {
    // Insert empty code block and place cursor inside
    view.dispatch({
      changes: { from, insert: '```\n\n```' },
      selection: { anchor: from + 4 },
    })
  }
  return true
}

/**
 * Add or toggle a prefix on selected lines.
 */
export function toggleLinePrefix(view: EditorView, prefix: string): boolean {
  const { state } = view
  const { from, to } = state.selection.main
  const startLine = state.doc.lineAt(from)
  const endLine = state.doc.lineAt(to)

  const changes: { from: number; to: number; insert: string }[] = []
  let newSelectionStart = from
  let newSelectionEnd = to

  for (let lineNum = startLine.number; lineNum <= endLine.number; lineNum++) {
    const line = state.doc.line(lineNum)
    const lineText = line.text

    if (lineText.startsWith(prefix)) {
      // Remove prefix
      changes.push({ from: line.from, to: line.from + prefix.length, insert: '' })
      if (lineNum === startLine.number) newSelectionStart -= prefix.length
      newSelectionEnd -= prefix.length
    } else {
      // Add prefix
      changes.push({ from: line.from, to: line.from, insert: prefix })
      if (lineNum === startLine.number) newSelectionStart += prefix.length
      newSelectionEnd += prefix.length
    }
  }

  view.dispatch({
    changes,
    selection: { anchor: Math.max(0, newSelectionStart), head: newSelectionEnd },
  })
  return true
}

/**
 * Insert a horizontal rule.
 */
export function insertHorizontalRule(view: EditorView): boolean {
  const { state } = view
  const { from } = state.selection.main
  const line = state.doc.lineAt(from)

  // Insert at end of current line with newlines
  const insert = line.text.length > 0 ? '\n\n---\n' : '---\n'
  const insertPos = line.text.length > 0 ? line.to : from

  view.dispatch({
    changes: { from: insertPos, insert },
    selection: { anchor: insertPos + insert.length },
  })
  return true
}

/**
 * Insert text at cursor position.
 */
export function insertText(view: EditorView, text: string): boolean {
  const { from } = view.state.selection.main
  view.dispatch({
    changes: { from, insert: text },
    selection: { anchor: from + text.length },
  })
  return true
}
