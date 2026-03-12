# Progressive Character Counter for Chrome Extension

## Context

The current character limit UX shows a red "Character limit reached (X)" message at max and enforces `maxLength` on inputs, preventing users from typing past the limit. This looks like a validation error even though save is still enabled — confusing and ugly.

**New behavior:** Show a progressive counter from 70% of max with gradual color transitions via linear interpolation, allow text beyond the limit (remove `maxLength`), and disable save when exceeded.

## Files to Modify

- `chrome-extension/popup-core.js` — core logic changes
- `chrome-extension/popup.css` — `.field-limit` base styles, `input-exceeded` border class
- `chrome-extension/popup.html` — remove `hidden` attribute from `.field-limit` spans (visibility now controlled via CSS `visibility` property)
- `chrome-extension/test/popup-core.test.js` — rewrite feedback tests, add save-disable tests

---

## Milestone 1: CSS + JS Core Logic (color interpolation, feedback, save-disable)

### Goal & Outcome

Replace the binary "limit reached" feedback with a progressive character counter that uses linear color interpolation. Users can type beyond the limit but save is disabled when either field exceeds its max.

After this milestone:
- Counter appears at 70% of max, transitions through gray → text → orange → red
- Text beyond 100% shows exceeded message with red border, save button disabled
- Dark mode uses appropriate color endpoints
- All existing and new tests pass

### Implementation Outline

#### CSS (`popup.css`)

1. **Replace** the existing `.field-limit` block (lines 281-292) with layout styles for left/right content. Space is always reserved (`visibility` instead of `display:none`) to avoid layout shift. Color is set via inline `style.color` from JS:

```css
.field-limit {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  min-height: 14px;
  margin-top: 2px;
  visibility: hidden;
}
```

2. **Remove** the dark mode `@media` block for `.field-limit` (lines 288-292) — color is handled in JS.

3. **Add** red border class for exceeded inputs (after the `.field-limit` rules):

```css
input.input-exceeded,
textarea.input-exceeded {
  border-color: #dc2626;
}

@media (prefers-color-scheme: dark) {
  input.input-exceeded,
  textarea.input-exceeded {
    border-color: #fca5a5;
  }
}
```

#### JS (`popup-core.js`)

1. **Remove** `characterLimitMessage` function and its export.

2. **Add module-level state**: `let saving = false;` — add reset in `resetState()`.

3. **Add** color interpolation helper (not exported — internal only):

```js
function lerpColor(c1, c2, t) {
  return '#' + c1.map((v, i) =>
    Math.round(v + (c2[i] - v) * t).toString(16).padStart(2, '0')
  ).join('');
}

const COLORS = {
  gray:        [156, 163, 175],  // #9ca3af
  textLight:   [17, 24, 39],    // #111827
  textDark:    [224, 224, 224],  // #e0e0e0
  orangeLight: [217, 119, 6],   // #d97706
  orangeDark:  [251, 191, 36],  // #fbbf24
  redLight:    [220, 38, 38],   // #dc2626
  redDark:     [252, 165, 165], // #fca5a5
};

function getLimitColor(ratio) {
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (ratio <= 0.85) {
    const t = (ratio - 0.7) / 0.15;
    return lerpColor(COLORS.gray, dark ? COLORS.textDark : COLORS.textLight, t);
  }
  const t = (ratio - 0.85) / 0.15;
  const from = dark ? COLORS.orangeDark : COLORS.orangeLight;
  const to = dark ? COLORS.redDark : COLORS.redLight;
  return lerpColor(from, to, Math.min(t, 1));
}
```

4. **Add** exported message helpers:

```js
export function counterText(current, max) {
  return `${current.toLocaleString()} / ${max.toLocaleString()}`;
}
```

5. **Add** internal helper to set left/right content in the feedback element. The feedback `<span>` is now a flex container; this helper sets a left-side message and a right-side count as child elements:

```js
function setFeedbackContent(feedbackEl, { message, count }) {
  feedbackEl.replaceChildren();
  if (message) {
    const msg = document.createElement('span');
    msg.textContent = message;
    feedbackEl.appendChild(msg);
  }
  if (count) {
    const cnt = document.createElement('span');
    cnt.textContent = count;
    feedbackEl.appendChild(cnt);
  }
}
```

6. **Refactor `updateLimitFeedback`** — now returns `boolean` (true = exceeded). Uses `visibility` instead of `hidden` attribute for space reservation. Layout: message on left, count on right.

```js
export function updateLimitFeedback(input, feedbackEl, maxLength) {
  const len = input.value.length;
  const ratio = len / maxLength;
  const count = counterText(len, maxLength);

  input.classList.remove('input-exceeded');

  if (ratio < 0.7) {
    feedbackEl.style.visibility = 'hidden';
    feedbackEl.replaceChildren();
    feedbackEl.style.color = '';
    return false;
  }

  feedbackEl.style.visibility = 'visible';
  feedbackEl.style.color = getLimitColor(ratio);

  if (ratio > 1) {
    setFeedbackContent(feedbackEl, {
      message: 'Character limit exceeded - saving is disabled',
      count,
    });
    input.classList.add('input-exceeded');
    return true;
  }

  if (ratio >= 1) {
    setFeedbackContent(feedbackEl, {
      message: 'Character limit reached',
      count,
    });
    return false;
  }

  setFeedbackContent(feedbackEl, { count });
  return false;
}
```

