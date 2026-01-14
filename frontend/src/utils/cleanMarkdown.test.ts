/**
 * Tests for cleanMarkdown utility.
 *
 * Tests the markdown cleaning function used by Milkdown editor
 * to sanitize output and ensure clean markdown storage.
 */
import { describe, it, expect } from 'vitest'
import { cleanMarkdown, cleanTextContent, cleanMdastTree } from './cleanMarkdown'

describe('cleanMarkdown', () => {
  describe('non-breaking spaces', () => {
    it('should convert unicode non-breaking spaces to regular spaces', () => {
      const input = 'Hello\u00a0World'
      expect(cleanMarkdown(input)).toBe('Hello World')
    })

    it('should convert multiple non-breaking spaces', () => {
      const input = 'One\u00a0Two\u00a0Three'
      expect(cleanMarkdown(input)).toBe('One Two Three')
    })

    it('should convert &nbsp; HTML entities to regular spaces', () => {
      const input = 'Hello&nbsp;World'
      expect(cleanMarkdown(input)).toBe('Hello World')
    })

    it('should handle &nbsp; case-insensitively', () => {
      const input = 'Hello&NBSP;World&Nbsp;Test'
      expect(cleanMarkdown(input)).toBe('Hello World Test')
    })

    it('should convert both unicode and HTML entity non-breaking spaces', () => {
      const input = 'One\u00a0Two&nbsp;Three'
      expect(cleanMarkdown(input)).toBe('One Two Three')
    })
  })

  describe('newlines', () => {
    // Note: Newline collapsing was intentionally removed.
    // List formatting (tight vs loose) is now handled by remarkTightLists plugin
    // in MilkdownEditor.tsx at the AST level, not by post-processing.

    it('should preserve single newlines', () => {
      const input = 'Line 1\nLine 2'
      expect(cleanMarkdown(input)).toBe('Line 1\nLine 2')
    })

    it('should preserve double newlines (standard paragraph break)', () => {
      const input = 'Paragraph 1\n\nParagraph 2'
      expect(cleanMarkdown(input)).toBe('Paragraph 1\n\nParagraph 2')
    })

    it('should preserve multiple newlines (no longer collapses)', () => {
      const input = 'Paragraph 1\n\n\nParagraph 2'
      expect(cleanMarkdown(input)).toBe('Paragraph 1\n\n\nParagraph 2')
    })
  })

  describe('whitespace preservation', () => {
    it('should preserve leading whitespace', () => {
      const input = '   Hello World'
      expect(cleanMarkdown(input)).toBe('   Hello World')
    })

    it('should preserve trailing whitespace', () => {
      const input = 'Hello World   '
      expect(cleanMarkdown(input)).toBe('Hello World   ')
    })

    it('should preserve leading and trailing whitespace', () => {
      const input = '   Hello World   '
      expect(cleanMarkdown(input)).toBe('   Hello World   ')
    })

    it('should preserve leading and trailing newlines', () => {
      const input = '\n\nHello World\n\n'
      expect(cleanMarkdown(input)).toBe('\n\nHello World\n\n')
    })
  })

  describe('combined transformations', () => {
    it('should handle NBSP cleanup without trimming', () => {
      const input = '  Hello\u00a0World&nbsp;Test  '
      expect(cleanMarkdown(input)).toBe('  Hello World Test  ')
    })

    it('should handle real markdown content with NBSP issues', () => {
      const input = `# Heading

Some text with\u00a0non-breaking&nbsp;spaces.

## Another Section

More content here.
`
      const expected = `# Heading

Some text with non-breaking spaces.

## Another Section

More content here.
`
      expect(cleanMarkdown(input)).toBe(expected)
    })
  })

  describe('hex-encoded spaces', () => {
    it('should convert &#x20; to regular spaces', () => {
      const input = '&#x20;Hello'
      expect(cleanMarkdown(input)).toBe(' Hello')
    })

    it('should handle multiple &#x20; entities', () => {
      const input = '&#x20;&#x20;&#x20;indented text'
      expect(cleanMarkdown(input)).toBe('   indented text')
    })

    it('should handle &#x20; in middle of content', () => {
      const input = 'line 1\n\n&#x20; indented line'
      expect(cleanMarkdown(input)).toBe('line 1\n\n  indented line')
    })
  })

  describe('angle bracket escaping', () => {
    it('should remove backslash before opening angle bracket', () => {
      const input = '\\<instructions>'
      expect(cleanMarkdown(input)).toBe('<instructions>')
    })

    it('should remove backslash before closing angle bracket', () => {
      const input = '\\>quoted text'
      expect(cleanMarkdown(input)).toBe('>quoted text')
    })

    it('should handle XML-style content with escaped brackets', () => {
      const input = '\\<instructions>\n\\<objective>\nContent\n</objective>\n</instructions>'
      expect(cleanMarkdown(input)).toBe('<instructions>\n<objective>\nContent\n</objective>\n</instructions>')
    })

    it('should handle escaped brackets in middle of text', () => {
      const input = 'Use \\<tag\\> for markup'
      expect(cleanMarkdown(input)).toBe('Use <tag> for markup')
    })

    it('should preserve unescaped angle brackets', () => {
      const input = '<already unescaped> content'
      expect(cleanMarkdown(input)).toBe('<already unescaped> content')
    })

    it('should handle real XML template from Slack paste', () => {
      // Input matches what remark-stringify produces when pasting XML from Slack
      const input = `\\<instructions>

&#x20; \\<objective>

&#x20;   Improve the following prompt

  </objective>

\\</instructions>`
      // Expected: &#x20; becomes space, \< becomes <
      // Line 1: \<instructions> → <instructions>
      // Line 3: &#x20; (1 space) + " " (1 space) + \<objective> → "  <objective>" (2 spaces)
      // Line 5: &#x20; (1 space) + "   " (3 spaces) + text → "    Improve..." (4 spaces)
      const expected = `<instructions>

  <objective>

    Improve the following prompt

  </objective>

</instructions>`
      expect(cleanMarkdown(input)).toBe(expected)
    })
  })

  describe('underscore escaping', () => {
    it('should remove backslash escapes before underscores', () => {
      const input = 'variable\\_name'
      expect(cleanMarkdown(input)).toBe('variable_name')
    })

    it('should handle multiple escaped underscores', () => {
      const input = 'my\\_variable\\_name\\_here'
      expect(cleanMarkdown(input)).toBe('my_variable_name_here')
    })

    it('should fix Jinja2 template variable names', () => {
      const input = '{{ the\\_text }}'
      expect(cleanMarkdown(input)).toBe('{{ the_text }}')
    })

    it('should fix Jinja2 if blocks with underscores', () => {
      const input = '{% if my\\_variable %}content{% endif %}'
      expect(cleanMarkdown(input)).toBe('{% if my_variable %}content{% endif %}')
    })

    it('should handle snake_case function names in code', () => {
      const input = 'Call `get\\_user\\_data()` to fetch data.'
      expect(cleanMarkdown(input)).toBe('Call `get_user_data()` to fetch data.')
    })

    it('should preserve regular underscores (no backslash)', () => {
      const input = 'snake_case_variable'
      expect(cleanMarkdown(input)).toBe('snake_case_variable')
    })

    it('should not affect emphasis using asterisks', () => {
      const input = '**bold** and *italic* with some\\_underscores'
      expect(cleanMarkdown(input)).toBe('**bold** and *italic* with some_underscores')
    })
  })

  describe('edge cases', () => {
    it('should handle empty string', () => {
      expect(cleanMarkdown('')).toBe('')
    })

    it('should handle whitespace-only string', () => {
      expect(cleanMarkdown('   ')).toBe('   ')
    })

    it('should handle newlines-only string', () => {
      expect(cleanMarkdown('\n\n\n')).toBe('\n\n\n')
    })

    it('should handle string with only non-breaking spaces', () => {
      expect(cleanMarkdown('\u00a0\u00a0\u00a0')).toBe('   ')
    })

    it('should not alter clean markdown without trailing newlines', () => {
      const clean = `# Title

This is a paragraph.

- Item 1
- Item 2

**Bold** and *italic* text.`
      expect(cleanMarkdown(clean)).toBe(clean)
    })

    it('should preserve trailing newlines in clean markdown', () => {
      const input = `# Title

This is a paragraph.

- Item 1
- Item 2

**Bold** and *italic* text.
`
      expect(cleanMarkdown(input)).toBe(input)
    })
  })
})

