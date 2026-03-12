# Progressive Character Limit Feedback for Frontend

## Context

The current character limit UX enforces hard limits (via `maxLength` HTML attribute + JS rejection in `handleChange`) and shows a red "Character limit reached (X)" error when at the max. This looks like a validation error even though save is still enabled — confusing and ugly.

**New behavior:** Progressive counter that fades in starting at 70% of max with gradual color transitions, allows text beyond the limit, but disables save and shows red border when exceeded.

Reference: See `docs/implementation_plans/2026-03-11-chrome-extension-text-limits-style.md` for the Chrome Extension implementation which uses the same color palette and behavior spec. The frontend should match the same visual behavior but the implementation details will differ (React components, Tailwind CSS, etc.).

### Behavior Spec

Layout: message on left, count on right. Space is always reserved (to prevent layout shift when the counter appears/disappears).

**Short fields** (title, description, URL, prompt args):

| Range | Left (message) | Right (count) | Color (gradual lerp) | Border | Save |
|-------|---------------|---------------|---------------------|--------|------|
| < 70% | — | — | — | normal | enabled |
| 70% → 85% | — | `70 / 100` | gray `#9ca3af` → dark text `#111827` (light) / `#e0e0e0` (dark) | normal | enabled |
| 85% → 100% | — | `85 / 100` | orange `#d97706` → red `#dc2626` (light) / `#fbbf24` → `#fca5a5` (dark) | normal | enabled |
| = 100% | `Character limit reached` | `100 / 100` | red | normal | enabled |
| > 100% | `Character limit exceeded - saving is disabled` | `105 / 100` | red | **red** | **disabled** |

**Content fields** (ContentEditor — note content, bookmark content, prompt content):

Counter is **always visible** on the right side (not gated by 70% threshold).

| Range | Left (message) | Right (count) | Color | Border | Save |
|-------|---------------|---------------|-------|--------|------|
| < 85% | — | `500 / 5,000` | gray/helper-text (`#9ca3af`) | normal | enabled |
| 85% → 100% | — | `4,500 / 5,000` | orange `#d97706` → red `#dc2626` (light) / `#fbbf24` → `#fca5a5` (dark) | normal | enabled |
| = 100% | `Character limit reached` | `5,000 / 5,000` | red | normal | enabled |
| > 100% | `Character limit exceeded - saving is disabled` | `5,100 / 5,000` | red | **red** | **disabled** |

### Affected Components

These components currently enforce character limits:

1. **`InlineEditableTitle`** — title/name fields (input). Currently: `maxLength` on `<input>`, JS rejection in `handleChange`, red "Character limit reached" error text.
2. **`InlineEditableText`** — description fields (textarea). Currently: `maxLength` on `<textarea>`, JS rejection in `handleChange`, red error text.
3. **`InlineEditableUrl`** — URL field (input). Currently: `maxLength` on `<input>`, JS rejection in `handleChange`, red error text.
4. **`ContentEditor`** — content/body fields (CodeMirror). Currently: shows counter in footer, red "Character limit reached" text, red border on container. Does NOT use `maxLength` (CodeMirror is not a native input).
5. **`ArgumentsBuilder`** — prompt argument name/description fields (inputs). Currently: `maxLength` on inputs, JS rejection, red error text.

Entity components (`Bookmark.tsx`, `Note.tsx`, `Prompt.tsx`) check `field.length <= limit` in their `isValid` computation for `canSave`.

### Shared Utility

`characterLimitMessage(limit)` in `constants/validation.ts` returns `"Character limit reached (2,048)"` — this will be replaced.

---

## Milestone 1: Create `useCharacterLimit` Hook + `CharacterLimitFeedback` Component

### Goal & Outcome

Extract character limit logic into a reusable hook and presentational component that implement the progressive counter behavior. After this milestone:

- A `useCharacterLimit` hook encapsulates all limit-related state (ratio, color, message, exceeded status)
- A `CharacterLimitFeedback` component renders the progressive counter with proper layout
- Color interpolation matches the Chrome Extension palette (gray → text → orange → red)
- Dark mode support via `prefers-color-scheme` media query
- All new code has unit tests
- Nothing is wired up to existing components yet

### Implementation Outline

#### 1. Color utility: `utils/colorLerp.ts`

Create a `lerpColor` function and the color constants. This is a pure utility with no React dependency.

