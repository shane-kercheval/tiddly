/**
 * Clean up markdown output from Milkdown editor.
 *
 * Fixes:
 * - Non-breaking spaces (\u00a0) that Milkdown inserts in certain situations
 * - HTML entities (&nbsp;) that may appear in output
 * - Escaped underscores (\_) that remark-stringify adds defensively
 *
 * Note: List formatting (tight vs loose) is handled by remarkTightLists plugin
 * in MilkdownEditor.tsx, not by post-processing here.
 *
 * Underscore escaping note: remark-stringify escapes underscores to prevent
 * them from being interpreted as emphasis markers (_italic_). However, since
 * the editor is configured to use * for emphasis, underscores don't need
 * escaping. This is especially important for Jinja2 templates where
 * {{ variable_name }} should not become {{ variable\_name }}.
 */
export function cleanMarkdown(markdown: string): string {
  return markdown
    .replace(/\u00a0/g, ' ')       // Convert non-breaking spaces to regular spaces
    .replace(/&nbsp;/gi, ' ')      // Convert &nbsp; HTML entities
    .replace(/\\_/g, '_')          // Remove unnecessary underscore escaping
    .trim()
}