describe('cleanTextContent', () => {
  it('should clean text the same as cleanMarkdown', () => {
    const input = 'Hello\u00a0World with\\_underscores and \\<brackets\\>'
    expect(cleanTextContent(input)).toBe('Hello World with_underscores and <brackets>')
  })
})

describe('cleanMdastTree', () => {
  describe('text node cleaning', () => {
    it('should clean text nodes', () => {
      const tree = {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [
              { type: 'text', value: 'Hello\u00a0World with\\_underscores' }
            ]
          }
        ]
      }
      cleanMdastTree(tree)
      expect(tree.children[0].children[0].value).toBe('Hello World with_underscores')
    })

    it('should clean nested text nodes', () => {
      const tree = {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [
              { type: 'text', value: 'Normal text' },
              {
                type: 'strong',
                children: [
                  { type: 'text', value: 'Bold\\_text' }
                ]
              },
              { type: 'text', value: ' and \\<more\\>' }
            ]
          }
        ]
      }
      cleanMdastTree(tree)
      expect(tree.children[0].children[0].value).toBe('Normal text')
      expect(tree.children[0].children[1].children[0].value).toBe('Bold_text')
      expect(tree.children[0].children[2].value).toBe(' and <more>')
    })
  })

  describe('code block preservation', () => {
    it('should NOT clean fenced code block content', () => {
      const tree = {
        type: 'root',
        children: [
          {
            type: 'code',
            lang: 'bash',
            value: 'echo "\\_HOME\\_"'
          }
        ]
      }
      cleanMdastTree(tree)
      // Code block content should be preserved exactly
      expect(tree.children[0].value).toBe('echo "\\_HOME\\_"')
    })

    it('should NOT clean inline code content', () => {
      const tree = {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [
              { type: 'text', value: 'Use ' },
              { type: 'inlineCode', value: '\\_underscore\\_' },
              { type: 'text', value: ' in code' }
            ]
          }
        ]
      }
      cleanMdastTree(tree)
      // Inline code should be preserved
      expect(tree.children[0].children[1].value).toBe('\\_underscore\\_')
      // But surrounding text should be cleaned
      expect(tree.children[0].children[0].value).toBe('Use ')
      expect(tree.children[0].children[2].value).toBe(' in code')
    })

    it('should NOT clean HTML block content', () => {
      const tree = {
        type: 'root',
        children: [
          {
            type: 'html',
            value: '<div class="my\\_class">\\<content\\></div>'
          }
        ]
      }
      cleanMdastTree(tree)
      expect(tree.children[0].value).toBe('<div class="my\\_class">\\<content\\></div>')
    })
  })

  describe('mixed content', () => {
    it('should clean text but preserve code in mixed document', () => {
      const tree = {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [
              { type: 'text', value: 'Text with\\_underscore' }
            ]
          },
          {
            type: 'code',
            lang: 'python',
            value: 'my\\_var = "\\<value\\>"'
          },
          {
            type: 'paragraph',
            children: [
              { type: 'text', value: 'More text with \\<brackets\\>' }
            ]
          }
        ]
      }
      cleanMdastTree(tree)
      // Text paragraphs should be cleaned
      expect(tree.children[0].children[0].value).toBe('Text with_underscore')
      expect(tree.children[2].children[0].value).toBe('More text with <brackets>')
      // Code block should be preserved
      expect(tree.children[1].value).toBe('my\\_var = "\\<value\\>"')
    })

    it('should handle real-world LaTeX in code example', () => {
      const tree = {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [
              { type: 'text', value: 'Use ' },
              { type: 'inlineCode', value: '\\_' },
              { type: 'text', value: ' for escaping in LaTeX.' }
            ]
          }
        ]
      }
      cleanMdastTree(tree)
      // The inline code \_ should be preserved (LaTeX escape)
      expect(tree.children[0].children[1].value).toBe('\\_')
    })
  })

  describe('edge cases', () => {
    it('should handle empty tree', () => {
      const tree = { type: 'root', children: [] }
      cleanMdastTree(tree)
      expect(tree.children).toEqual([])
    })

    it('should handle null/undefined gracefully', () => {
      expect(() => cleanMdastTree(null)).not.toThrow()
      expect(() => cleanMdastTree(undefined)).not.toThrow()
    })

    it('should handle nodes without children', () => {
      const tree = { type: 'root' }
      expect(() => cleanMdastTree(tree)).not.toThrow()
    })

    it('should handle text node without value', () => {
      const tree = {
        type: 'root',
        children: [
          { type: 'text' } // No value property
        ]
      }
      expect(() => cleanMdastTree(tree)).not.toThrow()
    })
  })
})