6. **Add `updateSaveButtonState()`** (exported):

```js
export function updateSaveButtonState() {
  if (!limits || saving) return;
  const titleExceeded = updateLimitFeedback(titleInput, titleLimit, limits.max_title_length);
  const descExceeded = updateLimitFeedback(descriptionInput, descriptionLimit, limits.max_description_length);
  saveBtn.disabled = titleExceeded || descExceeded;
}
```

7. **Modify `applyLimits`** — remove the two `maxLength` assignment lines. Keep `pageContent` truncation.

8. **Modify `initSaveForm`**:
   - Remove `substring()` truncation on scraped title/description (lines 248-249). Set `titleInput.value = pageData.title || ''` and `descriptionInput.value = pageData.description || ''` directly. If scraped text exceeds the limit, the user sees the exceeded feedback and save is disabled — they can edit it down.
   - Replace direct `updateLimitFeedback` calls in event listeners and initial check with `updateSaveButtonState()`. In the input event listeners, call `saveDraft()` then `updateSaveButtonState()`.

9. **Modify `handleSave`**:
   - Remove the `substring()` calls for title and description — save is disabled when exceeded so these can never truncate. Send `titleInput.value` and `descriptionInput.value` directly. Keep `pageContent.substring()` since that truncation happens at data-load time in `applyLimits`, not gated by save-disable.
   - Set `saving = true` at start
   - Set `saving = false` in `finally`
   - In the `finally` failure path: call `updateSaveButtonState()` instead of `saveBtn.disabled = false` — this re-evaluates whether save should be disabled based on current field state

### Behavior Spec

Layout: message on left, count on right (flex with `justify-content: space-between`). Space is always reserved via `min-height: 14px` and `visibility: hidden/visible` to prevent layout shift.

| Range | Left (message) | Right (count) | Color (gradual) | Border | Save |
|-------|---------------|---------------|-----------------|--------|------|
| < 70% | — | — | — | normal | enabled |
| 70% → 85% | — | `70 / 100` | `#9ca3af` → `#111827` (light) / `#e0e0e0` (dark) | normal | enabled |
| 85% → 100% | — | `85 / 100` | `#d97706` → `#dc2626` (light) / `#fbbf24` → `#fca5a5` (dark) | normal | enabled |
| = 100% | `Character limit reached` | `100 / 100` | red | normal | enabled |
| > 100% | `Character limit exceeded - saving is disabled` | `105 / 100` | red | **red** | **disabled** |

### Testing Strategy

**Remove:**
- `characterLimitMessage` test block (no longer exists)

**Add tests for `counterText`:**
- `counterText(70, 100)` → `"70 / 100"`
- `counterText(1000, 5000)` → uses `toLocaleString()` formatting

**Rewrite `updateLimitFeedback` tests** — cover all bands:
- Below 70%: `visibility` is `hidden`, no child elements
- At 70%: `visibility` is `visible`, count on right (`"70 / 100"`), no left message, `style.color` is set
- At 85%: count on right, no left message, color changes from previous band
- At exactly 100%: left message is `"Character limit reached"`, right count is `"100 / 100"`, returns false
- Above 100%: left message is `"Character limit exceeded - saving is disabled"`, right count is `"105 / 100"`, returns true, adds `input-exceeded` class on input
- Clears `input-exceeded` class, inline color, and child elements when transitioning back below 70%

**Update `applyLimits` test:**
- Verify `maxLength` is NOT set on inputs (remove the assertion that checks for maxLength)

**Add `updateSaveButtonState` tests:**
- Disables save when title exceeds its limit
- Disables save when description exceeds its limit
- Re-enables save when both fields are within limits
- No-op when `limits` is null (does not throw)

**Update `initSaveForm` integration tests:**
- "applies cached limits" — remove `maxLength` assertion, verify `applyLimits` does not set `maxLength`
- "shows limit feedback if pre-populated values are at the limit" — update to check for `"Character limit reached"` on left and `"100 / 100"` on right
- "truncates scraped title/description to server limits" — update: title/description are no longer truncated. If scraped text exceeds limits, the full text is set and `updateSaveButtonState` shows exceeded feedback with save disabled
- "shows exceeded feedback and disables save when scraped data exceeds limits" — new test: mock scraped title longer than limit, verify save button is disabled and exceeded message is shown

**Update `handleSave` tests:**
- Remove the "truncates title/description using dynamic limits" test — save is now disabled when exceeded, so `handleSave` never truncates title/description
- Keep the "truncates content using limits.max_bookmark_content_length" test — `pageContent` truncation still happens in `applyLimits`

**Update test imports:**
- Remove `characterLimitMessage` from imports
- Add `counterText`, `updateSaveButtonState` to imports

**Add `matchMedia` mock to `setup.js`** in the `beforeEach` block:
```js
window.matchMedia = vi.fn((query) => ({ matches: false, media: query }));
```
This makes `getLimitColor` deterministic (defaults to light mode). Add at least one `updateLimitFeedback` dark mode variant test that overrides the mock to return `{ matches: true }`.

Run `make chrome-ext-tests` to verify all tests pass.
