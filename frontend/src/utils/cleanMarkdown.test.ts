/**
 * Tests for cleanMarkdown utility.
 *
 * Tests the markdown cleaning function used by Milkdown editor
 * to sanitize output and ensure clean markdown storage.
 */
import { describe, it, expect } from 'vitest'
import { cleanMarkdown } from './cleanMarkdown'

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

  describe('trimming', () => {
    it('should trim leading whitespace', () => {
      const input = '   Hello World'
      expect(cleanMarkdown(input)).toBe('Hello World')
    })

    it('should trim trailing whitespace', () => {
      const input = 'Hello World   '
      expect(cleanMarkdown(input)).toBe('Hello World')
    })

    it('should trim both leading and trailing whitespace', () => {
      const input = '   Hello World   '
      expect(cleanMarkdown(input)).toBe('Hello World')
    })

    it('should trim newlines at start and end', () => {
      const input = '\n\nHello World\n\n'
      expect(cleanMarkdown(input)).toBe('Hello World')
    })
  })

  describe('combined transformations', () => {
    it('should handle NBSP cleanup and trimming together', () => {
      const input = '  Hello\u00a0World&nbsp;Test  '
      expect(cleanMarkdown(input)).toBe('Hello World Test')
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

More content here.`
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
      expect(cleanMarkdown('   ')).toBe('')
    })

    it('should handle newlines-only string (trimmed to empty)', () => {
      expect(cleanMarkdown('\n\n\n')).toBe('')
    })

    it('should handle string with only non-breaking spaces', () => {
      expect(cleanMarkdown('\u00a0\u00a0\u00a0')).toBe('')
    })

    it('should not alter clean markdown', () => {
      const clean = `# Title

This is a paragraph.

- Item 1
- Item 2

**Bold** and *italic* text.`
      expect(cleanMarkdown(clean)).toBe(clean)
    })
  })
})
