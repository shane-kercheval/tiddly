/**
 * Clean up text content from Milkdown editor.
 *
 * Fixes:
 * - Non-breaking spaces (\u00a0) that Milkdown inserts in certain situations
 * - HTML entities (&nbsp;) that may appear in output
 * - Escaped underscores (\_) that remark-stringify adds defensively
 * - Escaped angle brackets (\< and \>) that remark-stringify adds for HTML safety
 * - Hex-encoded spaces (&#x20;) that remark-stringify uses to preserve leading whitespace
 *
 * Note: List formatting (tight vs loose) is handled by remarkTightLists plugin
 * in MilkdownEditor.tsx, not by post-processing here.
 *
 * Underscore escaping note: remark-stringify escapes underscores to prevent
 * them from being interpreted as emphasis markers (_italic_). However, since
 * the editor is configured to use * for emphasis, underscores don't need
 * escaping. This is especially important for Jinja2 templates where
 * {{ variable_name }} should not become {{ variable\_name }}.
 *
 * Angle bracket escaping note: remark-stringify escapes < at the start of lines
 * to prevent them from being interpreted as HTML blocks when re-parsed. We
 * unescape these since our use case (prompt templates with XML) requires
 * preserving literal angle brackets.
 */

/**
 * Apply text cleaning transformations to a string.
 * This is the core transformation logic, extracted for reuse.
 */
export function cleanTextContent(text: string): string {
  // Early exit if no special characters to clean (performance optimization)
  // Check for: NBSP (\u00a0), &nbsp;, &#x20;, \_, \<, \>
  // IMPORTANT: This regex must be kept in sync with the replacements below.
  // If you add a new transformation, update this regex to include it.
  if (!/[\u00a0]|&nbsp;|&#x20;|\\_|\\<|\\>/i.test(text)) {
    return text
  }

  return text
    .replace(/\u00a0/g, ' ')       // Convert non-breaking spaces to regular spaces
    .replace(/&nbsp;/gi, ' ')      // Convert &nbsp; HTML entities
    .replace(/&#x20;/g, ' ')       // Convert hex-encoded spaces to regular spaces
    .replace(/\\_/g, '_')          // Remove unnecessary underscore escaping
    .replace(/\\</g, '<')          // Remove unnecessary angle bracket escaping
    .replace(/\\>/g, '>')          // Remove unnecessary angle bracket escaping
}

/**
 * Node types that should NOT be cleaned (their content is literal).
 * - code: fenced code blocks (```...```)
 * - inlineCode: inline code spans (`...`)
 * - html: raw HTML blocks
 */
const SKIP_NODE_TYPES = new Set(['code', 'inlineCode', 'html'])

/**
 * mdast node type for tree traversal.
 */
interface MdastNode {
  type?: string
  value?: string
  children?: MdastNode[]
}

/**
 * Recursively clean text nodes in an mdast tree.
 * Skips code blocks, inline code, and HTML nodes to preserve their literal content.
 */
export function cleanMdastTree(node: unknown): void {
  if (!node || typeof node !== 'object') return

  const n = node as MdastNode

  // Skip code blocks, inline code, and HTML - their content should be preserved literally
  if (n.type && SKIP_NODE_TYPES.has(n.type)) {
    return
  }

  // Clean text node values
  if (n.type === 'text' && typeof n.value === 'string') {
    n.value = cleanTextContent(n.value)
  }

  // Recurse into children
  if (Array.isArray(n.children)) {
    n.children.forEach(cleanMdastTree)
  }
}

/**
 * Clean markdown string (legacy function for backward compatibility).
 *
 * WARNING: This function applies transformations to the entire string,
 * including code blocks. For AST-aware cleaning that preserves code block
 * content, use cleanMdastTree() as a remark plugin instead.
 *
 * @deprecated Use cleanMdastTree via remarkCleanMarkdown plugin instead
 */
export function cleanMarkdown(markdown: string): string {
  return cleanTextContent(markdown)
}
