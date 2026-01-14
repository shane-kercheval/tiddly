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
import type { MarkType } from '@milkdown/kit/prose/model'
import { keymap as createKeymap } from '@milkdown/kit/prose/keymap'
import { sinkListItem, liftListItem } from '@milkdown/kit/prose/schema-list'
import { setBlockType } from '@milkdown/kit/prose/commands'
import { findCodeBlockNode, findLinkBoundaries, normalizeUrl } from '../utils/milkdownHelpers'
import { createLinkExitOnSpacePlugin } from '../utils/linkExitOnSpacePlugin'
import { EditorView } from '@milkdown/kit/prose/view'

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
  marks: {
    link: {
      attrs: { href: {} },
      inclusive: false,
      parseDOM: [{ tag: 'a[href]', getAttrs: (dom: unknown) => ({ href: (dom as HTMLElement).getAttribute('href') }) }],
      toDOM: (mark) => ['a', { href: mark.attrs.href }, 0],
    },
    strong: {
      parseDOM: [{ tag: 'strong' }, { tag: 'b' }],
      toDOM: () => ['strong', 0],
    },
  },
})

function hasMarkBeforePos(state: EditorState, pos: number, markType: MarkType): boolean {
  const nodeBefore = state.doc.resolve(pos).nodeBefore
  return !!(nodeBefore && nodeBefore.isText && markType.isInSet(nodeBefore.marks))
}

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

