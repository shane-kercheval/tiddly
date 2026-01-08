/**
 * Clean up markdown output from Milkdown editor.
 *
 * Fixes:
 * - Non-breaking spaces (\u00a0) that Milkdown inserts in certain situations
 * - HTML entities (&nbsp;) that may appear in output
 * - Excessive newlines (more than 2 consecutive) collapsed to single blank line
 *
 * Note: <br /> tags are no longer an issue since we excluded
 * remarkPreserveEmptyLinePlugin from the commonmark preset.
 */
export function cleanMarkdown(markdown: string): string {
  return markdown
    .replace(/\u00a0/g, ' ')       // Convert non-breaking spaces to regular spaces
    .replace(/&nbsp;/gi, ' ')      // Convert &nbsp; HTML entities
    .replace(/\n{3,}/g, '\n\n')    // Collapse excessive newlines (3+ → 2)
    .trim()
}
