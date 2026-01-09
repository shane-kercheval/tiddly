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

  describe('excessive newlines', () => {
    it('should collapse three newlines to two', () => {
      const input = 'Paragraph 1\n\n\nParagraph 2'
      expect(cleanMarkdown(input)).toBe('Paragraph 1\n\nParagraph 2')
    })

    it('should collapse four or more newlines to two', () => {
      const input = 'Paragraph 1\n\n\n\n\nParagraph 2'
      expect(cleanMarkdown(input)).toBe('Paragraph 1\n\nParagraph 2')
    })

    it('should preserve single newlines', () => {
      const input = 'Line 1\nLine 2'
      expect(cleanMarkdown(input)).toBe('Line 1\nLine 2')
    })

    it('should preserve double newlines (standard paragraph break)', () => {
      const input = 'Paragraph 1\n\nParagraph 2'
      expect(cleanMarkdown(input)).toBe('Paragraph 1\n\nParagraph 2')
    })

    it('should handle multiple sections with excessive newlines', () => {
      const input = 'Section 1\n\n\nSection 2\n\n\n\nSection 3'
      expect(cleanMarkdown(input)).toBe('Section 1\n\nSection 2\n\nSection 3')
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
    it('should handle all transformations together', () => {
      const input = '  Hello\u00a0World&nbsp;Test\n\n\n\nMore content  '
      expect(cleanMarkdown(input)).toBe('Hello World Test\n\nMore content')
    })

    it('should handle real markdown content with various issues', () => {
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

  describe('edge cases', () => {
    it('should handle empty string', () => {
      expect(cleanMarkdown('')).toBe('')
    })

    it('should handle whitespace-only string', () => {
      expect(cleanMarkdown('   ')).toBe('')
    })

    it('should handle newlines-only string', () => {
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
