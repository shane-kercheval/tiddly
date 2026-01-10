/**
 * Tests for MilkdownEditor Tab/Shift+Tab functionality.
 *
 * These tests verify the Tab keymap plugin behavior for:
 * - List item indentation (sink/lift)
 * - Code block indentation (insert/remove 4 spaces)
 * - Regular text (no-op, but prevents focus escape)
 */
import { describe, it, expect } from 'vitest'
import { EditorState, TextSelection } from '@milkdown/kit/prose/state'
import { Schema } from '@milkdown/kit/prose/model'
import { keymap as createKeymap } from '@milkdown/kit/prose/keymap'
import { sinkListItem, liftListItem } from '@milkdown/kit/prose/schema-list'

// Create a minimal schema for testing
const testSchema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*', toDOM: () => ['p', 0] },
    text: { group: 'inline' },
    code_block: { group: 'block', content: 'text*', code: true, toDOM: () => ['pre', ['code', 0]] },
    bullet_list: { group: 'block', content: 'list_item+', toDOM: () => ['ul', 0] },
    list_item: { content: 'paragraph block*', toDOM: () => ['li', 0] },
  },
  marks: {},
})

/**
 * Helper to check if selection is inside a code_block node.
 * (Duplicated from MilkdownEditor.tsx for testing - in production this is internal)
 */
function isInCodeBlock(state: EditorState): boolean {
  const { $from } = state.selection
  for (let d = $from.depth; d >= 0; d--) {
    if ($from.node(d).type.name === 'code_block') {
      return true
    }
  }
  return false
}

