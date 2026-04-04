# LLM Integration

**Date:** 2026-03-18
**Status:** Draft — iterating on plan before implementation

## Overview

Add AI-powered features to tiddly.me using LiteLLM as the provider abstraction layer. This plan covers the backend service layer, suggestion features (backend + frontend), and auto-complete PoC — all gated by tier and rate limits. Chat, context management, and selection-action features (transform/improve/explain) are deferred to a [separate implementation plan](2026-04-02-llm-chat.md) — they depend on chat infrastructure and a context management strategy that warrants its own design.

**Key decisions:**
- **LiteLLM SDK** (in-process, no proxy) for provider abstraction. The SDK is a pure translation layer that calls provider APIs (OpenAI, Anthropic, Google, etc.) directly — no LiteLLM servers involved.
- **Pro tier** gets AI features with platform keys (Gemini 2.5 Flash Lite as default model — cheapest viable option at $0.10/$0.40 per M tokens in/out)
- **BYOK (Bring Your Own Key)** lets users bypass platform rate limits and choose their own model/provider
- **User API keys** stored in browser `localStorage`, passed via `X-LLM-Api-Key` header, never persisted server-side
- **All AI endpoints** live under a new `/ai/` router

**References:**
- LiteLLM docs: https://docs.litellm.ai/docs/
- LiteLLM async: https://docs.litellm.ai/docs/completion/stream (`acompletion`)
- LiteLLM structured output: https://docs.litellm.ai/docs/completion/json_mode (Pydantic `response_format`)
- LiteLLM provider prefixes: https://docs.litellm.ai/docs/providers (e.g. `gemini/`, `anthropic/`)
- Sandbox PoC notebook: `sandbox/litellm.ipynb`

---

## Milestone 1: Backend LLM Service Layer & AI Router Foundation

### Goal & Outcome

Establish the backend infrastructure for all AI features. After this milestone:

- A new `LLMService` wraps LiteLLM with use-case-based model resolution, key routing (platform vs BYOK), and error handling
- A new `/ai/` router exists with proper auth, rate limiting, and a health-check endpoint
- AI rate limits are enforced per tier (new `ai` operation type), with separate BYOK limits
- Per-call cost tracking via Redis (per-user + per-use-case/model/key-source granularity)
- A daily Railway cron job flushes Redis cost data to a DB summary table
- The foundation is reusable by all subsequent milestones

### Implementation Outline

#### 1. LLM Service (`backend/src/services/llm_service.py`)

Thin wrapper around LiteLLM. Uses use-case-based model resolution — different features can use different models without code changes.

