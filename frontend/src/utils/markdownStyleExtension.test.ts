/**
 * Tests for markdown style extension helper functions.
 */
import { describe, it, expect } from 'vitest'
import { _testExports } from './markdownStyleExtension'

const { findImages, findLinks, findInlineCode, findStrikethrough, findHighlight, findBold, findItalic, findBlockquoteSyntax, parseLine } = _testExports

describe('findImages', () => {
  it('should find a simple image', () => {
    const result = findImages('![alt text](https://example.com/image.png)')
    expect(result).toHaveLength(1)
    expect(result[0].from).toBe(0)
    expect(result[0].to).toBe(42)
  })

  it('should find multiple images', () => {
    const result = findImages('![img1](url1) text ![img2](url2)')
    expect(result).toHaveLength(2)
  })

  it('should find image with empty alt text', () => {
    const result = findImages('![](https://example.com/image.png)')
    expect(result).toHaveLength(1)
    expect(result[0].altStart).toBe(result[0].altEnd) // Empty alt
  })

  it('should not match regular links', () => {
    const result = findImages('[not an image](https://example.com)')
    expect(result).toHaveLength(0)
  })

  it('should return empty array for text without images', () => {
    const result = findImages('Just some regular text')
    expect(result).toHaveLength(0)
  })

  it('should correctly identify component positions', () => {
    const text = '![alt](url)'
    const result = findImages(text)
    expect(result).toHaveLength(1)
    const img = result[0]
    expect(img.exclamation).toBe(0)     // !
    expect(img.openBracket).toBe(1)     // [
    expect(img.altStart).toBe(2)        // a
    expect(img.altEnd).toBe(5)          // after "alt"
    expect(img.closeBracket).toBe(5)    // ]
    expect(img.openParen).toBe(6)       // (
    expect(img.urlStart).toBe(7)        // u
    expect(img.urlEnd).toBe(10)         // after "url"
    expect(img.closeParen).toBe(10)     // )
  })

  it('should handle image at end of line with other content', () => {
    const text = 'Some text before ![image](url)'
    const result = findImages(text)
    expect(result).toHaveLength(1)
    expect(result[0].from).toBe(17) // "Some text before " is 17 chars
  })
})

describe('findLinks', () => {
  it('should find a simple link', () => {
    const result = findLinks('[link text](https://example.com)')
    expect(result).toHaveLength(1)
    expect(result[0].from).toBe(0)
    expect(result[0].url).toBe('https://example.com')
  })

  it('should find multiple links', () => {
    const result = findLinks('[link1](url1) and [link2](url2)')
    expect(result).toHaveLength(2)
    expect(result[0].url).toBe('url1')
    expect(result[1].url).toBe('url2')
  })

  it('should return empty array for text without links', () => {
    const result = findLinks('Just some regular text')
    expect(result).toHaveLength(0)
  })

  it('should correctly identify component positions', () => {
    const text = '[text](url)'
    const result = findLinks(text)
    expect(result).toHaveLength(1)
    const link = result[0]
    expect(link.openBracket).toBe(0)    // [
    expect(link.textStart).toBe(1)      // t
    expect(link.textEnd).toBe(5)        // after "text"
    expect(link.closeBracket).toBe(5)   // ]
    expect(link.openParen).toBe(6)      // (
    expect(link.urlStart).toBe(7)       // u
    expect(link.urlEnd).toBe(10)        // after "url"
    expect(link.closeParen).toBe(10)    // )
  })

  it('should handle link with spaces in text', () => {
    const result = findLinks('[link with spaces](url)')
    expect(result).toHaveLength(1)
    expect(result[0].textEnd - result[0].textStart).toBe(16) // "link with spaces"
  })

  it('should also match image syntax (![...](...)) - filtered separately', () => {
    // Note: findLinks matches both links and the link portion of images
    // The buildDecorations function filters these out
    const result = findLinks('![image](url)')
    expect(result).toHaveLength(1)
  })
})

