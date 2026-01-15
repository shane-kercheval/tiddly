/**
 * Tests for markdown style extension helper functions.
 */
import { describe, it, expect } from 'vitest'
import { _testExports } from './markdownStyleExtension'

const { findImages, findLinks, findInlineCode, findStrikethrough, parseLine } = _testExports

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
