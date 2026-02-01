/**
 * CodeMirror 6 extension for visual markdown styling.
 *
 * Adds visual enhancements to markdown editing while preserving exact source:
 * - Larger/styled headers (H1-H6)
 * - Styled lists (bullet, numbered)
 * - Code block backgrounds
 * - Clickable checkboxes
 * - Strikethrough text
 * - Horizontal rules
 * - Styled links (Cmd+click to open)
 * - Styled images (alt text in green, syntax dimmed)
 *
 * This is a "text-first" approach - the source is never modified by the styling,
 * only decorated visually.
 */
import {
  ViewPlugin,
  Decoration,
  EditorView,
  WidgetType,
} from '@codemirror/view'
import type { DecorationSet, ViewUpdate } from '@codemirror/view'
import { RangeSetBuilder } from '@codemirror/state'

// Shared styles for dimmed markdown syntax (brackets, #, >, etc.)
const SYNTAX_COLOR = '#c0c5cc'
const SYNTAX_FONT_SIZE = '0.9em'

/**
 * Widget for rendering a clickable checkbox.
 * When clicked, toggles between [ ] and [x] in the source.
 */
class CheckboxWidget extends WidgetType {
  checked: boolean
  bracketPos: number  // Position of [ character for editing

  constructor(checked: boolean, bracketPos: number) {
    super()
    this.checked = checked
    this.bracketPos = bracketPos
  }

  toDOM(view: EditorView): HTMLElement {
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.checked = this.checked
    checkbox.className = 'cm-checkbox-widget'
    checkbox.setAttribute('aria-label', this.checked ? 'Completed task' : 'Incomplete task')

    checkbox.addEventListener('mousedown', (e) => {
      e.preventDefault() // Prevent focus change
      const newText = this.checked ? '[ ]' : '[x]'
      view.dispatch({
        changes: { from: this.bracketPos, to: this.bracketPos + 3, insert: newText },
      })
    })

    return checkbox
  }

  eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked && other.bracketPos === this.bracketPos
  }

  ignoreEvent(): boolean {
    return false
  }
}

/**
 * Parse a line and return decoration info if it matches a markdown pattern.
 */
interface LineInfo {
  type: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'bullet' | 'numbered' | 'task' | 'blockquote' | 'code-start' | 'code-end' | 'code-content' | 'hr'
  checked?: boolean
  checkboxPos?: number  // Position to place the widget (start of line after indent)
  bracketPos?: number   // Position of [ character for editing
}

function parseLine(text: string, inCodeBlock: boolean): LineInfo | null {
  // Code block detection
  if (text.startsWith('```')) {
    return inCodeBlock ? { type: 'code-end' } : { type: 'code-start' }
  }

  // Inside code block - mark as code content
  if (inCodeBlock) {
    return { type: 'code-content' }
  }

  // Headers
  if (text.startsWith('# ')) return { type: 'h1' }
  if (text.startsWith('## ')) return { type: 'h2' }
  if (text.startsWith('### ')) return { type: 'h3' }
  if (text.startsWith('#### ')) return { type: 'h4' }
  if (text.startsWith('##### ')) return { type: 'h5' }
  if (text.startsWith('###### ')) return { type: 'h6' }

  // Task lists - check for [ ] or [x]
  const taskMatch = text.match(/^(\s*)([-*+])\s+\[([ xX])\]\s/)
  if (taskMatch) {
    const checked = taskMatch[3].toLowerCase() === 'x'
    const indent = taskMatch[1].length
    // checkboxPos: start of line (after indent) - widget appears before "- [ ]"
    // bracketPos: position of [ character - for editing when clicked
    const checkboxPos = indent
    const bracketPos = indent + taskMatch[2].length + 1 // indent + "-" + " "
    return { type: 'task', checked, checkboxPos, bracketPos }
  }

  // Bullet lists
  if (/^\s*[-*+]\s/.test(text)) return { type: 'bullet' }

  // Numbered lists
  if (/^\s*\d+\.\s/.test(text)) return { type: 'numbered' }

  // Blockquotes
  if (text.startsWith('>')) return { type: 'blockquote' }

  // Horizontal rules (---, ***, ___)
  if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(text)) return { type: 'hr' }

  return null
}

/**
 * Match info for inline code (backticks).
 * Separates marker positions from content for independent styling.
 */
