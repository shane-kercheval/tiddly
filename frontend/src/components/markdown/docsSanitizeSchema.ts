/**
 * Sanitize schema for docs/legal prose rendered by `DocsMarkdown`.
 *
 * This is deliberately NOT `TipBody`'s schema: tip bodies strip `h1`–`h6` so a
 * tip can't inject mid-page headings, but docs prose IS structured by headings
 * and would lose its outline under that schema. We start from `rehype-sanitize`'s
 * default (GitHub) schema — which already permits headings and GFM table
 * elements — and add only the `class` attribute on `blockquote`, which the
 * `remarkCallouts` plugin uses to mark alert callouts (`> [!variant]`).
 *
 * Raw HTML is still not enabled (no `rehype-raw`); prose is markdown only.
 */
import { defaultSchema } from 'rehype-sanitize'

export const docsSanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    blockquote: [...(defaultSchema.attributes?.blockquote ?? []), 'className'],
  },
}
