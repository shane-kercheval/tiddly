/**
 * Clean up markdown output from Milkdown editor.
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
export function cleanMarkdown(markdown: string): string {
  // Early exit if no special characters to clean (performance optimization)
  // Check for: NBSP (\u00a0), &nbsp;, &#x20;, \_, \<, \>
  if (!/[\u00a0]|&nbsp;|&#x20;|\\_|\\<|\\>/i.test(markdown)) {
    return markdown.trim()
  }

  return markdown
    .replace(/\u00a0/g, ' ')       // Convert non-breaking spaces to regular spaces
    .replace(/&nbsp;/gi, ' ')      // Convert &nbsp; HTML entities
    .replace(/&#x20;/g, ' ')       // Convert hex-encoded spaces to regular spaces
    .replace(/\\_/g, '_')          // Remove unnecessary underscore escaping
    .replace(/\\</g, '<')          // Remove unnecessary angle bracket escaping
    .replace(/\\>/g, '>')          // Remove unnecessary angle bracket escaping
    .trim()
}