interface InlineCodeMatch {
  from: number           // Start of full match
  to: number             // End of full match
  markerStart: number    // Position of opening backtick
  contentStart: number   // Start of content
  contentEnd: number     // End of content
  markerEnd: number      // Position after closing backtick
}

/**
 * Find all inline code spans in a line (text between single backticks).
 * Returns structured info for separate marker/content styling.
 */
function findInlineCode(text: string): InlineCodeMatch[] {
  const results: InlineCodeMatch[] = []
  let i = 0

  while (i < text.length) {
    // Find opening backtick (but not triple backtick for code blocks)
    if (text[i] === '`' && text[i + 1] !== '`') {
      const start = i
      i++
      // Find closing backtick
      while (i < text.length && text[i] !== '`') {
        i++
      }
      if (i < text.length && text[i] === '`') {
        // Found complete inline code span
        results.push({
          from: start,
          to: i + 1,
          markerStart: start,
          contentStart: start + 1,
          contentEnd: i,
          markerEnd: i + 1,
        })
      }
      i++
    } else {
      i++
    }
  }

  return results
}

/**
 * Match info for inline formatting (bold, italic, strikethrough, highlight).
 * Separates marker positions from content for independent styling.
 */
interface InlineFormatMatch {
  from: number           // Start of full match
  to: number             // End of full match
  markerStart: number    // Start of opening marker
  markerStartEnd: number // End of opening marker
  contentStart: number   // Start of content
  contentEnd: number     // End of content
  markerEndStart: number // Start of closing marker
  markerEnd: number      // End of closing marker
}

/**
 * Find all strikethrough spans in a line (text between ~~).
 * Returns structured info for separate marker/content styling.
 */
function findStrikethrough(text: string): InlineFormatMatch[] {
  const results: InlineFormatMatch[] = []
  const regex = /~~([^~]+)~~/g
  let match

  while ((match = regex.exec(text)) !== null) {
    const start = match.index
    const content = match[1]
    results.push({
      from: start,
      to: start + match[0].length,
      markerStart: start,
      markerStartEnd: start + 2,
      contentStart: start + 2,
      contentEnd: start + 2 + content.length,
      markerEndStart: start + 2 + content.length,
      markerEnd: start + match[0].length,
    })
  }

  return results
}

/**
 * Find all highlight spans in a line (text between ==).
 * Returns structured info for separate marker/content styling.
 */
function findHighlight(text: string): InlineFormatMatch[] {
  const results: InlineFormatMatch[] = []
  const regex = /==([^=]+)==/g
  let match

  while ((match = regex.exec(text)) !== null) {
    const start = match.index
    const content = match[1]
    results.push({
      from: start,
      to: start + match[0].length,
      markerStart: start,
      markerStartEnd: start + 2,
      contentStart: start + 2,
      contentEnd: start + 2 + content.length,
      markerEndStart: start + 2 + content.length,
      markerEnd: start + match[0].length,
    })
  }

  return results
}

/**
 * Find all bold spans in a line (text between **).
 * Returns structured info for separate marker/content styling.
 * Careful to not match *** which could be bold+italic.
 */
function findBold(text: string): InlineFormatMatch[] {
  const results: InlineFormatMatch[] = []
  // Match ** not followed by another * (to avoid ***), content without *, then **
  const regex = /\*\*(?!\*)([^*]+)\*\*(?!\*)/g
  let match

  while ((match = regex.exec(text)) !== null) {
    const start = match.index
    const content = match[1]
    results.push({
      from: start,
      to: start + match[0].length,
      markerStart: start,
      markerStartEnd: start + 2,
      contentStart: start + 2,
      contentEnd: start + 2 + content.length,
      markerEndStart: start + 2 + content.length,
      markerEnd: start + match[0].length,
    })
  }

  return results
}

/**
 * Find all italic spans in a line (text between single *).
 * Must exclude bold (**) spans to avoid conflicts.
 * Returns structured info for separate marker/content styling.
 */
function findItalic(text: string, boldMatches: InlineFormatMatch[]): InlineFormatMatch[] {
  const results: InlineFormatMatch[] = []
  // Match single * not preceded or followed by another *
  const regex = /(?<!\*)\*(?!\*)([^*]+)\*(?!\*)/g
  let match

  while ((match = regex.exec(text)) !== null) {
    const start = match.index
    const content = match[1]
    const end = start + match[0].length

    // Check if this italic span overlaps with any bold span
    const overlapsWithBold = boldMatches.some(
      (bold) => (start >= bold.from && start < bold.to) || (end > bold.from && end <= bold.to)
    )

    if (!overlapsWithBold) {
      results.push({
        from: start,
        to: end,
        markerStart: start,
        markerStartEnd: start + 1,
        contentStart: start + 1,
        contentEnd: start + 1 + content.length,
        markerEndStart: start + 1 + content.length,
        markerEnd: end,
      })
    }
  }

  return results
}