```ts
// RGB tuples for interpolation
const LIMIT_COLORS = {
  gray:        [156, 163, 175],
  textLight:   [17, 24, 39],
  textDark:    [224, 224, 224],
  orangeLight: [217, 119, 6],
  orangeDark:  [251, 191, 36],
  redLight:    [220, 38, 38],
  redDark:     [252, 165, 165],
} as const

function lerpColor(c1: readonly number[], c2: readonly number[], t: number): string { ... }

export function getLimitColor(ratio: number, isDark: boolean): string { ... }
```

The `getLimitColor` function should:
- For ratio 0.7–0.85: lerp gray → text color (light/dark)
- For ratio 0.85–1.0+: lerp orange → red (light/dark)
- Clamp `t` to [0, 1]

#### 2. Hook: `hooks/useCharacterLimit.ts`

```ts
interface CharacterLimitOptions {
  /** When true, counter is always visible and color stays gray below 85% (for content fields) */
  alwaysShow?: boolean
}

interface CharacterLimitResult {
  /** Whether the field has exceeded its limit (> maxLength) */
  exceeded: boolean
  /** Whether the counter should be visible */
  showCounter: boolean
  /** Formatted count string, e.g. "1,234 / 2,048" */
  counterText: string
  /** Message to show on the left, or undefined if no message */
  message: string | undefined
  /** CSS color string for the feedback text */
  color: string
}

export function useCharacterLimit(
  length: number,
  maxLength: number | undefined,
  options?: CharacterLimitOptions,
): CharacterLimitResult
```

