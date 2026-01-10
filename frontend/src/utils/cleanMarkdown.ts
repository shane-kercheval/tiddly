/**
 * Clean up markdown output from Milkdown editor.
 *
 * Fixes:
 * - Non-breaking spaces (\u00a0) that Milkdown inserts in certain situations
 * - HTML entities (&nbsp;) that may appear in output
 *
 * Note: List formatting (tight vs loose) is handled by remarkTightLists plugin
 * in MilkdownEditor.tsx, not by post-processing here.
 */
export function cleanMarkdown(markdown: string): string {
  return markdown
    .replace(/\u00a0/g, ' ')       // Convert non-breaking spaces to regular spaces
    .replace(/&nbsp;/gi, ' ')      // Convert &nbsp; HTML entities
    .trim()
}