```python
from litellm import acompletion, completion_cost
from pydantic import BaseModel
from enum import StrEnum

class KeySource(StrEnum):
    PLATFORM = "platform"
    USER = "user"

class AIUseCase(StrEnum):
    SUGGESTIONS = "suggestions"   # tags, title, description, relationships — fast & cheap
    TRANSFORM = "transform"       # improve, summarize, explain — medium quality
    COMPLETION = "completion"     # auto-complete — fast & cheap
    CHAT = "chat"                 # conversational — higher quality

class LLMConfig:
    """Resolved config for a single LLM call."""
    model: str            # e.g. "gemini/gemini-2.5-flash-lite"
    api_key: str          # platform key or user-provided key
    key_source: KeySource

class LLMService:
    def __init__(self, settings: Settings):
        # Platform configs per use case, built from settings at startup
        self._platform_configs: dict[AIUseCase, LLMConfig] = {
            AIUseCase.SUGGESTIONS: LLMConfig(
                model=settings.llm_model_suggestions,
                api_key=self._resolve_platform_key(settings.llm_model_suggestions, settings),
                key_source=KeySource.PLATFORM,
            ),
            AIUseCase.TRANSFORM: LLMConfig(
                model=settings.llm_model_transform,
                api_key=self._resolve_platform_key(settings.llm_model_transform, settings),
                key_source=KeySource.PLATFORM,
            ),
            AIUseCase.COMPLETION: LLMConfig(
                model=settings.llm_model_completion,
                api_key=self._resolve_platform_key(settings.llm_model_completion, settings),
                key_source=KeySource.PLATFORM,
            ),
            AIUseCase.CHAT: LLMConfig(
                model=settings.llm_model_chat,
                api_key=self._resolve_platform_key(settings.llm_model_chat, settings),
                key_source=KeySource.PLATFORM,
            ),
        }

    @staticmethod
    def _resolve_platform_key(model: str, settings: Settings) -> str:
        """Determine which provider API key to use based on model prefix."""
        # e.g. "gemini/..." → settings.gemini_api_key
        #      "anthropic/..." → settings.anthropic_api_key
        #      "gpt-..." or "openai/..." → settings.openai_api_key
        ...

    def resolve_config(
        self,
        use_case: AIUseCase,
        user_api_key: str | None = None,
        user_model: str | None = None,
    ) -> LLMConfig:
        """Determine which key and model to use.
        - If user provides a key: use their key + their model (or use-case default model)
        - Otherwise: use platform key + use-case model (ignore user model choice)
        """
        if user_api_key:
            return LLMConfig(
                model=user_model or self._platform_configs[use_case].model,
                api_key=user_api_key,
                key_source=KeySource.USER,
            )
        return self._platform_configs[use_case]

    async def complete(
        self,
        messages: list[dict],
        config: LLMConfig,
        response_format: type[BaseModel] | None = None,
        temperature: float = 0.7,
    ) -> ...:
        """Non-streaming completion. Used by suggestion/transform/completion features."""
        response = await acompletion(
            model=config.model,
            messages=messages,
            api_key=config.api_key,
            response_format=response_format,
            temperature=temperature,
        )
        # Cost is available directly for non-streaming
        # response._hidden_params['response_cost']
        return response

    async def stream(
        self,
        messages: list[dict],
        config: LLMConfig,
        temperature: float = 0.7,
    ) -> AsyncIterator:
        """Streaming completion. Used by chat."""
        return await acompletion(
            model=config.model,
            messages=messages,
            api_key=config.api_key,
            temperature=temperature,
            stream=True,
        )
```

**Design decisions:**
- **Singleton** — created once at startup, injected via FastAPI dependency. Stateless, so no concurrency issues.
- **Use-case model mapping** — each `AIUseCase` maps to a model via env vars. Changing a use case's model is a config change, not a code change.
- **Provider key resolution** — `_resolve_platform_key` parses the model prefix (`gemini/` → `GEMINI_API_KEY`, `anthropic/` → `ANTHROPIC_API_KEY`, etc.) so switching a use case to a different provider automatically picks up the right key.

#### 2. Settings additions (`backend/src/core/config.py`)

Add new env vars — per-use-case models + per-provider API keys:

```python
# LLM models per use case
llm_model_suggestions: str = "gemini/gemini-2.5-flash-lite"
llm_model_transform: str = "gemini/gemini-2.5-flash-lite"
llm_model_completion: str = "gemini/gemini-2.5-flash-lite"
llm_model_chat: str = "gemini/gemini-2.5-flash"

# Provider API keys (only needed for providers referenced by models above)
gemini_api_key: str = ""
openai_api_key: str = ""
anthropic_api_key: str = ""
```

#### 3. AI rate limits (`backend/src/core/tier_limits.py`)

Add a new `ai` category to `TierLimits` with separate BYOK limits:

```python
# AI rate limits (platform key)
rate_ai_per_minute: int
rate_ai_per_day: int
# AI rate limits (BYOK — user provides their own key)
rate_ai_byok_per_minute: int
rate_ai_byok_per_day: int
```

Proposed values:

| Tier | AI/min | AI/day | BYOK AI/min | BYOK AI/day |
|------|--------|--------|-------------|-------------|
| Free | 0 | 0 | 0 | 0 |
| Standard | 0 | 0 | 0 | 0 |
| Pro | 15 | 100 | 60 | 1000 |
| Dev | 1000 | 10000 | 1000 | 10000 |

The rate limit check will select platform or BYOK limits based on whether `X-LLM-Api-Key` header is present.

#### 4. Rate limit integration

Add `AI` to the `OperationType` enum in `rate_limit_config.py`. The `/ai/*` path prefix maps to this operation type. The rate limit middleware/dependency needs to know whether the request is BYOK to select the right limits.

