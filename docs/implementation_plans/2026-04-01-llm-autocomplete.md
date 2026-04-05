# LLM Auto-Complete PoC

**Date:** 2026-04-05
**Status:** Draft — iterating on plan before implementation
**Depends on:** [LLM Integration](2026-03-18-llm-integration.md) (Milestones 1–3 must be complete)

## Overview

Add auto-complete to the note editor — as the user types, completions appear as ghost text after a debounce pause. This is a PoC with a separate lifecycle from the core suggestion features: it may be iterated heavily, redesigned after chat lands, or scrapped based on quality/latency results.

**Prerequisites from LLM Integration plan:**
- `LLMService` with non-streaming `complete()` method
- `/ai/` router with auth, rate limiting, BYOK header extraction
- AI rate limits enforced per tier
- Cost tracking via Redis

**Key decisions:**
- **Non-streaming** — completions should be short (1-2 sentences), so streaming adds complexity without UX benefit
- **Client-side debounce + cancellation** — avoids flooding the API during rapid typing
- **Ghost text via CodeMirror extension** — native editor integration, not a React overlay

---

## Milestone 1: Backend Endpoint

### Goal & Outcome

After this milestone:

- `POST /ai/complete` — given text before/after cursor, returns a short completion
- Input validation enforced via `max_length` on request fields

### Implementation Outline

#### 1. Request/response schemas

```python
class CompleteRequest(BaseModel):
    prefix: str = Field(max_length=1000)    # text before cursor
    suffix: str = Field(max_length=500)     # text after cursor

class CompleteResponse(BaseModel):
    completion: str   # the suggested continuation
```

Start with ~500 chars before cursor and ~200 chars after from the frontend. The `max_length` values are set higher than the typical send size to allow headroom while still preventing abuse.

#### 2. Endpoint

```python
@router.post("/complete", response_model=CompleteResponse)
async def complete(
    data: CompleteRequest,
    current_user: User = Depends(get_current_user_auth0_only),
    limits: TierLimits = Depends(get_current_limits),
    llm_api_key: str | None = Depends(get_llm_api_key),
):
    config = llm_service.resolve_config(AIUseCase.AUTO_COMPLETE, llm_api_key)
    # Build messages from prompt template + prefix/suffix
    # Call llm_service.complete(...)
    # Track cost via Redis
    # Return completion
```

The prompt instructs the LLM to continue the text naturally — complete the current sentence or add 1-2 sentences. Keep completions short for speed and relevance.

### Testing Strategy

- **Backend:**
  - Valid prefix/suffix → completion returned
  - Empty prefix → still returns something reasonable (start of document)
  - Response is short (prompt instructs brevity)
  - Oversized prefix/suffix → 422 validation error
  - Rate limiting enforced
  - Auth0-only: PAT access → 401

---

## Milestone 2: Frontend Ghost Text Extension

### Goal & Outcome

After this milestone:

- Ghost text appears in the editor after a debounce pause
- Tab accepts, Escape dismisses, continued typing dismisses
- Toggle on/off via setting and keyboard shortcut
- No conflicts with existing CodeMirror autocomplete

### Implementation Outline

#### 1. CodeMirror ghost text extension

A CodeMirror extension that renders suggestion text as ghost text:

- Uses `Decoration.widget()` to insert a styled span after the cursor position
- Styled with reduced opacity (e.g. `opacity: 0.4`, same font)
- **Tab** keymap (high precedence): if ghost text is active AND no autocomplete dropdown is open, accept it (insert into document), consume the key
- **Escape** keymap (high precedence): if ghost text is active, dismiss it, consume the key (prevents closing the note)
- Any other keypress: dismiss ghost text, let the keypress proceed normally

**Tab key conflict resolution:** The existing CodeMirror setup uses `@codemirror/autocomplete` (for slash commands) which also binds Tab. The ghost text Tab handler must check `completionStatus(view.state)` — if the autocomplete dropdown is active, Tab falls through to autocomplete. Ghost text only captures Tab when no other completion UI is open. This prevents the two systems from fighting over the same key.

#### 2. Debounce + cancellation logic

A CodeMirror extension or React hook that:

1. Listens to document changes (typing)
2. On each change, cancels any pending request (`AbortController`)
3. Starts a debounce timer (~300-500ms)
4. After debounce, extracts prefix/suffix around cursor
5. Calls `POST /ai/complete`
6. On response, shows ghost text at current cursor position
7. If cursor has moved since the request was sent, discards the result

```ts
// Simplified flow
const controller = new AbortController()
const timer = setTimeout(async () => {
  const { prefix, suffix } = extractContext(view)
  const response = await aiApi.complete({ prefix, suffix }, controller.signal)
  if (!controller.signal.aborted) {
    showGhostText(view, response.completion)
  }
}, DEBOUNCE_MS)
```

#### 3. Toggle

- User setting stored in localStorage (like line wrap, line numbers)
- Keyboard shortcut to toggle (TBD — e.g. `Ctrl+Shift+Space`)
- Visual indicator in editor toolbar showing on/off state

### Testing Strategy

- **Frontend:**
  - Ghost text appears after debounce period
  - Tab accepts ghost text (text inserted into document)
  - Tab with autocomplete dropdown open → falls through to autocomplete, not ghost text
  - Escape dismisses ghost text
  - Typing dismisses ghost text
  - New typing after dismissal triggers new request
  - Rapid typing doesn't flood requests (debounce works, old requests cancelled)
  - Ghost text not shown if cursor moved since request
  - Toggle on/off works, persists across sessions
  - Disabled for non-Pro users without BYOK