describe('findInlineCode', () => {
  it('should find single inline code', () => {
    const result = findInlineCode('Use `code` here')
    expect(result).toHaveLength(1)
    expect(result[0].from).toBe(4)
    expect(result[0].to).toBe(10)
  })

  it('should find multiple inline code spans', () => {
    const result = findInlineCode('`first` and `second`')
    expect(result).toHaveLength(2)
  })

  it('should not match at start of triple backticks', () => {
    // Note: This function is used in combination with code block detection
    // which handles ``` lines separately. The function avoids matching
    // the first two backticks but may match content after.
    const result = findInlineCode('```')
    expect(result).toHaveLength(0)
  })

  it('should return empty array for text without inline code', () => {
    const result = findInlineCode('Just regular text')
    expect(result).toHaveLength(0)
  })

  it('should handle unclosed backtick', () => {
    const result = findInlineCode('`unclosed')
    expect(result).toHaveLength(0)
  })

  it('should not match two consecutive backticks as code', () => {
    const result = findInlineCode('``')
    // Two consecutive backticks are skipped (could be part of ```)
    expect(result).toHaveLength(0)
  })

  it('should match code with content between backticks', () => {
    const result = findInlineCode('`x`')
    expect(result).toHaveLength(1)
    expect(result[0].from).toBe(0)
    expect(result[0].to).toBe(3)
  })

  it('should correctly identify marker and content positions', () => {
    const result = findInlineCode('`code`')
    expect(result).toHaveLength(1)
    const code = result[0]
    expect(code.markerStart).toBe(0)    // Opening `
    expect(code.contentStart).toBe(1)   // c
    expect(code.contentEnd).toBe(5)     // after "code"
    expect(code.markerEnd).toBe(6)      // after closing `
  })
})

describe('findStrikethrough', () => {
  it('should find strikethrough text', () => {
    const result = findStrikethrough('This is ~~deleted~~ text')
    expect(result).toHaveLength(1)
    expect(result[0].from).toBe(8)
    expect(result[0].to).toBe(19)
  })

  it('should find multiple strikethroughs', () => {
    const result = findStrikethrough('~~first~~ and ~~second~~')
    expect(result).toHaveLength(2)
  })

  it('should return empty array for text without strikethrough', () => {
    const result = findStrikethrough('Regular text')
    expect(result).toHaveLength(0)
  })

  it('should not match single tildes', () => {
    const result = findStrikethrough('~not strikethrough~')
    expect(result).toHaveLength(0)
  })

  it('should correctly identify marker and content positions', () => {
    const result = findStrikethrough('~~deleted~~')
    expect(result).toHaveLength(1)
    const strike = result[0]
    expect(strike.markerStart).toBe(0)      // Opening ~~
    expect(strike.markerStartEnd).toBe(2)   // After opening ~~
    expect(strike.contentStart).toBe(2)     // d
    expect(strike.contentEnd).toBe(9)       // After "deleted"
    expect(strike.markerEndStart).toBe(9)   // Before closing ~~
    expect(strike.markerEnd).toBe(11)       // After closing ~~
  })
})

describe('findHighlight', () => {
  it('should find highlight text', () => {
    const result = findHighlight('This is ==important== text')
    expect(result).toHaveLength(1)
    expect(result[0].from).toBe(8)
    expect(result[0].to).toBe(21)
  })

  it('should find multiple highlights', () => {
    const result = findHighlight('==first== and ==second==')
    expect(result).toHaveLength(2)
  })

  it('should return empty array for text without highlight', () => {
    const result = findHighlight('Regular text')
    expect(result).toHaveLength(0)
  })

  it('should not match single equals', () => {
    const result = findHighlight('=not highlight=')
    expect(result).toHaveLength(0)
  })

  it('should correctly identify marker and content positions', () => {
    const result = findHighlight('==highlight==')
    expect(result).toHaveLength(1)
    const hl = result[0]
    expect(hl.markerStart).toBe(0)      // Opening ==
    expect(hl.markerStartEnd).toBe(2)   // After opening ==
    expect(hl.contentStart).toBe(2)     // h
    expect(hl.contentEnd).toBe(11)      // After "highlight"
    expect(hl.markerEndStart).toBe(11)  // Before closing ==
    expect(hl.markerEnd).toBe(13)       // After closing ==
  })
})