#### 5. Cost tracking via Redis

After each LLM call, record cost and request count in Redis using pipelined `HINCRBYFLOAT`/`HINCRBY`. Two keys per call:

```
# Per-user daily totals (for user dashboards, budget caps)
ai_stats:user:{user_id}:{date}
  → fields: cost (float), count (int)

# Per-dimension breakdown (for operational analytics)
ai_stats:detail:{date}:{use_case}:{model}:{key_source}
  → fields: cost (float), count (int)
```

All keys get a 7-day TTL as a safety net.

**Cost calculation:**
- Non-streaming: use `response._hidden_params['response_cost']` directly (works for all providers)
- Streaming: use `completion_cost(model=model, prompt=prompt_text, completion=full_response_text)` after stream is consumed (verified in PoC notebook — `_hidden_params['response_cost']` returns `0.0` for streaming across all providers)

Redis update is fire-and-forget (wrapped in try/except, never blocks the response). If Redis is down, the call still succeeds — cost data is lost for that call but the user isn't affected.

```python
# In LLMService or a helper called after each LLM call
async def track_cost(
    redis: RedisClient,
    user_id: int,
    use_case: AIUseCase,
    model: str,
    key_source: KeySource,
    cost: float,
) -> None:
    date = datetime.utcnow().strftime("%Y-%m-%d")
    ttl = 7 * 86400  # 7 days

    pipe = await redis.pipeline()
    if pipe is None:
        return

    user_key = f"ai_stats:user:{user_id}:{date}"
    detail_key = f"ai_stats:detail:{date}:{use_case}:{model}:{key_source}"

    pipe.hincrbyfloat(user_key, "cost", cost)
    pipe.hincrby(user_key, "count", 1)
    pipe.expire(user_key, ttl)
    pipe.hincrbyfloat(detail_key, "cost", cost)
    pipe.hincrby(detail_key, "count", 1)
    pipe.expire(detail_key, ttl)

    await pipe.execute()
```

#### 6. Daily cost flush — DB table + Railway cron

**DB table** (`ai_usage_daily`):

```
date        DATE
use_case    VARCHAR     -- suggestions, chat, completion, transform
model       VARCHAR     -- gemini/gemini-2.5-flash-lite, etc.
key_source  VARCHAR     -- platform, user
user_id     INT         (nullable — NULL for detail rows, set for per-user rows)
cost        DECIMAL
count       INT
```

Both per-user and per-dimension stats go in the same table. Detail rows have `user_id = NULL`.

**Railway cron service** — runs daily at 00:30 UTC. Uses the same `Dockerfile.api` as the API service with a different start command. This shares all backend code (DB models, Redis client, settings) without duplication.

Railway configuration:
- Dockerfile: `Dockerfile.api` (same as API)
- Start command override: `uv run python -m tasks.daily`
- Schedule: `30 0 * * *`

The `tasks.daily` entrypoint (`backend/src/tasks/daily.py`) runs all daily tasks sequentially:
1. Flush AI usage from Redis to DB
2. Cleanup trash (soft-deleted items past retention)
3. Cleanup old history records

Each task logs its results. If one fails, it logs the error and continues to the next.

The flush step:
1. Scan for yesterday's keys (`ai_stats:user:*:{yesterday}` and `ai_stats:detail:{yesterday}:*`)
2. Read all hashes
3. Upsert summary rows into `ai_usage_daily`
4. Delete processed keys only after successful DB write

**Note:** `litellm` must be moved from dev dependencies to main dependencies in `pyproject.toml` before deploying (currently only installed with `--no-dev` excluded).

#### 7. AI Router (`backend/src/api/routers/ai.py`)

```python
router = APIRouter(prefix="/ai", tags=["ai"])

@router.get("/health")
async def ai_health(
    current_user: User = Depends(get_current_user),
    limits: TierLimits = Depends(get_current_limits),
    llm_api_key: str | None = Depends(get_llm_api_key),
):
    """Check if AI features are available for this user."""
    has_byok = llm_api_key is not None
    return {
        "available": limits.rate_ai_per_day > 0 or (has_byok and limits.rate_ai_byok_per_day > 0),
        "byok": has_byok,
        "use_case_models": {
            uc.value: llm_service.get_model_for_use_case(uc)
            for uc in AIUseCase
        },
    }
```

