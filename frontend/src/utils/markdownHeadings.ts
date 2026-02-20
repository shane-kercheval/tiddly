export interface MarkdownHeading {
  level: number // 1-6
  text: string // cleaned heading text (no #s, no inline markers)
  line: number // 1-based line number in the document
}

const HEADING_RE = /^(#{1,6}) /
const FENCE_OPEN_RE = /^(\s*)((`{3,})|(~{3,}))/

/**
 * Strip common inline markdown markers from heading text.
 * Handles wrapping pairs: **bold**, *italic*, __bold__, _italic_,
 * `code`, ~~strikethrough~~, ==highlight==
 */
function cleanInlineFormatting(text: string): string {
  // Order matters: longer markers first to avoid partial matches
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/==(.+?)==/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/(?<!\w)\*(.+?)\*(?!\w)/g, '$1')
    .replace(/(?<!\w)_(.+?)_(?!\w)/g, '$1')
    .replace(/`(.+?)`/g, '$1')
}

export function parseMarkdownHeadings(text: string): MarkdownHeading[] {
  const lines = text.split('\n')
  const headings: MarkdownHeading[] = []

  let inCodeFence = false
  let fenceChar = ''
  let fenceLength = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Check for code fence boundaries
    const fenceMatch = line.match(FENCE_OPEN_RE)
    if (fenceMatch) {
      const char = fenceMatch[2][0] // '`' or '~'
      const len = (char === '`' ? fenceMatch[3] : fenceMatch[4]).length

      if (!inCodeFence) {
        inCodeFence = true
        fenceChar = char
        fenceLength = len
      } else if (char === fenceChar && len >= fenceLength) {
        // Closing fence: same char, at least as many chars, nothing else after (allow trailing whitespace)
        const afterFence = line.slice(fenceMatch[0].length)
        if (afterFence.trim() === '') {
          inCodeFence = false
        }
      }
      continue
    }

    if (inCodeFence) continue

    const headingMatch = line.match(HEADING_RE)
    if (headingMatch) {
      const level = headingMatch[1].length
      const rawText = line.slice(headingMatch[0].length)
      const cleaned = cleanInlineFormatting(rawText.trim())
      headings.push({ level, text: cleaned, line: i + 1 })
    }
  }

  return headings
}
