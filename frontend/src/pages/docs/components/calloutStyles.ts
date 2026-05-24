/**
 * Callout variant styling, shared between the legacy `<InfoCallout>` component
 * and the markdown renderer's `> [!variant]` blockquote lowering so both render
 * identical callouts. Kept in its own module (not in `InfoCallout.tsx`) so each
 * component file exports only components (react-refresh constraint).
 */
export type CalloutVariant = 'info' | 'warning' | 'tip'

export const VARIANT_STYLES: Record<CalloutVariant, string> = {
  info: 'bg-blue-50 border-blue-200 text-blue-800',
  warning: 'bg-amber-50 border-amber-200 text-amber-800',
  tip: 'bg-gray-50 border-gray-200 text-gray-700',
}