#### 8. BYOK header extraction

A new dependency that optionally extracts the user's API key from the `X-LLM-Api-Key` header. This is separate from auth — the user is still authenticated via JWT/PAT as normal.

```python
def get_llm_api_key(request: Request) -> str | None:
    return request.headers.get("X-LLM-Api-Key")
```

#### 9. Register router in `api/main.py`

Add `app.include_router(ai_router)` alongside existing routers.

### Testing Strategy

- **Unit tests for LLMService:**
  - `resolve_config(SUGGESTIONS)` returns platform config with correct model
  - `resolve_config(CHAT)` returns a different model than `resolve_config(SUGGESTIONS)` (when configured differently)
  - `resolve_config` with user key → `KeySource.USER`, uses user's key
  - `resolve_config` with user key + user model → uses both
  - `resolve_config` with user key + no model → falls back to use-case default model
  - `resolve_config` without user key → `KeySource.PLATFORM`, ignores user model choice
  - `_resolve_platform_key` correctly maps `gemini/...` → gemini key, `anthropic/...` → anthropic key, `gpt-...` → openai key
  - `_resolve_platform_key` raises clear error for unknown provider prefix
  - `complete` calls `acompletion` with correct args (mock LiteLLM)
  - `complete` with `response_format` passes Pydantic model through
  - Error handling: LiteLLM raises `AuthenticationError` (bad key) → surfaced cleanly
  - Error handling: LiteLLM raises `RateLimitError` (provider rate limit) → surfaced cleanly
  - Error handling: LiteLLM raises timeout → surfaced cleanly

- **Unit tests for rate limits:**
  - Pro tier has non-zero AI limits (both platform and BYOK)
  - Free/Standard tiers have zero AI limits (both platform and BYOK)
  - BYOK limits are higher than platform limits for Pro
  - AI operation type correctly identified for `/ai/*` paths
  - Rate limit check uses BYOK limits when `X-LLM-Api-Key` is present
  - Rate limit check uses platform limits when no BYOK header

- **Unit tests for cost tracking:**
  - `track_cost` writes to both user and detail Redis keys
  - `track_cost` with Redis unavailable → no error raised (fire-and-forget)
  - Correct key format: `ai_stats:user:{user_id}:{date}` and `ai_stats:detail:{date}:{use_case}:{model}:{key_source}`
  - TTL is set on keys

- **Unit tests for cost flush cron:**
  - Reads yesterday's Redis keys → writes correct rows to DB
  - Handles empty Redis (no keys for yesterday) gracefully
  - Deletes processed Redis keys after successful DB write
  - Handles DB write failure → does not delete Redis keys (data preserved for retry)

- **Integration tests for `/ai/health`:**
  - Pro user → `available: true`
  - Free user → `available: false`
  - Pro user with `X-LLM-Api-Key` header → `byok: true`
  - Response includes use-case model mapping
  - Rate limit enforcement: exhaust AI limit, next request returns 429

---

## Milestone 2: Suggestion Features — Backend

### Goal & Outcome

After this milestone:

- `POST /ai/suggest-tags` — given item metadata, returns suggested tags
- `POST /ai/suggest-metadata` — given content/URL, returns suggested title and description
- `POST /ai/suggest-relationships` — given an item, returns candidate related items
- All endpoints return structured Pydantic responses
- All endpoints work with both platform keys and BYOK

### Implementation Outline

#### 1. Request/response schemas (`backend/src/schemas/ai.py`)

```python
class SuggestTagsRequest(BaseModel):
    title: str | None = None
    url: str | None = None
    description: str | None = None
    content_snippet: str | None = None  # first N chars of content
    existing_tags: list[str] = []       # user's current tag vocabulary

class SuggestTagsResponse(BaseModel):
    tags: list[str]

class SuggestMetadataRequest(BaseModel):
    url: str | None = None
    title: str | None = None
    content_snippet: str | None = None

class SuggestMetadataResponse(BaseModel):
    title: str
    description: str

class SuggestRelationshipsRequest(BaseModel):
    entity_id: str
    entity_type: str  # bookmark, note, prompt

class RelationshipCandidate(BaseModel):
    entity_id: str
    entity_type: str
    title: str
    reasoning: str

class SuggestRelationshipsResponse(BaseModel):
    candidates: list[RelationshipCandidate]
```