/**
 * Find all markdown images in a line.
 * Returns structured info about each image for styling.
 */
interface ImageMatch {
  from: number
  to: number
  exclamation: number     // !
  openBracket: number     // [
  altStart: number        // start of alt text
  altEnd: number          // end of alt text
  closeBracket: number    // ]
  openParen: number       // (
  urlStart: number        // start of URL
  urlEnd: number          // end of URL
  closeParen: number      // )
}

function findImages(text: string): ImageMatch[] {
  const results: ImageMatch[] = []
  // Match ![alt](url) - the ! prefix distinguishes from links
  const regex = /!\[([^\]]*)\]\(([^)]+)\)/g
  let match

  while ((match = regex.exec(text)) !== null) {
    const fullMatch = match[0]
    const altText = match[1]
    const url = match[2]
    const start = match.index

    results.push({
      from: start,
      to: start + fullMatch.length,
      exclamation: start,
      openBracket: start + 1,
      altStart: start + 2,
      altEnd: start + 2 + altText.length,
      closeBracket: start + 2 + altText.length,
      openParen: start + 2 + altText.length + 1,
      urlStart: start + 2 + altText.length + 2,
      urlEnd: start + 2 + altText.length + 2 + url.length,
      closeParen: start + fullMatch.length - 1,
    })
  }

  return results
}

/**
 * Find all markdown links in a line.
 * Returns structured info about each link for different styling.
 */
interface LinkMatch {
  // Full match positions
  from: number
  to: number
  // Component positions (relative to line start)
  openBracket: number      // [
  textStart: number        // start of link text
  textEnd: number          // end of link text
  closeBracket: number     // ]
  openParen: number        // (
  urlStart: number         // start of URL
  urlEnd: number           // end of URL
  closeParen: number       // )
  // The actual URL for click handling
  url: string
}

function findLinks(text: string): LinkMatch[] {
  const results: LinkMatch[] = []
  // Match [text](url) - non-greedy, handles nested brackets poorly but works for most cases
  const regex = /\[([^\]]+)\]\(([^)]+)\)/g
  let match

  while ((match = regex.exec(text)) !== null) {
    const fullMatch = match[0]
    const linkText = match[1]
    const url = match[2]
    const start = match.index

    results.push({
      from: start,
      to: start + fullMatch.length,
      openBracket: start,
      textStart: start + 1,
      textEnd: start + 1 + linkText.length,
      closeBracket: start + 1 + linkText.length,
      openParen: start + 1 + linkText.length + 1,
      urlStart: start + 1 + linkText.length + 2,
      urlEnd: start + 1 + linkText.length + 2 + url.length,
      closeParen: start + fullMatch.length - 1,
      url,
    })
  }

  return results
}

// Shared decoration for all syntax markers (**, *, ~~, ==, `)
const syntaxMarkerMark = Decoration.mark({ class: 'cm-md-syntax-marker' })

// Decorations for inline code (backticks)
const inlineCodeContentMark = Decoration.mark({ class: 'cm-md-inline-code-content' })

// Decorations for strikethrough
const strikethroughContentMark = Decoration.mark({ class: 'cm-md-strikethrough-content' })

// Decorations for highlight
const highlightContentMark = Decoration.mark({ class: 'cm-md-highlight-content' })

// Decorations for bold
const boldContentMark = Decoration.mark({ class: 'cm-md-bold-content' })

// Decorations for italic
const italicContentMark = Decoration.mark({ class: 'cm-md-italic-content' })

// Decoration for task syntax
const taskSyntaxMark = Decoration.mark({ class: 'cm-md-task-syntax' })

// Decoration for header syntax
const headerSyntaxMark = Decoration.mark({ class: 'cm-md-header-syntax' })

// Decoration for blockquote syntax
const blockquoteSyntaxMark = Decoration.mark({ class: 'cm-md-blockquote-syntax' })

/**
 * Find task list syntax in a line (e.g., "- [ ] " or "- [x] ").
 * Returns the range to gray out, or null if not a task line.
 */