- Returns stable defaults when `maxLength` is undefined (exceeded=false, showCounter=false, etc.)
- Uses `window.matchMedia` for dark mode detection (can be a simple check, doesn't need to be reactive — color updates on each render as length changes)
- Message is `undefined` below 100%, `"Character limit reached"` at exactly 100%, `"Character limit exceeded - saving is disabled"` above 100%
- When `alwaysShow: true`: `showCounter` is always true (when maxLength defined), color is gray/helper below 85%, orange→red from 85%+
- When `alwaysShow: false` (default): `showCounter` is true at >=70%, gray→dark text 70–85%, orange→red from 85%+

#### 3. Component: `components/CharacterLimitFeedback.tsx`

A small presentational component that renders the feedback row:

```tsx
interface CharacterLimitFeedbackProps {
  limit: CharacterLimitResult  // from useCharacterLimit
  className?: string
}
```

- Uses `visibility: hidden` (not `display: none`) when `!showCounter` to reserve space
- Flex layout: message on left, count on right
- Sets `style={{ color: limit.color }}` for progressive coloring
- Renders nothing if no `maxLength` was provided (limit result has showCounter=false permanently)

#### 4. Update `constants/validation.ts`

Remove `characterLimitMessage` function. It will be replaced by the hook's `message` field.

**Do NOT do this yet** — just note it for Milestone 2. The function is still imported by existing components.

### Testing Strategy

**`utils/colorLerp.test.ts`:**
- `lerpColor` with t=0 returns first color, t=1 returns second color, t=0.5 returns midpoint
- `getLimitColor` at ratio 0.7 returns gray (both light and dark modes)
- `getLimitColor` at ratio 0.85 returns text color endpoint (light/dark)
- `getLimitColor` at ratio 0.85+epsilon returns orange start (light/dark)
- `getLimitColor` at ratio 1.0 returns red (light/dark)
- `getLimitColor` clamps t above 1.0 (ratio > 1.0 still returns red)

**`hooks/useCharacterLimit.test.ts`:**
- Returns `exceeded=false, showCounter=false` when `maxLength` is undefined
- Returns `showCounter=false` when ratio < 0.7 (default mode)
- Returns `showCounter=true, message=undefined` when ratio is 0.7–0.99
- Returns `message="Character limit reached"` when length === maxLength
- Returns `exceeded=true, message="Character limit exceeded - saving is disabled"` when length > maxLength
- `counterText` formats with `toLocaleString` (e.g., `"1,000 / 2,048"`)
- Color is a valid hex string when showCounter is true
- `alwaysShow: true`: `showCounter=true` even below 70%
- `alwaysShow: true`: color is gray/helper below 85%, transitions orange→red from 85%
- `alwaysShow: true`: still returns `showCounter=false` when `maxLength` is undefined

**`components/CharacterLimitFeedback.test.tsx`:**
- Renders with `visibility: hidden` when `showCounter=false`
- Renders count text when `showCounter=true`
- Renders message on left when message is provided
- Applies color via inline style
- Does not render message span when message is undefined

---

## Milestone 2: Integrate into Inline Editable Components

### Goal & Outcome

Wire up the new progressive character limit to `InlineEditableTitle`, `InlineEditableText`, and `InlineEditableUrl`. After this milestone:

- All three components show progressive counter instead of binary "limit reached" error
- `maxLength` HTML attribute is removed (users can type/paste beyond the limit)
- The JS `handleChange` rejection (`if (newValue.length > maxLength) return`) is removed — text beyond the limit is allowed
- Red border (ring) appears only when exceeded (> 100%), not at exactly 100%
- Each component exposes an `exceeded` state so parent forms can use it
- `characterLimitMessage` is removed from `constants/validation.ts` (no more imports)

### Implementation Outline

#### 1. Update `InlineEditableTitle`

- Remove `maxLength` from `<input>` element
- Remove the `handleChange` length rejection
- Remove `limitReached` / `displayError` logic for character limits (keep `error` prop for parent-provided errors like "Title is required")
- Add `useCharacterLimit(value.length, maxLength)` hook
- Add `onExceededChange?: (exceeded: boolean) => void` callback prop — called when exceeded state changes, so parent forms can track it
- Replace the error paragraph for limit messages with `<CharacterLimitFeedback>`
- Red ring/border: apply when `limit.exceeded` (not when `limitReached` which was at >= 100%)
- Keep parent `error` prop rendering separate from character limit feedback

#### 2. Update `InlineEditableText`

Same pattern as `InlineEditableTitle`:
- Remove `maxLength` from `<textarea>`
- Remove `handleChange` length rejection
- Use `useCharacterLimit` + `CharacterLimitFeedback`
- Add `onExceededChange` callback
- Red ring only when exceeded

#### 3. Update `InlineEditableUrl`

Same pattern:
- Remove `maxLength` from `<input>`
- Remove `handleChange` length rejection
- Use `useCharacterLimit` + `CharacterLimitFeedback`
- Add `onExceededChange` callback
- Red ring only when exceeded

#### 4. Remove `characterLimitMessage` from `constants/validation.ts`

Delete the function and its imports from all components. At this point all consumers use the new hook.

### Testing Strategy

For each of the three components, test:

**Core behavior:**
- Does not set `maxLength` on the input/textarea element
- Allows typing beyond the limit (onChange is called with overlength text)
- Shows no feedback below 70% of max
- Shows counter at 70%+ of max
- Shows "Character limit reached" at exactly 100%
- Shows "Character limit exceeded - saving is disabled" above 100%
- Shows red ring/border only when exceeded (> 100%), not at exactly 100%
- Calls `onExceededChange(true)` when going from within-limit to exceeded
- Calls `onExceededChange(false)` when going from exceeded back to within-limit

**Interaction with parent errors:**
- Parent `error` prop still displays correctly alongside/independent of character limit feedback

**Regression:**
- Existing functionality (placeholder, disabled, onEnter, etc.) still works

---

## Milestone 3: Integrate into ContentEditor

### Goal & Outcome

Update `ContentEditor` to use the new progressive character limit system. After this milestone:

- Content editor footer always shows the counter on the right (not gated by focus or 70%)
- Counter color is gray/helper below 85%, transitions orange→red from 85%+
- Red border on editor container only when exceeded (> 100%)
- `onExceededChange` callback for parent form integration
- `limitReached` logic removed from ContentEditor

### Implementation Outline

`ContentEditor` is different from the inline components because:
- It uses CodeMirror (not a native input), so there was never a `maxLength` attribute
- It already has a footer with a counter and helper text
- The counter currently shows only when focused or at limit — new behavior: always visible

Changes:
- Remove `limitReached` / `contentDisplayError` logic
- Add `useCharacterLimit(value.length, maxLength, { alwaysShow: true })` hook — counter always visible, gray below 85%
- Add `onExceededChange?: (exceeded: boolean) => void` prop
- Update footer to use `CharacterLimitFeedback` component instead of the custom counter/error layout
- The counter is always visible (not gated by focus), so the footer opacity logic should ensure the counter is always shown when `maxLength` is provided. Helper text can still use the focus-based opacity.
- Red border on container: only when `limit.exceeded`, not when `limitReached`
- Helper text display should work alongside the new CharacterLimitFeedback (helper text is shown on the left when there's no limit message)

### Testing Strategy

- Counter always visible in footer when `maxLength` is provided (even when unfocused, even below 85%)
- Counter color is gray/helper-text below 85%
- Counter transitions orange→red from 85% to 100%
- "Character limit reached" at 100% without red border
- "Character limit exceeded" above 100% with red border on container
- Calls `onExceededChange` when exceeded state changes
- Helper text still displays on the left when no limit message is showing
- No counter shown when `maxLength` is not provided (existing behavior)

---

## Milestone 4: Integrate into ArgumentsBuilder

### Goal & Outcome

Update `ArgumentsBuilder` to use the new progressive character limit for argument name and description fields. After this milestone:

- Argument name and description fields show progressive counter
- Users can type beyond limits
- Parent form can detect when any argument field is exceeded

### Implementation Outline

`ArgumentsBuilder` is trickier because it has multiple rows, each with two limited fields (name, description). The component needs to communicate whether ANY argument field is exceeded.

- Add `onExceededChange?: (exceeded: boolean) => void` prop to `ArgumentsBuilder`
- In `ArgumentRow`, use `useCharacterLimit` for both name and description fields
- Remove `maxLength` from both inputs
- Remove the `handleChange` length rejection for both fields
- Remove the inline limit error paragraphs, replace with `CharacterLimitFeedback`
- `ArgumentRow` reports its exceeded state up to `ArgumentsBuilder` via callback
- `ArgumentsBuilder` aggregates: any row exceeded → call `onExceededChange(true)`
- Keep the pattern validation error for argument names (the `ARG_NAME_PATTERN` check) — that's separate from character limits

### Testing Strategy

- Argument name input does not have `maxLength` attribute
- Argument description input does not have `maxLength` attribute
- Progressive counter appears at 70% for both name and description
- "Character limit exceeded" shown when either name or description exceeds limit
- `onExceededChange(true)` called when any argument field exceeds
- `onExceededChange(false)` called when all argument fields are back within limits
- Pattern validation error for names still works independently of character limits
- Adding/removing arguments correctly updates exceeded state

---

## Milestone 5: Update Entity Form Validation (Bookmark, Note, Prompt)

### Goal & Outcome

Update the entity form components to use the `onExceededChange` callbacks from their child components to disable save when any field is exceeded. After this milestone:

- Save button is disabled when any field exceeds its character limit
- The `isValid` computation no longer needs to check `field.length <= limit` for character limits (the exceeded state is tracked via callbacks)
- All entity forms (Bookmark, Note, Prompt) have consistent behavior
- Full end-to-end flow works: type beyond limit → counter turns red → exceeded message shows → save disabled → delete characters → counter goes orange → save re-enabled

### Implementation Outline

In each entity component (`Bookmark.tsx`, `Note.tsx`, `Prompt.tsx`):

1. Add state to track exceeded status for each field: e.g., `const [fieldsExceeded, setFieldsExceeded] = useState<Record<string, boolean>>({})`. Use a helper like `const anyExceeded = Object.values(fieldsExceeded).some(Boolean)`.

2. Pass `onExceededChange` callbacks to each child component:
   ```tsx
   <InlineEditableTitle
     maxLength={limits?.max_title_length}
     onExceededChange={(exceeded) => setFieldsExceeded(prev => ({ ...prev, title: exceeded }))}
   />
   ```

3. Update `canSave`: incorporate `anyExceeded` into the save disable logic. The `isValid` useMemo can remove the `field.length <= limit` checks for character-limited fields since that's now handled by the exceeded tracking. Keep other validation (e.g., URL format, required fields, name pattern).

4. Pass `onExceededChange` from `ContentEditor` and `ArgumentsBuilder` similarly.

### Testing Strategy

For each entity form (can focus on Note.tsx for thorough testing, lighter tests for Bookmark/Prompt since pattern is identical):

- Save button disabled when title exceeds limit
- Save button disabled when description exceeds limit
- Save button disabled when content exceeds limit
- Save button disabled when URL exceeds limit (Bookmark only)
- Save button disabled when any argument field exceeds limit (Prompt only)
- Save button re-enabled when all fields come back within limits
- Save button still disabled when form is not dirty (existing behavior preserved)
- Save button still disabled for other validation failures (empty title, invalid URL, etc.)
- Save button still works correctly when limits haven't loaded yet (treat as no limit)