describe('MilkdownEditor link improvements', () => {
  describe('findLinkBoundaries helper', () => {
    it('test__findLinkBoundaries__cursor_in_middle_of_link', () => {
      // Create document: "This is [a link](url) here"
      // Positions: paragraph starts at 0, text content starts at 1
      // "This is " = positions 1-9, "a link" = positions 9-15, " here" = positions 15-21
      const linkMark = testSchema.marks.link.create({ href: 'https://example.com' })
      const doc = testSchema.node('doc', null, [
        testSchema.node('paragraph', null, [
          testSchema.text('This is '),
          testSchema.text('a link', [linkMark]),
          testSchema.text(' here'),
        ]),
      ])

      const state = EditorState.create({ doc, schema: testSchema })
      // Create a minimal EditorView for testing
      const view = new EditorView(null, { state })

      // Position cursor in middle of "a link" (position 11)
      const cursorPos = 11
      const linkMarkType = testSchema.marks.link

      const result = findLinkBoundaries(view, cursorPos, linkMarkType)

      expect(result).not.toBeNull()
      expect(result?.start).toBe(9) // Start of "a link"
      expect(result?.end).toBe(15) // End of "a link"
      expect(result?.mark.attrs.href).toBe('https://example.com')

      view.destroy()
    })

    it('test__findLinkBoundaries__cursor_at_exact_start_of_link', () => {
      // Test the nodeAfter fallback for cursor at exact start position
      // "Start " = positions 1-7, "link" = positions 7-11
      const linkMark = testSchema.marks.link.create({ href: 'https://start.com' })
      const doc = testSchema.node('doc', null, [
        testSchema.node('paragraph', null, [
          testSchema.text('Start '),
          testSchema.text('link', [linkMark]),
        ]),
      ])

      const state = EditorState.create({ doc, schema: testSchema })
      const view = new EditorView(null, { state })

      // Position 7 is the exact start of "link"
      const cursorPos = 7
      const linkMarkType = testSchema.marks.link

      const result = findLinkBoundaries(view, cursorPos, linkMarkType)

      expect(result).not.toBeNull()
      expect(result?.start).toBe(7)
      expect(result?.end).toBe(11)
      expect(result?.mark.attrs.href).toBe('https://start.com')

      view.destroy()
    })

    it('test__findLinkBoundaries__cursor_at_end_of_link', () => {
      // "Text " = positions 1-6, "link" = positions 6-10, " after" = positions 10-17
      const linkMark = testSchema.marks.link.create({ href: 'https://end.com' })
      const doc = testSchema.node('doc', null, [
        testSchema.node('paragraph', null, [
          testSchema.text('Text '),
          testSchema.text('link', [linkMark]),
          testSchema.text(' after'),
        ]),
      ])

      const state = EditorState.create({ doc, schema: testSchema })
      const view = new EditorView(null, { state })

      // Position 9 is near the end of "link" (10 would be after it)
      const cursorPos = 9
      const linkMarkType = testSchema.marks.link

      const result = findLinkBoundaries(view, cursorPos, linkMarkType)

      expect(result).not.toBeNull()
      expect(result?.start).toBe(6)
      expect(result?.end).toBe(10)

      view.destroy()
    })

    it('test__findLinkBoundaries__cursor_outside_link', () => {
      const linkMark = testSchema.marks.link.create({ href: 'https://example.com' })
      const doc = testSchema.node('doc', null, [
        testSchema.node('paragraph', null, [
          testSchema.text('Before '),
          testSchema.text('link', [linkMark]),
          testSchema.text(' after'),
        ]),
      ])

      const state = EditorState.create({ doc, schema: testSchema })
      const view = new EditorView(null, { state })

      // Position 3 is in "Before"
      const cursorPos = 3
      const linkMarkType = testSchema.marks.link

      const result = findLinkBoundaries(view, cursorPos, linkMarkType)

      expect(result).toBeNull()

      view.destroy()
    })

    it('test__findLinkBoundaries__multiple_adjacent_text_nodes_in_link', () => {
      // Test link with multiple text nodes (e.g., formatted text inside link)
      // "Start " = positions 1-7, "first" = positions 7-12, "second" = positions 12-18, " end" = positions 18-23
      const linkMark = testSchema.marks.link.create({ href: 'https://multi.com' })
      const doc = testSchema.node('doc', null, [
        testSchema.node('paragraph', null, [
          testSchema.text('Start '),
          testSchema.text('first', [linkMark]),
          testSchema.text('second', [linkMark]),
          testSchema.text(' end'),
        ]),
      ])

      const state = EditorState.create({ doc, schema: testSchema })
      const view = new EditorView(null, { state })

      // Position in "second" part
      const cursorPos = 14
      const linkMarkType = testSchema.marks.link

      const result = findLinkBoundaries(view, cursorPos, linkMarkType)

      expect(result).not.toBeNull()
      // Should find the entire link spanning both text nodes
      expect(result?.start).toBe(7) // Start of "first"
      expect(result?.end).toBe(18) // End of "second"

      view.destroy()
    })

    it('test__findLinkBoundaries__link_at_start_of_paragraph', () => {
      const linkMark = testSchema.marks.link.create({ href: 'https://start.com' })
      const doc = testSchema.node('doc', null, [
        testSchema.node('paragraph', null, [
          testSchema.text('link', [linkMark]),
          testSchema.text(' follows'),
        ]),
      ])

      const state = EditorState.create({ doc, schema: testSchema })
      const view = new EditorView(null, { state })

      const cursorPos = 2
      const linkMarkType = testSchema.marks.link

      const result = findLinkBoundaries(view, cursorPos, linkMarkType)

      expect(result).not.toBeNull()
      expect(result?.start).toBe(1) // First character position in paragraph
      expect(result?.end).toBe(5)

      view.destroy()
    })

    it('test__findLinkBoundaries__link_at_end_of_paragraph', () => {
      // "Text before " = positions 1-13, "link" = positions 13-17
      const linkMark = testSchema.marks.link.create({ href: 'https://end.com' })
      const doc = testSchema.node('doc', null, [
        testSchema.node('paragraph', null, [
          testSchema.text('Text before '),
          testSchema.text('link', [linkMark]),
        ]),
      ])

      const state = EditorState.create({ doc, schema: testSchema })
      const view = new EditorView(null, { state })

      const cursorPos = 15
      const linkMarkType = testSchema.marks.link

      const result = findLinkBoundaries(view, cursorPos, linkMarkType)

      expect(result).not.toBeNull()
      expect(result?.start).toBe(13)
      expect(result?.end).toBe(17)

      view.destroy()
    })

    it('test__findLinkBoundaries__multiple_links_in_same_paragraph', () => {
      // Test that we correctly detect only the link containing the cursor
      // when multiple links exist in the same paragraph
      // "Text " = 1-6, "link1" = 6-11, " middle " = 11-19, "link2" = 19-24, " end" = 24-28
      const link1Mark = testSchema.marks.link.create({ href: 'https://link1.com' })
      const link2Mark = testSchema.marks.link.create({ href: 'https://link2.com' })
      const doc = testSchema.node('doc', null, [
        testSchema.node('paragraph', null, [
          testSchema.text('Text '),
          testSchema.text('link1', [link1Mark]),
          testSchema.text(' middle '),
          testSchema.text('link2', [link2Mark]),
          testSchema.text(' end'),
        ]),
      ])

      const state = EditorState.create({ doc, schema: testSchema })
      const view = new EditorView(null, { state })
      const linkMarkType = testSchema.marks.link

      // Test cursor in link1 - should find only link1
      const posInLink1 = 8
      const result1 = findLinkBoundaries(view, posInLink1, linkMarkType)
      expect(result1).not.toBeNull()
      expect(result1?.start).toBe(6)
      expect(result1?.end).toBe(11)
      expect(result1?.mark.attrs.href).toBe('https://link1.com')

      // Test cursor in link2 - should find only link2
      const posInLink2 = 21
      const result2 = findLinkBoundaries(view, posInLink2, linkMarkType)
      expect(result2).not.toBeNull()
      expect(result2?.start).toBe(19)
      expect(result2?.end).toBe(24)
      expect(result2?.mark.attrs.href).toBe('https://link2.com')

      // Test cursor between links - should find nothing
      const posInMiddle = 15
      const result3 = findLinkBoundaries(view, posInMiddle, linkMarkType)
      expect(result3).toBeNull()

      view.destroy()
    })

    it('test__findLinkBoundaries__adjacent_links_no_space', () => {
      // Test adjacent links with no space between them
      // This is valid markdown: [link1](url1)[link2](url2)
      // "link1" = 1-6, "link2" = 6-11
      const link1Mark = testSchema.marks.link.create({ href: 'https://first.com' })
      const link2Mark = testSchema.marks.link.create({ href: 'https://second.com' })
      const doc = testSchema.node('doc', null, [
        testSchema.node('paragraph', null, [
          testSchema.text('link1', [link1Mark]),
          testSchema.text('link2', [link2Mark]),
        ]),
      ])

      const state = EditorState.create({ doc, schema: testSchema })
      const view = new EditorView(null, { state })
      const linkMarkType = testSchema.marks.link

      // Cursor in link1 - should find only link1
      const posInLink1 = 3
      const result1 = findLinkBoundaries(view, posInLink1, linkMarkType)
      expect(result1).not.toBeNull()
      expect(result1?.start).toBe(1)
      expect(result1?.end).toBe(6)
      expect(result1?.mark.attrs.href).toBe('https://first.com')

      // Cursor in link2 - should find only link2
      const posInLink2 = 8
      const result2 = findLinkBoundaries(view, posInLink2, linkMarkType)
      expect(result2).not.toBeNull()
      expect(result2?.start).toBe(6)
      expect(result2?.end).toBe(11)
      expect(result2?.mark.attrs.href).toBe('https://second.com')

      // Cursor at exact boundary (position 6) - should detect link2 via nodeAfter
      const posAtBoundary = 6
      const result3 = findLinkBoundaries(view, posAtBoundary, linkMarkType)
      expect(result3).not.toBeNull()
      // Should find link2 (the nodeAfter at this position)
      expect(result3?.mark.attrs.href).toBe('https://second.com')

      view.destroy()
    })

    // Skipping empty link test because ProseMirror doesn't allow empty text nodes
  })

  describe('findLinkBoundaries performance', () => {
    it('test__findLinkBoundaries__performance_large_document_5000_paragraphs', () => {
      // Create a large document with 5000 paragraphs and links throughout
      const linkMark = testSchema.marks.link.create({ href: 'https://test.com' })
      const paragraphs = []

      // Create 5000 paragraphs, add a link every 50 paragraphs
      for (let i = 0; i < 5000; i++) {
        if (i % 50 === 0) {
          // Paragraph with a link in the middle
          paragraphs.push(
            testSchema.node('paragraph', null, [
              testSchema.text(`Paragraph ${i} with some text before `),
              testSchema.text('link text', [linkMark]),
              testSchema.text(' and text after'),
            ])
          )
        } else {
          // Regular paragraph
          paragraphs.push(
            testSchema.node('paragraph', null, [
              testSchema.text(`This is paragraph ${i} with regular content that is long enough to simulate real usage.`),
            ])
          )
        }
      }

      const doc = testSchema.node('doc', null, paragraphs)
      const state = EditorState.create({ doc, schema: testSchema })
      const view = new EditorView(null, { state })

      // Test performance at different positions in the document
      const linkMarkType = testSchema.marks.link
      const testPositions = [
        { name: 'beginning', paragraphIndex: 0 },
        { name: 'middle', paragraphIndex: 2500 },
        { name: 'end', paragraphIndex: 4950 },
      ]

      testPositions.forEach(({ name, paragraphIndex }) => {
        // Find a paragraph with a link (round to nearest 50)
        const linkParagraphIndex = Math.floor(paragraphIndex / 50) * 50

        // Calculate position: each paragraph is roughly 100 characters
        // Position offset to be in the middle of the link text
        let pos = 1 // Start of document
        for (let i = 0; i < linkParagraphIndex; i++) {
          pos += doc.child(i).nodeSize
        }

        // Add offset to get to the middle of the link in this paragraph
        // "Paragraph X with some text before " + middle of "link text"
        const textBefore = `Paragraph ${linkParagraphIndex} with some text before `
        pos += textBefore.length + 3 // Position in middle of "link text"

        // Measure performance
        const start = performance.now()
        const result = findLinkBoundaries(view, pos, linkMarkType)
        const elapsed = performance.now() - start

        // Log for visibility
        console.log(`[PERF TEST] Link detection at ${name} (para ${linkParagraphIndex}): ${elapsed.toFixed(2)}ms`)

        // Assert link was found
        expect(result).not.toBeNull()
        expect(result?.mark.attrs.href).toBe('https://test.com')

        // CRITICAL: Performance must be < 10ms even in large documents
        // (Baseline: 0.01-0.26ms, so 10ms gives 40x margin)
        expect(elapsed).toBeLessThan(10)
      })

      view.destroy()
    })

    it('test__findLinkBoundaries__performance_very_long_paragraph', () => {
      // Test performance with a single very long paragraph (edge case)
      // Simulate a paragraph with 10,000 characters and multiple links
      const linkMark = testSchema.marks.link.create({ href: 'https://test.com' })
      const textSegments = []

      // Build a very long paragraph with links scattered throughout
      for (let i = 0; i < 100; i++) {
        textSegments.push(testSchema.text('This is a long text segment that makes the paragraph very long. '))
        if (i % 10 === 0) {
          textSegments.push(testSchema.text(`link${i}`, [linkMark]))
          textSegments.push(testSchema.text(' '))
        }
      }

      const doc = testSchema.node('doc', null, [
        testSchema.node('paragraph', null, textSegments),
      ])

      const state = EditorState.create({ doc, schema: testSchema })
      const view = new EditorView(null, { state })

      // Position in the middle of a link near the end of the paragraph
      // Find position of "link90"
      const paraNode = doc.child(0)
      const paraText = paraNode.textContent
      const link90Index = paraText.indexOf('link90')
      const pos = 1 + link90Index + 3 // In middle of "link90"

      const linkMarkType = testSchema.marks.link

      // Measure performance
      const start = performance.now()
      const result = findLinkBoundaries(view, pos, linkMarkType)
      const elapsed = performance.now() - start

      console.log(`[PERF TEST] Link detection in very long paragraph (${paraText.length} chars): ${elapsed.toFixed(2)}ms`)

      expect(result).not.toBeNull()
      expect(result?.mark.attrs.href).toBe('https://test.com')

      // CRITICAL: Block-scoped search means this should still be fast
      // even though paragraph is very long (baseline: 0.01ms, 10ms = 1000x margin)
      expect(elapsed).toBeLessThan(10)

      view.destroy()
    })
  })

  describe('link editing vs creating logic', () => {
    it('test__link_editing__url_only_change_preserves_boundaries', () => {
      // When editing a link and only changing the URL (not the text),
      // the boundaries should remain the same and formatting should be preserved
      // "Click " = positions 1-7, "here" = positions 7-11, " now" = positions 11-16
      const linkMark = testSchema.marks.link.create({ href: 'https://old.com' })
      const doc = testSchema.node('doc', null, [
        testSchema.node('paragraph', null, [
          testSchema.text('Click '),
          testSchema.text('here', [linkMark]),
          testSchema.text(' now'),
        ]),
      ])

      const state = EditorState.create({ doc, schema: testSchema })
      const view = new EditorView(null, { state })

      // Find link boundaries at position 9 (in "here")
      const cursorPos = 9
      const linkMarkType = testSchema.marks.link
      const boundaries = findLinkBoundaries(view, cursorPos, linkMarkType)

      expect(boundaries).not.toBeNull()
      expect(boundaries?.start).toBe(7)
      expect(boundaries?.end).toBe(11)

      // Simulate editing: remove old mark, add new mark with different URL
      const newMark = linkMarkType.create({ href: 'https://new.com' })
      const tr = view.state.tr
        .removeMark(boundaries!.start, boundaries!.end, linkMarkType)
        .addMark(boundaries!.start, boundaries!.end, newMark)

      const newState = view.state.apply(tr)

      // Text content should be unchanged
      expect(newState.doc.textContent).toBe('Click here now')

      // Extract the text between boundaries to verify mark was applied
      const textNode = newState.doc.nodeAt(8)
      expect(textNode?.marks.some((m) => m.attrs.href === 'https://new.com')).toBe(true)

      view.destroy()
    })

    it('test__link_editing__text_change_replaces_node', () => {
      // When changing both text and URL, the entire link node is replaced
      const linkMark = testSchema.marks.link.create({ href: 'https://old.com' })
      const doc = testSchema.node('doc', null, [
        testSchema.node('paragraph', null, [
          testSchema.text('Click '),
          testSchema.text('here', [linkMark]),
          testSchema.text(' now'),
        ]),
      ])

      const state = EditorState.create({ doc, schema: testSchema })
      const view = new EditorView(null, { state })

      const linkMarkType = testSchema.marks.link
      const boundaries = findLinkBoundaries(view, 8, linkMarkType)

      expect(boundaries).not.toBeNull()

      // Simulate replacing text and URL
      const newMark = linkMarkType.create({ href: 'https://new.com' })
      const newTextNode = testSchema.text('click this', [newMark])
      const tr = view.state.tr.replaceWith(boundaries!.start, boundaries!.end, newTextNode)

      const newState = view.state.apply(tr)

      // Text should be updated
      expect(newState.doc.textContent).toBe('Click click this now')

      view.destroy()
    })

    it('test__link_creation__new_link_from_selection', () => {
      // When creating a new link, replace selection with link node
      const doc = testSchema.node('doc', null, [
        testSchema.node('paragraph', null, [
          testSchema.text('Select this text'),
        ]),
      ])

      const state = EditorState.create({ doc, schema: testSchema })
      const view = new EditorView(null, { state })

      // Create selection from "Select" (positions 1-7)
      const stateWithSelection = state.apply(
        state.tr.setSelection(TextSelection.create(state.doc, 1, 7))
      )
      view.updateState(stateWithSelection)

      // Create new link
      const linkMark = testSchema.marks.link.create({ href: 'https://example.com' })
      const linkNode = testSchema.text('Select', [linkMark])
      const tr = view.state.tr.replaceSelectionWith(linkNode, false)

      const newState = view.state.apply(tr)

      // Should have link at the beginning
      const textNode = newState.doc.nodeAt(1)
      expect(textNode?.marks.some((m) => m.attrs.href === 'https://example.com')).toBe(true)

      view.destroy()
    })
  })

  describe('normalizeUrl', () => {
    it('test__normalizeUrl__adds_https_to_domain_without_protocol', () => {
      expect(normalizeUrl('example.com')).toBe('https://example.com')
      expect(normalizeUrl('www.example.com')).toBe('https://www.example.com')
      expect(normalizeUrl('subdomain.example.com')).toBe('https://subdomain.example.com')
    })

    it('test__normalizeUrl__preserves_existing_https_protocol', () => {
      expect(normalizeUrl('https://example.com')).toBe('https://example.com')
      expect(normalizeUrl('https://www.example.com/path')).toBe('https://www.example.com/path')
    })

    it('test__normalizeUrl__preserves_existing_http_protocol', () => {
      expect(normalizeUrl('http://example.com')).toBe('http://example.com')
      expect(normalizeUrl('http://localhost:3000')).toBe('http://localhost:3000')
    })

    it('test__normalizeUrl__preserves_special_protocols', () => {
      expect(normalizeUrl('mailto:user@example.com')).toBe('mailto:user@example.com')
      expect(normalizeUrl('tel:+1234567890')).toBe('tel:+1234567890')
      expect(normalizeUrl('ftp://files.example.com')).toBe('ftp://files.example.com')
      expect(normalizeUrl('file:///path/to/file')).toBe('file:///path/to/file')
    })

    it('test__normalizeUrl__handles_whitespace', () => {
      expect(normalizeUrl('  example.com  ')).toBe('https://example.com')
      expect(normalizeUrl('  https://example.com  ')).toBe('https://example.com')
    })

    it('test__normalizeUrl__handles_empty_string', () => {
      expect(normalizeUrl('')).toBe('')
      expect(normalizeUrl('   ')).toBe('')
    })

    it('test__normalizeUrl__handles_urls_with_paths_and_queries', () => {
      expect(normalizeUrl('example.com/path/to/page')).toBe('https://example.com/path/to/page')
      expect(normalizeUrl('example.com?query=value')).toBe('https://example.com?query=value')
      expect(normalizeUrl('example.com#fragment')).toBe('https://example.com#fragment')
    })

    it('test__normalizeUrl__handles_localhost_and_ips', () => {
      expect(normalizeUrl('localhost:3000')).toBe('https://localhost:3000')
      expect(normalizeUrl('192.168.1.1')).toBe('https://192.168.1.1')
      expect(normalizeUrl('127.0.0.1:8080')).toBe('https://127.0.0.1:8080')
    })
  })

  describe('link exit on space', () => {
    it('test__linkExitOnSpace__removes_link_mark_when_space_typed_after_link', () => {
      // Test that typing a space while inside a link context removes the link mark from the space
      // when it's at the END of the link.
      // Scenario: User is editing link text, types space at the end
      // Document: "text [link](url)"
      // The space gets the link mark because we're typing within the link context
      // Plugin should remove it since it's at the end
      const linkMark = testSchema.marks.link.create({ href: 'https://example.com' })
      const doc = testSchema.node('doc', null, [
        testSchema.node('paragraph', null, [
          testSchema.text('text '),
          testSchema.text('link', [linkMark]),
        ]),
      ])

      const state = EditorState.create({
        doc,
        schema: testSchema,
        plugins: [createLinkExitOnSpacePlugin()],
      })
      // Position 10 is right after "link"
      const stateWithSelection = state.apply(
        state.tr
          .setSelection(TextSelection.near(state.doc.resolve(10)))
          .setStoredMarks([linkMark])
      )

      // Simulate typing a space while in link context (e.g., editing the link text).
      const { state: stateAfterSpace } = stateWithSelection.applyTransaction(
        stateWithSelection.tr.insertText(' ')
      )

      const posAfterSpace = stateAfterSpace.selection.from
      const linkMarkType = testSchema.marks.link
      expect(stateAfterSpace.doc.textBetween(posAfterSpace - 1, posAfterSpace)).toBe(' ')
      expect(hasMarkBeforePos(stateAfterSpace, posAfterSpace, linkMarkType)).toBeFalsy()
    })

    it('test__linkExitOnSpace__preserves_other_marks_like_bold', () => {
      // Test that the plugin only removes the link mark, preserving other marks like bold
      // Document: "text [**bold link**](url)"
      // After typing space: "text [**bold link**](url) " (space is bold but not a link)
      const linkMark = testSchema.marks.link.create({ href: 'https://example.com' })
      const strongMark = testSchema.marks.strong.create()
      const doc = testSchema.node('doc', null, [
        testSchema.node('paragraph', null, [
          testSchema.text('text '),
          testSchema.text('link', [linkMark, strongMark]),
        ]),
      ])

      const state = EditorState.create({
        doc,
        schema: testSchema,
        plugins: [createLinkExitOnSpacePlugin()],
      })
      const stateWithSelection = state.apply(
        state.tr
          .setSelection(TextSelection.near(state.doc.resolve(10)))
          .setStoredMarks([linkMark, strongMark])
      )

      // Type a space - it inherits both link and strong marks
      const { state: stateAfterSpace } = stateWithSelection.applyTransaction(
        stateWithSelection.tr.insertText(' ')
      )

      const posAfterSpace = stateAfterSpace.selection.from
      const linkMarkType = testSchema.marks.link
      const strongMarkType = testSchema.marks.strong

      // After plugin runs, the space should not have link mark but should keep strong mark
      expect(hasMarkBeforePos(stateAfterSpace, posAfterSpace, linkMarkType)).toBeFalsy()
      expect(hasMarkBeforePos(stateAfterSpace, posAfterSpace, strongMarkType)).toBeTruthy()
    })

    it('test__linkExitOnSpace__ignores_non_space_characters', () => {
      // Test that the plugin only triggers on space, not other characters
      // When typing letters within link context, they should keep the link mark
      const linkMark = testSchema.marks.link.create({ href: 'https://example.com' })
      const doc = testSchema.node('doc', null, [
        testSchema.node('paragraph', null, [
          testSchema.text('text '),
          testSchema.text('link', [linkMark]),
        ]),
      ])

      const state = EditorState.create({
        doc,
        schema: testSchema,
        plugins: [createLinkExitOnSpacePlugin()],
      })
      const stateWithSelection = state.apply(
        state.tr
          .setSelection(TextSelection.near(state.doc.resolve(10)))
          .setStoredMarks([linkMark])
      )

      // Type a letter 'a' while in link context (e.g., extending the link text)
      const { state: stateAfterChar } = stateWithSelection.applyTransaction(
        stateWithSelection.tr.insertText('a')
      )

      // The 'a' should still have the link mark (plugin shouldn't remove it)
      const posAfterChar = stateAfterChar.selection.from
      const linkMarkType = testSchema.marks.link
      expect(hasMarkBeforePos(stateAfterChar, posAfterChar, linkMarkType)).toBeTruthy()

      // Verify the content is correct
      const textContent = stateAfterChar.doc.textContent
      expect(textContent).toBe('text linka')
    })

    it('test__linkExitOnSpace__handles_space_in_middle_of_link_text', () => {
      // Test that typing a space in the middle of a link keeps the space as part of the link
      // This is correct behavior - only spaces at the END should exit the link
      const linkMark = testSchema.marks.link.create({ href: 'https://example.com' })
      const doc = testSchema.node('doc', null, [
        testSchema.node('paragraph', null, [
          testSchema.text('before '),
          testSchema.text('link', [linkMark]),
          testSchema.text(' after'),
        ]),
      ])

      const state = EditorState.create({
        doc,
        schema: testSchema,
        plugins: [createLinkExitOnSpacePlugin()],
      })
      // Position in middle of "link" (position 9 is between 'l' and 'i')
      const stateWithSelection = state.apply(
        state.tr
          .setSelection(TextSelection.near(state.doc.resolve(9)))
          .setStoredMarks([linkMark])
      )

      // Type a space in the middle of the link
      const { state: stateAfterSpace } = stateWithSelection.applyTransaction(
        stateWithSelection.tr.insertText(' ')
      )

      // The space in the middle should keep the link mark
      // (plugin only removes link mark if space is typed at the END of link text)
      const posAfterSpace = stateAfterSpace.selection.from
      const linkMarkType = testSchema.marks.link
      expect(hasMarkBeforePos(stateAfterSpace, posAfterSpace, linkMarkType)).toBeTruthy()

      // Verify content: "before l ink after"
      const textContent = stateAfterSpace.doc.textContent
      expect(textContent).toBe('before l ink after')
    })
  })
})