describe('findBold', () => {
  it('should find bold text', () => {
    const result = findBold('This is **bold** text')
    expect(result).toHaveLength(1)
    expect(result[0].from).toBe(8)
    expect(result[0].to).toBe(16)
  })

  it('should find multiple bold spans', () => {
    const result = findBold('**first** and **second**')
    expect(result).toHaveLength(2)
  })

  it('should return empty array for text without bold', () => {
    const result = findBold('Regular text')
    expect(result).toHaveLength(0)
  })

  it('should not match single asterisks (italic)', () => {
    const result = findBold('*not bold*')
    expect(result).toHaveLength(0)
  })

  it('should correctly identify marker and content positions', () => {
    const result = findBold('**bold**')
    expect(result).toHaveLength(1)
    const bold = result[0]
    expect(bold.markerStart).toBe(0)      // Opening **
    expect(bold.markerStartEnd).toBe(2)   // After opening **
    expect(bold.contentStart).toBe(2)     // b
    expect(bold.contentEnd).toBe(6)       // After "bold"
    expect(bold.markerEndStart).toBe(6)   // Before closing **
    expect(bold.markerEnd).toBe(8)        // After closing **
  })
})

describe('findItalic', () => {
  it('should find italic text', () => {
    const boldMatches = findBold('This is *italic* text')
    const result = findItalic('This is *italic* text', boldMatches)
    expect(result).toHaveLength(1)
    expect(result[0].from).toBe(8)
    expect(result[0].to).toBe(16)
  })

  it('should find multiple italic spans', () => {
    const text = '*first* and *second*'
    const boldMatches = findBold(text)
    const result = findItalic(text, boldMatches)
    expect(result).toHaveLength(2)
  })

  it('should return empty array for text without italic', () => {
    const boldMatches = findBold('Regular text')
    const result = findItalic('Regular text', boldMatches)
    expect(result).toHaveLength(0)
  })

  it('should not match double asterisks (bold)', () => {
    const text = '**not italic**'
    const boldMatches = findBold(text)
    const result = findItalic(text, boldMatches)
    expect(result).toHaveLength(0)
  })

  it('should correctly identify marker and content positions', () => {
    const text = '*italic*'
    const boldMatches = findBold(text)
    const result = findItalic(text, boldMatches)
    expect(result).toHaveLength(1)
    const italic = result[0]
    expect(italic.markerStart).toBe(0)      // Opening *
    expect(italic.markerStartEnd).toBe(1)   // After opening *
    expect(italic.contentStart).toBe(1)     // i
    expect(italic.contentEnd).toBe(7)       // After "italic"
    expect(italic.markerEndStart).toBe(7)   // Before closing *
    expect(italic.markerEnd).toBe(8)        // After closing *
  })

  it('should exclude italic spans that overlap with bold', () => {
    const text = '**bold** and *italic*'
    const boldMatches = findBold(text)
    const result = findItalic(text, boldMatches)
    // Should only find the italic, not the * inside **
    expect(result).toHaveLength(1)
    expect(result[0].contentStart).toBe(14) // "italic" starts at position 14
  })
})

describe('findBlockquoteSyntax', () => {
  it('should find blockquote with space', () => {
    const result = findBlockquoteSyntax('> Quote text')
    expect(result).not.toBeNull()
    expect(result?.from).toBe(0)
    expect(result?.to).toBe(2) // "> "
  })

  it('should find blockquote without space', () => {
    const result = findBlockquoteSyntax('>Quote text')
    expect(result).not.toBeNull()
    expect(result?.from).toBe(0)
    expect(result?.to).toBe(1) // ">"
  })

  it('should return null for non-blockquote', () => {
    const result = findBlockquoteSyntax('Regular text')
    expect(result).toBeNull()
  })

  it('should return null for > not at start', () => {
    const result = findBlockquoteSyntax('Text > with arrow')
    expect(result).toBeNull()
  })
})