#### 2. Prompt templates

Store prompt templates as constants in a module (e.g. `backend/src/services/llm_prompts.py`). These are system prompts that instruct the LLM on how to respond. Keep them simple and iterate.

Key design choices for prompts:
- **Tag suggestions:** Instruct the LLM to prefer reusing tags from `existing_tags` when relevant, and to suggest lowercase, hyphenated tags consistent with the user's existing style.
- **Metadata suggestions:** Generate concise title and description. The title should be short (under 100 chars). The description should be 1-2 sentences.
- **Relationship suggestions:** This is a two-step operation. First, search for candidate items (using existing content search). Then send the current item + candidates to the LLM to judge relevance.

#### 3. AI router endpoints

Each endpoint follows the same pattern:

```python
@router.post("/suggest-tags", response_model=SuggestTagsResponse)
async def suggest_tags(
    data: SuggestTagsRequest,
    current_user: User = Depends(get_current_user),
    limits: TierLimits = Depends(get_current_limits),
    llm_api_key: str | None = Depends(get_llm_api_key),
):
    if limits.rate_ai_per_day == 0:
        raise QuotaExceededError(resource="ai", current=0, limit=0)
    config = llm_service.resolve_config(AIUseCase.SUGGESTIONS, llm_api_key)
    # Build messages from prompt template + request data
    # Call llm_service.complete(..., response_format=SuggestTagsResponse)
    # Track cost via Redis
    # Return parsed response
```

#### 4. Relationship suggestions — search step

The `/ai/suggest-relationships` endpoint needs to first find candidate items to evaluate. Use the existing `ContentService` search to find items with similar tags or text, then pass the top N candidates to the LLM for relevance judgment.

Use the existing `ContentService` search with the item's title as the query. This leverages the existing full-text search infrastructure. Deduplicate and exclude the source item. Send the top 10 candidates to the LLM — enough for meaningful suggestions without excessive token cost. The exact search strategy (title-only vs title+tags) can be tuned during implementation based on result quality.

### Testing Strategy

- **Unit tests per endpoint (mock LLMService):**
  - Valid request → structured response with correct schema
  - Missing content (e.g. no title, no URL, no content) → still works (LLM does its best with what it has)
  - Free/Standard user → 402 quota exceeded
  - Pro user → success
  - BYOK user → success with user's key passed through
  - Verify prompt construction includes existing_tags for tag suggestions
  - Verify prompt construction truncates content_snippet if too long

- **Unit tests for relationship suggestions:**
  - Search step returns candidates → passed to LLM
  - Search returns no candidates → returns empty list (no LLM call needed)
  - Current item excluded from candidates

- **Integration tests (mock LiteLLM, real DB):**
  - End-to-end flow: create a bookmark → call suggest-tags → get tags back
  - Rate limit enforcement: exhaust AI limit → 429

---

## Milestone 3: Suggestion Features — Frontend

### Goal & Outcome

After this milestone:

- Users can trigger tag/metadata suggestions from the bookmark/note/prompt edit UI
- A "Suggest tags" button appears near the tag input
- A "Suggest title/description" option is available when creating/editing items
- Suggestion results are shown as selectable options (not auto-applied)
- AI settings page exists in Settings with BYOK configuration
- Relationship suggestions are accessible from the item detail view

### Implementation Outline

#### 1. AI settings store + settings page

New Zustand store (`stores/aiStore.ts`) for:
- `apiKey: string | null` — from localStorage
- `model: string | null` — user's preferred model (only used with BYOK)
- `setApiKey(key)` / `clearApiKey()` — persist to/from localStorage
- `isConfigured: boolean` — derived: true if BYOK key is set

New settings page section or tab for AI configuration:
- API key input (masked, with show/hide toggle)
- Provider/model selection (only enabled when API key is set)
- Model dropdown: curated short list + "Custom" text field for power users
- Clear key button
- Test connection button (calls `/ai/health` with the key)