function findTaskSyntax(text: string): { from: number; to: number } | null {
  const match = text.match(/^(\s*)[-*+]\s+\[([ xX])\]\s/)
  if (match) {
    return { from: match[1].length, to: match[0].length }
  }
  return null
}

/**
 * Find header syntax in a line (e.g., "# " or "## ").
 * Returns the range of the # marks and space, or null if not a header.
 */
function findHeaderSyntax(text: string): { from: number; to: number } | null {
  const match = text.match(/^(#{1,6})\s/)
  if (match) {
    return { from: 0, to: match[0].length }
  }
  return null
}

/**
 * Find blockquote syntax in a line (e.g., "> " or ">").
 * Returns the range of the > and optional space, or null if not a blockquote.
 */
function findBlockquoteSyntax(text: string): { from: number; to: number } | null {
  const match = text.match(/^>\s?/)
  if (match) {
    return { from: 0, to: match[0].length }
  }
  return null
}

// Decorations for links
const linkBracketMark = Decoration.mark({ class: 'cm-md-link-bracket' })
const linkTextMark = Decoration.mark({ class: 'cm-md-link-text' })
const linkUrlMark = Decoration.mark({ class: 'cm-md-link-url' })

// Decorations for images
const imageSyntaxMark = Decoration.mark({ class: 'cm-md-image-syntax' })
const imageAltMark = Decoration.mark({ class: 'cm-md-image-alt' })
const imageUrlMark = Decoration.mark({ class: 'cm-md-image-url' })

/**
 * Build decorations for the entire document.
 */
function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  let inCodeBlock = false

  for (let i = 1; i <= view.state.doc.lines; i++) {
    const line = view.state.doc.line(i)
    const info = parseLine(line.text, inCodeBlock)

    // Track code block state
    if (info?.type === 'code-start') {
      inCodeBlock = true
    } else if (info?.type === 'code-end') {
      inCodeBlock = false
    }

    // Add line decoration if we have line-level styling
    if (info) {
      let lineClass = `cm-md-${info.type}`
      // Add checked class for completed tasks
      if (info.type === 'task' && info.checked) {
        lineClass += ' cm-md-task-checked'
      }
      builder.add(line.from, line.from, Decoration.line({ class: lineClass }))
    }

    // Add inline decorations (only outside of code blocks)
    if (!inCodeBlock) {
      // Collect all inline decorations with their positions
      const inlineDecorations: Array<{ from: number; to: number; decoration: Decoration }> = []

      // Checkbox widget for task items (added here so it sorts with other decorations)
      if (info?.type === 'task' && info.checkboxPos !== undefined && info.bracketPos !== undefined) {
        const widgetPos = line.from + info.checkboxPos   // Where to place the widget
        const bracketPos = line.from + info.bracketPos   // Where [ is for editing
        inlineDecorations.push({
          from: widgetPos,
          to: widgetPos,
          decoration: Decoration.widget({
            widget: new CheckboxWidget(info.checked ?? false, bracketPos),
            side: -1,
          }),
        })
      }

      // Task syntax (- [ ] or - [x])
      const taskSyntax = findTaskSyntax(line.text)
      if (taskSyntax) {
        inlineDecorations.push({ from: line.from + taskSyntax.from, to: line.from + taskSyntax.to, decoration: taskSyntaxMark })
      }

      // Header syntax (# or ## etc)
      const headerSyntax = findHeaderSyntax(line.text)
      if (headerSyntax) {
        inlineDecorations.push({ from: line.from + headerSyntax.from, to: line.from + headerSyntax.to, decoration: headerSyntaxMark })
      }

      // Blockquote syntax (> )
      const blockquoteSyntax = findBlockquoteSyntax(line.text)
      if (blockquoteSyntax) {
        inlineDecorations.push({ from: line.from + blockquoteSyntax.from, to: line.from + blockquoteSyntax.to, decoration: blockquoteSyntaxMark })
      }

      // Bold - must be processed before italic to handle ** vs *
      const bolds = findBold(line.text)
      for (const bold of bolds) {
        // Opening **
        inlineDecorations.push({ from: line.from + bold.markerStart, to: line.from + bold.markerStartEnd, decoration: syntaxMarkerMark })
        // Bold content
        if (bold.contentEnd > bold.contentStart) {
          inlineDecorations.push({ from: line.from + bold.contentStart, to: line.from + bold.contentEnd, decoration: boldContentMark })
        }
        // Closing **
        inlineDecorations.push({ from: line.from + bold.markerEndStart, to: line.from + bold.markerEnd, decoration: syntaxMarkerMark })
      }

      // Italic - exclude spans that overlap with bold
      const italics = findItalic(line.text, bolds)
      for (const italic of italics) {
        // Opening *
        inlineDecorations.push({ from: line.from + italic.markerStart, to: line.from + italic.markerStartEnd, decoration: syntaxMarkerMark })
        // Italic content
        if (italic.contentEnd > italic.contentStart) {
          inlineDecorations.push({ from: line.from + italic.contentStart, to: line.from + italic.contentEnd, decoration: italicContentMark })
        }
        // Closing *
        inlineDecorations.push({ from: line.from + italic.markerEndStart, to: line.from + italic.markerEnd, decoration: syntaxMarkerMark })
      }

      // Inline code
      const inlineCodes = findInlineCode(line.text)
      for (const code of inlineCodes) {
        // Opening backtick
        inlineDecorations.push({ from: line.from + code.markerStart, to: line.from + code.contentStart, decoration: syntaxMarkerMark })
        // Code content
        if (code.contentEnd > code.contentStart) {
          inlineDecorations.push({ from: line.from + code.contentStart, to: line.from + code.contentEnd, decoration: inlineCodeContentMark })
        }
        // Closing backtick
        inlineDecorations.push({ from: line.from + code.contentEnd, to: line.from + code.markerEnd, decoration: syntaxMarkerMark })
      }

      // Strikethrough
      const strikethroughs = findStrikethrough(line.text)
      for (const strike of strikethroughs) {
        // Opening ~~
        inlineDecorations.push({ from: line.from + strike.markerStart, to: line.from + strike.markerStartEnd, decoration: syntaxMarkerMark })
        // Strikethrough content
        if (strike.contentEnd > strike.contentStart) {
          inlineDecorations.push({ from: line.from + strike.contentStart, to: line.from + strike.contentEnd, decoration: strikethroughContentMark })
        }
        // Closing ~~
        inlineDecorations.push({ from: line.from + strike.markerEndStart, to: line.from + strike.markerEnd, decoration: syntaxMarkerMark })
      }

      // Highlight
      const highlights = findHighlight(line.text)
      for (const highlight of highlights) {
        // Opening ==
        inlineDecorations.push({ from: line.from + highlight.markerStart, to: line.from + highlight.markerStartEnd, decoration: syntaxMarkerMark })
        // Highlight content
        if (highlight.contentEnd > highlight.contentStart) {
          inlineDecorations.push({ from: line.from + highlight.contentStart, to: line.from + highlight.contentEnd, decoration: highlightContentMark })
        }
        // Closing ==
        inlineDecorations.push({ from: line.from + highlight.markerEndStart, to: line.from + highlight.markerEnd, decoration: syntaxMarkerMark })
      }

      // Images - style syntax similar to links but with different color for alt text
      const images = findImages(line.text)
      for (const image of images) {
        // ! and opening bracket ![
        inlineDecorations.push({ from: line.from + image.exclamation, to: line.from + image.openBracket + 1, decoration: imageSyntaxMark })
        // Alt text
        if (image.altEnd > image.altStart) {
          inlineDecorations.push({ from: line.from + image.altStart, to: line.from + image.altEnd, decoration: imageAltMark })
        }
        // Closing bracket ]
        inlineDecorations.push({ from: line.from + image.closeBracket, to: line.from + image.closeBracket + 1, decoration: imageSyntaxMark })
        // Opening paren and URL (url)
        inlineDecorations.push({ from: line.from + image.openParen, to: line.from + image.closeParen + 1, decoration: imageUrlMark })
      }

      // Links - multiple decorations per link (exclude images which start with !)
      const links = findLinks(line.text).filter(link => {
        // Check if this link is actually part of an image (preceded by !)
        return link.openBracket === 0 || line.text[link.openBracket - 1] !== '!'
      })
      for (const link of links) {
        // Opening bracket [
        inlineDecorations.push({ from: line.from + link.openBracket, to: line.from + link.openBracket + 1, decoration: linkBracketMark })
        // Link text
        inlineDecorations.push({ from: line.from + link.textStart, to: line.from + link.textEnd, decoration: linkTextMark })
        // Closing bracket ]
        inlineDecorations.push({ from: line.from + link.closeBracket, to: line.from + link.closeBracket + 1, decoration: linkBracketMark })
        // Opening paren and URL (
        inlineDecorations.push({ from: line.from + link.openParen, to: line.from + link.closeParen + 1, decoration: linkUrlMark })
      }

      // Sort by position and add to builder (RangeSetBuilder requires sorted order)
      inlineDecorations.sort((a, b) => a.from - b.from || a.to - b.to)
      for (const { from, to, decoration } of inlineDecorations) {
        builder.add(from, to, decoration)
      }
    }
  }

  return builder.finish()
}

/**
 * Check if a position is inside a code block (or on a code fence line).
 */
function isPositionInCodeBlock(view: EditorView, pos: number): boolean {
  const line = view.state.doc.lineAt(pos)

  // If current line is a code fence, it has dark background - return true
  if (line.text.startsWith('```')) {
    return true
  }

  let inCodeBlock = false

  // Scan from start of document to current line
  for (let i = 1; i <= line.number; i++) {
    const l = view.state.doc.line(i)
    if (l.text.startsWith('```')) {
      inCodeBlock = !inCodeBlock
    }
  }

  return inCodeBlock
}

/**
 * ViewPlugin that adds a class to editor when cursor is in a code block.
 * This allows styling the cursor color based on context.
 */
const cursorInCodeBlockPlugin = ViewPlugin.fromClass(
  class {
    constructor(view: EditorView) {
      this.updateClass(view)
    }

    update(update: ViewUpdate): void {
      // Always update - catches typing, selection, and any other changes
      this.updateClass(update.view)
    }

    updateClass(view: EditorView): void {
      const pos = view.state.selection.main.head
      const inCode = isPositionInCodeBlock(view, pos)

      if (inCode) {
        view.dom.classList.add('cm-cursor-in-code')
      } else {
        view.dom.classList.remove('cm-cursor-in-code')
      }
    }

    destroy(): void {
      // Class will be removed when element is destroyed
    }
  }
)

/**
 * ViewPlugin that maintains markdown decorations.
 */
const markdownDecorationPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view)
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildDecorations(update.view)
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
)