describe('parseLine', () => {
  describe('headers', () => {
    it('should detect h1', () => {
      const result = parseLine('# Header 1', false)
      expect(result?.type).toBe('h1')
    })

    it('should detect h2', () => {
      const result = parseLine('## Header 2', false)
      expect(result?.type).toBe('h2')
    })

    it('should detect h3', () => {
      const result = parseLine('### Header 3', false)
      expect(result?.type).toBe('h3')
    })

    it('should detect h4', () => {
      const result = parseLine('#### Header 4', false)
      expect(result?.type).toBe('h4')
    })

    it('should detect h5', () => {
      const result = parseLine('##### Header 5', false)
      expect(result?.type).toBe('h5')
    })

    it('should detect h6', () => {
      const result = parseLine('###### Header 6', false)
      expect(result?.type).toBe('h6')
    })

    it('should require space after #', () => {
      const result = parseLine('#NoSpace', false)
      expect(result).toBeNull()
    })
  })

  describe('lists', () => {
    it('should detect bullet list with -', () => {
      const result = parseLine('- Item', false)
      expect(result?.type).toBe('bullet')
    })

    it('should detect bullet list with *', () => {
      const result = parseLine('* Item', false)
      expect(result?.type).toBe('bullet')
    })

    it('should detect bullet list with +', () => {
      const result = parseLine('+ Item', false)
      expect(result?.type).toBe('bullet')
    })

    it('should detect numbered list', () => {
      const result = parseLine('1. Item', false)
      expect(result?.type).toBe('numbered')
    })

    it('should detect numbered list with larger numbers', () => {
      const result = parseLine('123. Item', false)
      expect(result?.type).toBe('numbered')
    })
  })

  describe('tasks', () => {
    it('should detect unchecked task', () => {
      const result = parseLine('- [ ] Task', false)
      expect(result?.type).toBe('task')
      expect(result?.checked).toBe(false)
    })

    it('should detect checked task', () => {
      const result = parseLine('- [x] Task', false)
      expect(result?.type).toBe('task')
      expect(result?.checked).toBe(true)
    })

    it('should detect checked task with uppercase X', () => {
      const result = parseLine('- [X] Task', false)
      expect(result?.type).toBe('task')
      expect(result?.checked).toBe(true)
    })

    it('should provide checkbox position', () => {
      const result = parseLine('- [ ] Task', false)
      expect(result?.checkboxPos).toBe(2) // Position of [
    })

    it('should handle indented tasks', () => {
      const result = parseLine('  - [ ] Nested task', false)
      expect(result?.type).toBe('task')
      expect(result?.checkboxPos).toBe(4) // indent + "- "
    })
  })

  describe('blockquotes', () => {
    it('should detect blockquote', () => {
      const result = parseLine('> Quote', false)
      expect(result?.type).toBe('blockquote')
    })

    it('should detect blockquote without space', () => {
      const result = parseLine('>Quote', false)
      expect(result?.type).toBe('blockquote')
    })
  })

  describe('code blocks', () => {
    it('should detect code block start', () => {
      const result = parseLine('```javascript', false)
      expect(result?.type).toBe('code-start')
    })

    it('should detect code block end', () => {
      const result = parseLine('```', true)
      expect(result?.type).toBe('code-end')
    })

    it('should detect code content', () => {
      const result = parseLine('const x = 1;', true)
      expect(result?.type).toBe('code-content')
    })
  })

  describe('horizontal rules', () => {
    it('should detect hr with dashes', () => {
      const result = parseLine('---', false)
      expect(result?.type).toBe('hr')
    })

    it('should detect hr with asterisks', () => {
      const result = parseLine('***', false)
      expect(result?.type).toBe('hr')
    })

    it('should detect hr with underscores', () => {
      const result = parseLine('___', false)
      expect(result?.type).toBe('hr')
    })

    it('should detect hr with more than 3 characters', () => {
      const result = parseLine('-----', false)
      expect(result?.type).toBe('hr')
    })
  })

  describe('regular text', () => {
    it('should return null for regular text', () => {
      const result = parseLine('Just some text', false)
      expect(result).toBeNull()
    })

    it('should return null for empty line', () => {
      const result = parseLine('', false)
      expect(result).toBeNull()
    })
  })
})