#### 2. Tag suggestion UI

Near the tag input (in `InlineEditableTags` or the parent component):
- A small button/icon that triggers `POST /ai/suggest-tags`
- Loading state while waiting for response
- Suggested tags appear as selectable chips below the input
- Clicking a chip adds it to the item's tags
- "Add all" / "Dismiss" buttons

The request should include:
- Current item's title, URL (if bookmark), description, content (first ~2000 chars)
- User's existing tag vocabulary (from the tags store, which already caches all tags)

#### 3. Metadata suggestion UI

On the create/edit form for bookmarks and notes:
- A "Suggest" button near the title/description fields (or a single button that suggests both)
- Shows suggested title and description as a preview
- User can accept (replaces field), edit, or dismiss
- Only shown when there's enough content to suggest from (e.g. URL or content body exists)

#### 4. Relationship suggestion UI

On the item detail view, near the relationships section:
- A "Suggest related items" button
- Shows candidates with their reasoning
- User can select which ones to link
- Creates relationships for selected candidates

#### 5. API integration

All AI API calls include the BYOK key header if configured:

```tsx
const aiApi = {
  suggestTags: (data: SuggestTagsRequest) =>
    api.post<SuggestTagsResponse>('/ai/suggest-tags', data, {
      headers: aiStore.apiKey ? { 'X-LLM-Api-Key': aiStore.apiKey } : {},
    }),
  // ...
}
```

Use an axios request interceptor that conditionally adds the `X-LLM-Api-Key` header for `/ai/` paths. This keeps the BYOK logic in one place and scales as more AI endpoints are added, without polluting non-AI requests.

#### 6. Feature gating

AI features should be hidden/disabled for users whose tier doesn't support them. The `/ai/health` endpoint (or the user's limits from `useLimits()`) tells the frontend whether AI is available. Don't show suggestion buttons to Free/Standard users — or show them disabled with an upgrade prompt.

### Testing Strategy

- **Component tests:**
  - Tag suggestion button: click → loading state → shows suggested tags → click tag adds it
  - Tag suggestion button: hidden for non-Pro users
  - Metadata suggestion: shows preview, accept replaces fields
  - AI settings: entering key persists to localStorage, clearing removes it
  - AI settings: test connection button calls health endpoint

- **API integration tests (mock API responses):**
  - BYOK header included when key is configured
  - BYOK header omitted when no key
  - Error handling: 429 rate limit → shows appropriate message
  - Error handling: 402 quota → shows upgrade prompt

---

## ~~Milestone 4: Selection Actions (Rewrite/Improve)~~ — Deferred

Moved to [LLM Chat & Context Management plan](2026-04-02-llm-chat.md). Selection actions (select text → Cmd+/ → "Improve"/"Summarize"/"Explain") will route results through the chat sidebar rather than standalone popovers/inline replacement. This avoids building throwaway UI and gives users the ability to iterate on transform results conversationally.

---

## Milestone 4: Auto-Complete PoC

### Goal & Outcome

After this milestone:

- As the user types in the note editor, completions appear as ghost text after a debounce pause
- Tab accepts the suggestion, Escape or continued typing dismisses it
- A keyboard shortcut or setting toggles auto-complete on/off
- This is a PoC — optimize for learning, not perfection

### Implementation Outline

#### 1. Backend endpoint

```
POST /ai/complete
```

```python
class CompleteRequest(BaseModel):
    prefix: str       # text before cursor (current paragraph + a few preceding paragraphs)
    suffix: str       # text after cursor (a few following paragraphs, for context)

class CompleteResponse(BaseModel):
    completion: str   # the suggested continuation
```

Non-streaming. The prompt instructs the LLM to continue the text naturally — complete the current sentence or add 1-2 sentences. Keep completions short for speed and relevance.

Start with ~500 chars before cursor and ~200 chars after. This is a PoC — the context window size can be tuned based on completion quality and latency once we have real usage data.

#### 2. CodeMirror ghost text extension

A CodeMirror extension that renders suggestion text as ghost text:

- Uses `Decoration.widget()` to insert a styled span after the cursor position
- Styled with reduced opacity (e.g. `opacity: 0.4`, same font)
- **Tab** keymap (high precedence): if ghost text is active, accept it (insert into document), consume the key
- **Escape** keymap (high precedence): if ghost text is active, dismiss it, consume the key (prevents closing the note)
- Any other keypress: dismiss ghost text, let the keypress proceed normally

#### 3. Debounce + cancellation logic

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

#### 4. Toggle

- User setting stored in localStorage (like line wrap, line numbers)
- Keyboard shortcut to toggle (TBD — e.g. `Ctrl+Shift+Space`)
- Visual indicator in editor toolbar showing on/off state

### Testing Strategy

- **Backend:**
  - Valid prefix/suffix → completion returned
  - Empty prefix → still returns something reasonable (start of document)
  - Response is short (prompt instructs brevity)
  - Rate limiting enforced

- **Frontend:**
  - Ghost text appears after debounce period
  - Tab accepts ghost text (text inserted into document)
  - Escape dismisses ghost text
  - Typing dismisses ghost text
  - New typing after dismissal triggers new request
  - Rapid typing doesn't flood requests (debounce works, old requests cancelled)
  - Ghost text not shown if cursor moved since request
  - Toggle on/off works, persists across sessions
  - Disabled for non-Pro users without BYOK

---

## ~~Milestone 5: Chat~~ — Deferred

Moved to [LLM Chat & Context Management plan](2026-04-02-llm-chat.md). Chat requires solving context management (how much content to inject, conversation length limits, token budgets) which warrants its own design.

---

## Cross-Cutting Concerns

### Error Handling

LiteLLM raises typed exceptions for provider errors. The LLM service catches these and returns a structured JSON error body with an `error` code that distinguishes LLM provider failures from platform failures. This is critical for BYOK users — a bad user API key should not look like a tiddly auth failure.

| LiteLLM Error | HTTP Status | Error Code | Message |
|---|---|---|---|
| `AuthenticationError` | 422 | `llm_auth_failed` | "Your API key was rejected by the provider" |
| `RateLimitError` | 429 | `llm_rate_limited` | "Provider rate limit exceeded, try again later" |
| `Timeout` | 504 | `llm_timeout` | "LLM request timed out" |
| `BadRequestError` | 400 | `llm_bad_request` | "Invalid request to LLM provider" |
| `APIConnectionError` | 502 | `llm_connection_error` | "Could not connect to LLM provider" |
| Other | 503 | `llm_unavailable` | "AI service temporarily unavailable" |

All LLM provider errors use `llm_*` error codes so the frontend can unambiguously distinguish them from platform auth errors (which use HTTP 401 with different error codes). Note `AuthenticationError` returns 422 (not 401) to avoid conflation with tiddly session/token auth.

### Tier Limits Documentation Sync

When AI rate limits are added, update:
- `frontend/src/pages/Pricing.tsx`
- `frontend/public/llms.txt`
- `frontend/src/types.ts` (UserLimits interface)
- `backend/src/schemas/user_limits.py`

### Security

- BYOK keys: transit only (HTTPS), never logged, never stored, never included in error responses
- Platform keys: env vars only, never exposed in API responses
- Input validation: truncate content snippets sent to LLMs to prevent abuse (e.g. someone sending 100k chars to burn our API budget)
- Prompt injection: structured output (Pydantic `response_format`) helps enforce expected response format for suggestion features

### Cost Management

- **Real-time tracking:** Redis hashes accumulate cost + count per user and per use-case/model/key-source (see Milestone 1, section 5)
- **Historical data:** Daily Railway cron flushes Redis to `ai_usage_daily` DB table (see Milestone 1, section 6)
- **Cost calculation:** Non-streaming uses `response._hidden_params['response_cost']`. Streaming uses `completion_cost(model, prompt, completion)` after stream is consumed (verified in PoC — streaming `response_cost` returns 0.0 for all providers).
- Set a monthly budget alert on the Gemini API key
- Consider a daily platform cost cap that disables platform AI if exceeded (emergency brake) — can be checked against Redis per-user key before each call
- Content snippet truncation: limit input to ~2000 chars for suggestions, ~500 chars prefix + ~200 chars suffix for auto-complete