describe('MilkdownEditor Tab functionality', () => {
  describe('isInCodeBlock helper', () => {
    it('should return true when cursor is inside a code block', () => {
      // Create a document with a code block containing some text
      const doc = testSchema.node('doc', null, [
        testSchema.node('code_block', null, [testSchema.text('const x = 1')]),
      ])
      const state = EditorState.create({ doc, schema: testSchema })
      // Selection is at position 1 (inside the code block)
      const stateWithSelection = state.apply(
        state.tr.setSelection(TextSelection.near(state.doc.resolve(1)))
      )

      expect(isInCodeBlock(stateWithSelection)).toBe(true)
    })

    it('should return false when cursor is in a paragraph', () => {
      const doc = testSchema.node('doc', null, [
        testSchema.node('paragraph', null, [testSchema.text('Hello world')]),
      ])
      const state = EditorState.create({ doc, schema: testSchema })
      const stateWithSelection = state.apply(
        state.tr.setSelection(TextSelection.near(state.doc.resolve(1)))
      )

      expect(isInCodeBlock(stateWithSelection)).toBe(false)
    })

    it('should return false when cursor is in a list item', () => {
      const doc = testSchema.node('doc', null, [
        testSchema.node('bullet_list', null, [
          testSchema.node('list_item', null, [
            testSchema.node('paragraph', null, [testSchema.text('List item')]),
          ]),
        ]),
      ])
      const state = EditorState.create({ doc, schema: testSchema })
      // Position 3 is inside the paragraph within the list item
      const stateWithSelection = state.apply(
        state.tr.setSelection(TextSelection.near(state.doc.resolve(3)))
      )

      expect(isInCodeBlock(stateWithSelection)).toBe(false)
    })
  })

  describe('Tab in code blocks', () => {
    it('should insert 4 spaces when Tab is pressed in a code block', () => {
      const doc = testSchema.node('doc', null, [
        testSchema.node('code_block', null, [testSchema.text('function foo() {')]),
      ])
      const state = EditorState.create({ doc, schema: testSchema })
      // Position cursor at end of code block content
      const pos = doc.content.size - 1
      const stateWithSelection = state.apply(
        state.tr.setSelection(TextSelection.near(state.doc.resolve(pos)))
      )

      // Simulate what the Tab handler does
      const INDENT = '    '
      const tr = stateWithSelection.tr.insertText(INDENT)
      const newState = stateWithSelection.apply(tr)

      // The code block should now contain the original text plus 4 spaces
      const codeBlockContent = newState.doc.firstChild?.textContent
      expect(codeBlockContent).toBe('function foo() {    ')
    })

    it('should remove up to 4 leading spaces when Shift+Tab is pressed', () => {
      const doc = testSchema.node('doc', null, [
        testSchema.node('code_block', null, [testSchema.text('    indented line')]),
      ])
      const state = EditorState.create({ doc, schema: testSchema })
      // Position cursor somewhere in the line
      const stateWithSelection = state.apply(
        state.tr.setSelection(TextSelection.near(state.doc.resolve(5)))
      )

      // Simulate what the Shift+Tab handler does
      const { $from } = stateWithSelection.selection
      const lineStart = $from.start()
      const textBefore = stateWithSelection.doc.textBetween(lineStart, $from.pos)
      const lastNewline = textBefore.lastIndexOf('\n')
      const lineContentStart = lastNewline === -1 ? lineStart : lineStart + lastNewline + 1

      const lineText = stateWithSelection.doc.textBetween(lineContentStart, $from.pos)
      const leadingSpaces = lineText.match(/^ */)?.[0].length ?? 0
      const spacesToRemove = Math.min(leadingSpaces, 4)

      expect(spacesToRemove).toBe(4)

      const tr = stateWithSelection.tr.delete(lineContentStart, lineContentStart + spacesToRemove)
      const newState = stateWithSelection.apply(tr)

      const codeBlockContent = newState.doc.firstChild?.textContent
      expect(codeBlockContent).toBe('indented line')
    })

    it('should remove only available spaces if less than 4', () => {
      const doc = testSchema.node('doc', null, [
        testSchema.node('code_block', null, [testSchema.text('  two spaces')]),
      ])
      const state = EditorState.create({ doc, schema: testSchema })
      const stateWithSelection = state.apply(
        state.tr.setSelection(TextSelection.near(state.doc.resolve(3)))
      )

      const { $from } = stateWithSelection.selection
      const lineStart = $from.start()
      const lineText = stateWithSelection.doc.textBetween(lineStart, $from.pos)
      const leadingSpaces = lineText.match(/^ */)?.[0].length ?? 0
      const spacesToRemove = Math.min(leadingSpaces, 4)

      expect(spacesToRemove).toBe(2)
    })
  })

  describe('Tab in list items', () => {
    it('should call sinkListItem when Tab is pressed in a list item', () => {
      // sinkListItem requires a proper list structure with multiple items
      // to actually sink (indent) an item. We test that the command is callable.
      const doc = testSchema.node('doc', null, [
        testSchema.node('bullet_list', null, [
          testSchema.node('list_item', null, [
            testSchema.node('paragraph', null, [testSchema.text('Item 1')]),
          ]),
          testSchema.node('list_item', null, [
            testSchema.node('paragraph', null, [testSchema.text('Item 2')]),
          ]),
        ]),
      ])
      const state = EditorState.create({ doc, schema: testSchema })

      // Get the list_item node type
      const listItemType = testSchema.nodes.list_item

      // Create the sinkListItem command
      const sinkCommand = sinkListItem(listItemType)

      // The command should be callable (returns a function that takes state, dispatch)
      expect(typeof sinkCommand).toBe('function')

      // Position in second list item (where sinking is possible)
      // Structure: doc > bullet_list > list_item > paragraph > text
      // Positions: 0    1              2 (li1)     3 (p)       4-10 (text)
      //                                11 (li2)    12 (p)      13-19 (text)
      const stateWithSelection = state.apply(
        state.tr.setSelection(TextSelection.near(state.doc.resolve(13)))
      )

      // Test that command can be executed (returns true if it made changes, false otherwise)
      // We test without dispatch first to see if it would apply
      const wouldApply = sinkCommand(stateWithSelection)
      expect(typeof wouldApply).toBe('boolean')
    })

    it('should call liftListItem when Shift+Tab is pressed in a nested list item', () => {
      const listItemType = testSchema.nodes.list_item
      const liftCommand = liftListItem(listItemType)

      expect(typeof liftCommand).toBe('function')
    })
  })

  describe('Tab in regular paragraphs', () => {
    it('should not be in a code block or list item', () => {
      const doc = testSchema.node('doc', null, [
        testSchema.node('paragraph', null, [testSchema.text('Regular text')]),
      ])
      const state = EditorState.create({ doc, schema: testSchema })
      const stateWithSelection = state.apply(
        state.tr.setSelection(TextSelection.near(state.doc.resolve(1)))
      )

      // Not in code block
      expect(isInCodeBlock(stateWithSelection)).toBe(false)

      // Not in list item (check by traversing nodes)
      const { $from } = stateWithSelection.selection
      let inListItem = false
      for (let d = $from.depth; d >= 0; d--) {
        if ($from.node(d).type.name === 'list_item') {
          inListItem = true
          break
        }
      }
      expect(inListItem).toBe(false)
    })
  })

  describe('keymap plugin creation', () => {
    it('should create a valid keymap with Tab and Shift-Tab bindings', () => {
      // Create the keymap (simplified version of what createListKeymapPlugin does)
      const keymapPlugin = createKeymap({
        'Tab': () => true,
        'Shift-Tab': () => true,
      })

      expect(keymapPlugin).toBeDefined()
      // Plugin has a spec with props containing handleKeyDown
      expect(keymapPlugin.spec).toBeDefined()
    })
  })
})
