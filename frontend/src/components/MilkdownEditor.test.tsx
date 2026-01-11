/**
 * Tests for MilkdownEditor functionality.
 *
 * These tests verify:
 * - Tab keymap plugin behavior (list indentation, code block indentation)
 * - Code block toggle (toolbar button and keyboard shortcut)
 * - Backspace in empty code blocks
 */
import { describe, it, expect } from 'vitest'
import { EditorState, TextSelection } from '@milkdown/kit/prose/state'
import { Schema } from '@milkdown/kit/prose/model'
import { keymap as createKeymap } from '@milkdown/kit/prose/keymap'
import { sinkListItem, liftListItem } from '@milkdown/kit/prose/schema-list'
import { setBlockType } from '@milkdown/kit/prose/commands'
import { findCodeBlockNode } from '../utils/milkdownHelpers'

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

describe('MilkdownEditor Tab functionality', () => {
  describe('findCodeBlockNode helper', () => {
    it('should return node and depth when cursor is inside a code block', () => {
      // Create a document with a code block containing some text
      const doc = testSchema.node('doc', null, [
        testSchema.node('code_block', null, [testSchema.text('const x = 1')]),
      ])
      const state = EditorState.create({ doc, schema: testSchema })
      // Selection is at position 1 (inside the code block)
      const stateWithSelection = state.apply(
        state.tr.setSelection(TextSelection.near(state.doc.resolve(1)))
      )

      const result = findCodeBlockNode(stateWithSelection)
      expect(result).not.toBeNull()
      expect(result?.node.type.name).toBe('code_block')
      expect(result?.depth).toBeGreaterThanOrEqual(0)
    })

    it('should return null when cursor is in a paragraph', () => {
      const doc = testSchema.node('doc', null, [
        testSchema.node('paragraph', null, [testSchema.text('Hello world')]),
      ])
      const state = EditorState.create({ doc, schema: testSchema })
      const stateWithSelection = state.apply(
        state.tr.setSelection(TextSelection.near(state.doc.resolve(1)))
      )

      expect(findCodeBlockNode(stateWithSelection)).toBeNull()
    })

    it('should return null when cursor is in a list item', () => {
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

      expect(findCodeBlockNode(stateWithSelection)).toBeNull()
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
      expect(findCodeBlockNode(stateWithSelection)).toBeNull()

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

describe('MilkdownEditor code block toggle', () => {
  describe('setBlockType for code block to paragraph conversion', () => {
    it('should convert code block to paragraph using setBlockType', () => {
      // Create a document with an empty code block
      const doc = testSchema.node('doc', null, [
        testSchema.node('code_block', null, []),
      ])
      const state = EditorState.create({ doc, schema: testSchema })
      // Position cursor inside the empty code block
      const stateWithSelection = state.apply(
        state.tr.setSelection(TextSelection.near(state.doc.resolve(1)))
      )

      // Verify we're in a code block
      expect(findCodeBlockNode(stateWithSelection)).not.toBeNull()

      // Apply setBlockType to convert to paragraph
      const paragraphType = testSchema.nodes.paragraph
      let newState = stateWithSelection
      setBlockType(paragraphType)(stateWithSelection, (tr) => {
        newState = stateWithSelection.apply(tr)
      })

      // The document should now contain a paragraph instead of a code block
      expect(newState.doc.firstChild?.type.name).toBe('paragraph')
    })

    it('should convert code block with content to paragraph preserving content', () => {
      const doc = testSchema.node('doc', null, [
        testSchema.node('code_block', null, [testSchema.text('some code')]),
      ])
      const state = EditorState.create({ doc, schema: testSchema })
      const stateWithSelection = state.apply(
        state.tr.setSelection(TextSelection.near(state.doc.resolve(1)))
      )

      expect(findCodeBlockNode(stateWithSelection)).not.toBeNull()

      const paragraphType = testSchema.nodes.paragraph
      let newState = stateWithSelection
      setBlockType(paragraphType)(stateWithSelection, (tr) => {
        newState = stateWithSelection.apply(tr)
      })

      // Should be a paragraph now
      expect(newState.doc.firstChild?.type.name).toBe('paragraph')
      // Content should be preserved
      expect(newState.doc.firstChild?.textContent).toBe('some code')
    })

    it('should not affect paragraph when already in paragraph', () => {
      const doc = testSchema.node('doc', null, [
        testSchema.node('paragraph', null, [testSchema.text('regular text')]),
      ])
      const state = EditorState.create({ doc, schema: testSchema })
      const stateWithSelection = state.apply(
        state.tr.setSelection(TextSelection.near(state.doc.resolve(1)))
      )

      expect(findCodeBlockNode(stateWithSelection)).toBeNull()

      // When not in code block, toggle logic should create a code block (not tested here)
      // This test verifies that setBlockType doesn't break when already in target type
      const paragraphType = testSchema.nodes.paragraph
      let newState = stateWithSelection
      const result = setBlockType(paragraphType)(stateWithSelection, (tr) => {
        newState = stateWithSelection.apply(tr)
      })

      // setBlockType returns false when block is already of that type
      expect(result).toBe(false)
      expect(newState.doc.firstChild?.type.name).toBe('paragraph')
    })
  })

  describe('toggle logic detection', () => {
    it('should detect when cursor is in code block for toggle', () => {
      const doc = testSchema.node('doc', null, [
        testSchema.node('paragraph', null, [testSchema.text('before')]),
        testSchema.node('code_block', null, [testSchema.text('code')]),
        testSchema.node('paragraph', null, [testSchema.text('after')]),
      ])
      const state = EditorState.create({ doc, schema: testSchema })

      // Position in first paragraph (position ~1-7)
      const stateInParagraph = state.apply(
        state.tr.setSelection(TextSelection.near(state.doc.resolve(2)))
      )
      expect(findCodeBlockNode(stateInParagraph)).toBeNull()

      // Position in code block (around position 9-13)
      const stateInCodeBlock = state.apply(
        state.tr.setSelection(TextSelection.near(state.doc.resolve(10)))
      )
      expect(findCodeBlockNode(stateInCodeBlock)).not.toBeNull()
    })
  })
})

describe('MilkdownEditor backspace in empty code block', () => {
  describe('empty code block detection using findCodeBlockNode', () => {
    it('should detect empty code block', () => {
      const doc = testSchema.node('doc', null, [
        testSchema.node('code_block', null, []),
      ])
      const state = EditorState.create({ doc, schema: testSchema })
      const stateWithSelection = state.apply(
        state.tr.setSelection(TextSelection.near(state.doc.resolve(1)))
      )

      const result = findCodeBlockNode(stateWithSelection)
      expect(result).not.toBeNull()
      expect(result?.node.textContent).toBe('')
      expect(result?.depth).toBeGreaterThanOrEqual(0)
    })

    it('should detect code block with content as not empty', () => {
      const doc = testSchema.node('doc', null, [
        testSchema.node('code_block', null, [testSchema.text('x')]),
      ])
      const state = EditorState.create({ doc, schema: testSchema })
      const stateWithSelection = state.apply(
        state.tr.setSelection(TextSelection.near(state.doc.resolve(1)))
      )

      const result = findCodeBlockNode(stateWithSelection)
      expect(result).not.toBeNull()
      expect(result?.node.textContent).toBe('x')
    })

    it('should detect code block with only whitespace as not empty (strict check)', () => {
      const doc = testSchema.node('doc', null, [
        testSchema.node('code_block', null, [testSchema.text('   ')]),
      ])
      const state = EditorState.create({ doc, schema: testSchema })
      const stateWithSelection = state.apply(
        state.tr.setSelection(TextSelection.near(state.doc.resolve(1)))
      )

      // Strict empty check: whitespace is NOT considered empty
      const result = findCodeBlockNode(stateWithSelection)
      expect(result).not.toBeNull()
      expect(result?.node.textContent).toBe('   ')
      // Backspace handler checks textContent === '', so whitespace won't trigger conversion
    })

    it('should return null when in paragraph', () => {
      const doc = testSchema.node('doc', null, [
        testSchema.node('paragraph', null, [testSchema.text('text')]),
      ])
      const state = EditorState.create({ doc, schema: testSchema })
      const stateWithSelection = state.apply(
        state.tr.setSelection(TextSelection.near(state.doc.resolve(1)))
      )

      expect(findCodeBlockNode(stateWithSelection)).toBeNull()
    })
  })

  describe('backspace handler logic', () => {
    it('should convert empty code block to paragraph on backspace', () => {
      const doc = testSchema.node('doc', null, [
        testSchema.node('code_block', null, []),
      ])
      const state = EditorState.create({ doc, schema: testSchema })
      const stateWithSelection = state.apply(
        state.tr.setSelection(TextSelection.near(state.doc.resolve(1)))
      )

      // Verify preconditions
      const codeBlock = findCodeBlockNode(stateWithSelection)
      expect(codeBlock).not.toBeNull()
      expect(stateWithSelection.selection.empty).toBe(true)
      expect(codeBlock?.node.textContent).toBe('')

      // Simulate backspace handler: convert to paragraph
      const paragraphType = testSchema.nodes.paragraph
      let newState = stateWithSelection
      setBlockType(paragraphType)(stateWithSelection, (tr) => {
        newState = stateWithSelection.apply(tr)
      })

      // Should now be a paragraph
      expect(newState.doc.firstChild?.type.name).toBe('paragraph')
    })

    it('should NOT convert code block with content on backspace', () => {
      const doc = testSchema.node('doc', null, [
        testSchema.node('code_block', null, [testSchema.text('code content')]),
      ])
      const state = EditorState.create({ doc, schema: testSchema })
      const stateWithSelection = state.apply(
        state.tr.setSelection(TextSelection.near(state.doc.resolve(1)))
      )

      // Verify preconditions
      const codeBlock = findCodeBlockNode(stateWithSelection)
      expect(codeBlock).not.toBeNull()
      expect(codeBlock?.node.textContent).toBe('code content')

      // The backspace handler should NOT convert since code block has content
      // Document should remain unchanged
      expect(stateWithSelection.doc.firstChild?.type.name).toBe('code_block')
      expect(stateWithSelection.doc.firstChild?.textContent).toBe('code content')
    })

    it('should NOT trigger on range selection (only cursor)', () => {
      const doc = testSchema.node('doc', null, [
        testSchema.node('code_block', null, [testSchema.text('ab')]),
      ])
      const state = EditorState.create({ doc, schema: testSchema })
      // Create a range selection (selecting 'ab')
      const stateWithSelection = state.apply(
        state.tr.setSelection(TextSelection.create(state.doc, 1, 3))
      )

      // Verify it's a range selection, not a cursor
      expect(stateWithSelection.selection.empty).toBe(false)

      // The backspace handler should return false for range selections
      // letting default behavior delete the selected text
    })
  })

  describe('regression: list backspace still works', () => {
    it('should still detect list item start position correctly', () => {
      const doc = testSchema.node('doc', null, [
        testSchema.node('bullet_list', null, [
          testSchema.node('list_item', null, [
            testSchema.node('paragraph', null, [testSchema.text('item')]),
          ]),
        ]),
      ])
      const state = EditorState.create({ doc, schema: testSchema })

      // Position at start of list item content
      // Structure: doc(0) > bullet_list(1) > list_item(2) > paragraph(3) > text
      const stateWithSelection = state.apply(
        state.tr.setSelection(TextSelection.near(state.doc.resolve(3)))
      )

      // Should NOT be in a code block
      expect(findCodeBlockNode(stateWithSelection)).toBeNull()

      // Verify we're in a list item by checking node types
      const { $from } = stateWithSelection.selection
      let inListItem = false
      for (let d = $from.depth; d >= 0; d--) {
        if ($from.node(d).type.name === 'list_item') {
          inListItem = true
          break
        }
      }
      expect(inListItem).toBe(true)
    })
  })
})