/**
 * Base theme for markdown styling.
 * Uses CSS variables for customization.
 */
const markdownBaseTheme = EditorView.baseTheme({
  // Base editor font - Inter (same as Obsidian)
  '&': {
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
  '.cm-content': {
    fontFamily: 'inherit',
  },
  '.cm-line': {
    fontFamily: 'inherit',
  },

  // Remove underlines from default markdown heading syntax highlighting
  // Try multiple selectors to catch whatever CodeMirror is using
  '.cmt-heading, .cmt-heading1, .cmt-heading2, .cmt-heading3, .cmt-heading4, .cmt-heading5, .cmt-heading6': {
    textDecoration: 'none !important',
  },
  '.cm-header, .cm-header-1, .cm-header-2, .cm-header-3, .cm-header-4, .cm-header-5, .cm-header-6': {
    textDecoration: 'none !important',
  },
  '.tok-heading, .tok-heading1, .tok-heading2, .tok-heading3, .tok-heading4, .tok-heading5, .tok-heading6': {
    textDecoration: 'none !important',
  },
  // Nuclear option - remove underlines from header lines entirely
  '.cm-md-h1 *, .cm-md-h2 *, .cm-md-h3 *, .cm-md-h4 *, .cm-md-h5 *, .cm-md-h6 *': {
    textDecoration: 'none !important',
  },
  '.cm-md-h1, .cm-md-h2, .cm-md-h3, .cm-md-h4, .cm-md-h5, .cm-md-h6': {
    textDecoration: 'none !important',
  },

  // Headers - progressively smaller sizes
  '.cm-md-h1': {
    fontSize: '1.75em',
    fontWeight: '700',
    lineHeight: '1.3',
    color: '#111827',
    textDecoration: 'none',
  },
  '.cm-md-h2': {
    fontSize: '1.5em',
    fontWeight: '600',
    lineHeight: '1.35',
    color: '#1f2937',
    textDecoration: 'none',
  },
  '.cm-md-h3': {
    fontSize: '1.25em',
    fontWeight: '600',
    lineHeight: '1.4',
    color: '#374151',
    textDecoration: 'none',
  },
  '.cm-md-h4': {
    fontSize: '1.125em',
    fontWeight: '600',
    lineHeight: '1.45',
    color: '#374151',
    textDecoration: 'none',
  },
  '.cm-md-h5': {
    fontSize: '1em',
    fontWeight: '600',
    lineHeight: '1.5',
    color: '#4b5563',
    textDecoration: 'none',
  },
  '.cm-md-h6': {
    fontSize: '0.925em',
    fontWeight: '600',
    lineHeight: '1.5',
    color: '#6b7280',
    textDecoration: 'none',
  },

  // Lists
  '.cm-md-bullet, .cm-md-numbered, .cm-md-task': {
    paddingLeft: '0.5em',
  },

  // Task items
  '.cm-md-task': {
    position: 'relative',
  },

  // Completed tasks - strikethrough and dimmed
  '.cm-md-task-checked': {
    textDecoration: 'line-through',
    textDecorationColor: '#6b7280',
    color: '#6b7280',
  },

  // Blockquotes
  '.cm-md-blockquote': {
    borderLeft: '3px solid #6366f1',
    paddingLeft: '1em',
  },

  // Code blocks - light gray background, monospace font
  // Use mix-blend-mode so text selection shows through the background
  '.cm-md-code-start, .cm-md-code-end, .cm-md-code-content': {
    backgroundColor: '#f5f7f8',
    mixBlendMode: 'multiply',
    fontFamily: '"Source Code Pro", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: '0.9em',
    marginRight: '4px',
  },
  // Code fence lines (``` and ```language) - dimmer gray
  '.cm-md-code-start, .cm-md-code-start *, .cm-md-code-end, .cm-md-code-end *': {
    color: '#6b7280 !important',
  },
  '.cm-md-code-start': {
    borderTopLeftRadius: '6px',
    borderTopRightRadius: '6px',
    paddingTop: '0.5em',
  },
  '.cm-md-code-end': {
    borderBottomLeftRadius: '6px',
    borderBottomRightRadius: '6px',
    paddingBottom: '0.0em',
  },
  // Custom cursor - thicker and red like Bear notes
  '.cm-cursor, .cm-cursor-primary': {
    borderLeftColor: '#f87171 !important',
    borderLeftWidth: '2px !important',
    transform: 'scaleY(1.2)',
    transformOrigin: 'center',
  },

  // Shared syntax marker style for all inline formatting (**, *, ~~, ==, `)
  // Using a slightly lighter gray for better readability
  '.cm-md-syntax-marker, .cm-md-syntax-marker *': {
    color: `${SYNTAX_COLOR} !important`,
    fontWeight: 'normal !important',
    fontStyle: 'normal !important',
    textDecoration: 'none !important',
    fontSize: SYNTAX_FONT_SIZE,
  },

  // Inline code content - light blue background with blue text
  // Use mix-blend-mode so text selection shows through the background
  '.cm-md-inline-code-content': {
    backgroundColor: '#eff6ff',
    mixBlendMode: 'multiply',
    color: '#2563eb',
    fontFamily: '"Source Code Pro", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: '0.9em',
    padding: '0.1em 0.2em',
    borderRadius: '3px',
  },

  // Bold content
  '.cm-md-bold-content, .cm-md-bold-content *': {
    fontWeight: '700 !important',
  },

  // Italic content
  '.cm-md-italic-content, .cm-md-italic-content *': {
    fontStyle: 'italic !important',
  },

  // Highlight content - yellow/amber background
  // Use mix-blend-mode so text selection shows through the background
  '.cm-md-highlight-content': {
    backgroundColor: '#fef3c7',
    mixBlendMode: 'multiply',
    color: '#92400e',
    padding: '0.1em 0.2em',
    borderRadius: '3px',
  },

  // Checkbox widget - appears before the task syntax
  '.cm-checkbox-widget': {
    width: '14px',
    height: '14px',
    marginRight: '4px',
    verticalAlign: 'middle',
    cursor: 'pointer',
    accentColor: '#374151',
    pointerEvents: 'auto',
  },

  // Task syntax (- [ ] or - [x]) - dimmed gray like other markdown syntax
  '.cm-md-task-syntax': {
    color: `${SYNTAX_COLOR} !important`,
    textDecoration: 'none !important',
    fontSize: SYNTAX_FONT_SIZE,
  },
  '.cm-md-task-syntax *': {
    color: `${SYNTAX_COLOR} !important`,
    textDecoration: 'none !important',
  },

  // Header syntax (# marks) - dimmed gray (using shared lighter gray)
  '.cm-md-header-syntax': {
    color: `${SYNTAX_COLOR} !important`,
    fontWeight: 'normal !important',
    fontSize: `${SYNTAX_FONT_SIZE} !important`,
  },
  '.cm-md-header-syntax *': {
    color: `${SYNTAX_COLOR} !important`,
    fontWeight: 'normal !important',
    fontSize: 'inherit !important',
  },

  // Blockquote syntax (> ) - light gray, subtle
  '.cm-md-blockquote-syntax, .cm-md-blockquote-syntax *': {
    color: `${SYNTAX_COLOR} !important`,
    fontStyle: 'normal !important',
    fontSize: SYNTAX_FONT_SIZE,
  },

  // Strikethrough content
  '.cm-md-strikethrough-content, .cm-md-strikethrough-content *': {
    textDecoration: 'line-through !important',
    color: '#9ca3af !important',
  },

  // Horizontal rule - full width line with --- text visible
  '.cm-md-hr': {
    background: 'linear-gradient(transparent 42.5%, #d1d5db 42.5%, #d1d5db 57.5%, transparent 57.5%)',
    color: '#374151',
    marginLeft: '0.5em',
    marginRight: '0.5em',
  },

  // Links - text looks like a link, brackets/URL are dimmed gray (using shared lighter gray)
  '.cm-md-link-bracket': {
    color: `${SYNTAX_COLOR} !important`,
    textDecoration: 'none !important',
    fontSize: SYNTAX_FONT_SIZE,
  },
  '.cm-md-link-text': {
    color: '#2563eb !important',
    textDecoration: 'underline !important',
    textDecorationColor: '#93c5fd',
  },
  '.cm-md-link-url': {
    color: `${SYNTAX_COLOR} !important`,
    textDecoration: 'none !important',
    fontSize: SYNTAX_FONT_SIZE,
  },
  // Override any nested syntax highlighting in links
  '.cm-md-link-bracket *, .cm-md-link-url *': {
    color: `${SYNTAX_COLOR} !important`,
    textDecoration: 'none !important',
  },

  // Images - similar to links but with green alt text to distinguish
  '.cm-md-image-syntax': {
    color: `${SYNTAX_COLOR} !important`,
    textDecoration: 'none !important',
    fontSize: SYNTAX_FONT_SIZE,
  },
  '.cm-md-image-alt': {
    color: '#059669 !important',
    textDecoration: 'none !important',
  },
  '.cm-md-image-url': {
    color: `${SYNTAX_COLOR} !important`,
    textDecoration: 'none !important',
    fontSize: SYNTAX_FONT_SIZE,
  },
  // Override any nested syntax highlighting in images
  '.cm-md-image-syntax *, .cm-md-image-url *': {
    color: `${SYNTAX_COLOR} !important`,
    textDecoration: 'none !important',
  },
})

/**
 * Find link at a given position in the document.
 * Returns the URL if position is within a link, null otherwise.
 */
function findLinkAtPosition(view: EditorView, pos: number): string | null {
  const line = view.state.doc.lineAt(pos)
  const links = findLinks(line.text)
  const offsetInLine = pos - line.from

  for (const link of links) {
    if (offsetInLine >= link.from && offsetInLine < link.to) {
      return link.url
    }
  }

  return null
}

/**
 * Event handler for Cmd+click (or Ctrl+click) to open links.
 */
const linkClickHandler = EditorView.domEventHandlers({
  click(event: MouseEvent, view: EditorView) {
    // Only handle Cmd+click (Mac) or Ctrl+click (Windows/Linux)
    if (!event.metaKey && !event.ctrlKey) {
      return false
    }

    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
    if (pos === null) {
      return false
    }

    const url = findLinkAtPosition(view, pos)
    if (url) {
      // Ensure URL has a protocol
      let finalUrl = url
      if (!url.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:/)) {
        // No protocol - assume https
        finalUrl = 'https://' + url
      }
      // Open link in new tab
      window.open(finalUrl, '_blank', 'noopener,noreferrer')
      event.preventDefault()
      return true
    }

    return false
  },
})

/**
 * Complete markdown styling extension.
 * Add this to your CodeMirror extensions array.
 */
export const markdownStyleExtension = [
  markdownDecorationPlugin,
  cursorInCodeBlockPlugin,
  markdownBaseTheme,
  linkClickHandler,
]

// Export helper functions for testing
export const _testExports = {
  findImages,
  findLinks,
  findInlineCode,
  findStrikethrough,
  findHighlight,
  findBold,
  findItalic,
  findBlockquoteSyntax,
  parseLine,
}
