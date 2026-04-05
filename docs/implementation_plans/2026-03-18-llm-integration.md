# LLM Integration

**Date:** 2026-03-18
**Status:** Draft — iterating on plan before implementation

## Overview

Add AI-powered features to tiddly.me using LiteLLM as the provider abstraction layer. This plan covers the backend service layer and suggestion features (backend + frontend) — all gated by tier and rate limits.

**Related plans:**
- [LLM Auto-Complete](2026-04-01-llm-autocomplete.md) — auto-complete PoC (depends on this plan)
- [LLM Chat & Context Management](2026-04-02-llm-chat.md) — chat, context management, selection actions (depends on this plan)

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
- AI rate limits are enforced per tier via two new operation types (`AI_PLATFORM` / `AI_BYOK`), with an AI-specific rate limit dependency
- Per-call cost tracking via Redis (per-user + per-use-case/model/key-source granularity)
- An hourly Railway cron job flushes Redis cost data to a DB usage table
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

class LLMConfig(BaseModel):
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

    # Explicit mapping — no string parsing, trivially extensible
    _PROVIDER_KEY_MAP: dict[str, str] = {
        "gemini/": "gemini_api_key",
        "anthropic/": "anthropic_api_key",
        "openai/": "openai_api_key",
        "gpt-": "openai_api_key",
    }

    @staticmethod
    def _resolve_platform_key(model: str, settings: Settings) -> str:
        """Determine which provider API key to use based on model prefix.
        Prefix-matched in order, first match wins. Raises ValueError for unknown prefix."""
        for prefix, key_attr in LLMService._PROVIDER_KEY_MAP.items():
            if model.startswith(prefix):
                return getattr(settings, key_attr)
        raise ValueError(f"Unknown model prefix: {model}. Add mapping to _PROVIDER_KEY_MAP.")

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
            timeout=30,
            num_retries=1,
        )
        # Cost via public API (not _hidden_params which is private/unstable)
        cost = completion_cost(completion_response=response)
        return response, cost

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
            timeout=60,
            # No num_retries for streaming — retries are complex with partial streams
        )
```

**Design decisions:**
- **Singleton via lifespan** — created in `lifespan()`, stored in `app.state`, exposed via a `get_llm_service()` dependency function (same pattern as `RedisClient`). `__init__` takes `Settings`, so it can't be instantiated at module level.
- **Use-case model mapping** — each `AIUseCase` maps to a model via env vars. Changing a use case's model is a config change, not a code change.
- **Provider key resolution** — `_PROVIDER_KEY_MAP` is an explicit dict mapping model prefixes to settings attribute names. No string parsing or implicit conventions — adding a new provider is one dict entry. First matching prefix wins.
- **Timeout + retry** — `complete()` has a 30s timeout and `num_retries=1` (idempotent, safe to retry transient 500s). `stream()` has a 60s timeout and no retries (streaming retries are complex with partial responses).
- **Cost via public API** — both streaming and non-streaming use `completion_cost()` (not `_hidden_params` which is private and has broken across LiteLLM versions).

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

# LLM call timeouts (seconds)
llm_timeout_default: int = 30     # non-streaming (suggestions, transforms)
llm_timeout_streaming: int = 60   # streaming (chat)
```

#### 3. AI rate limits (`backend/src/core/tier_limits.py`)

Add new AI rate limit fields to `TierLimits`. These map to two new operation types — `AI_PLATFORM` and `AI_BYOK` — rather than a single `AI` type with conditional branching (see §4):

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

#### 4. Rate limit integration

Add `AI_PLATFORM` and `AI_BYOK` to the `OperationType` enum in `rate_limit_config.py`. Update the `SENSITIVE` operation type's comment to remove AI/LLM from its scope (it currently claims `# Future: AI/LLM endpoints, bulk operations` — AI now has its own types).

**Do NOT map `/ai/*` in the global path-based rate limiter.** The existing auth dependencies (`get_current_user`, `get_current_user_auth0_only`, etc.) all call `_apply_rate_limit()`, which maps requests to READ/WRITE/SENSITIVE via `get_operation_type()`. If AI endpoints used these dependencies, a POST to `/ai/suggest-tags` would consume WRITE quota *and* AI quota — double-limiting.

**Solution:** Create a new `get_current_user_ai` auth dependency that:
1. Authenticates the user (Auth0-only, blocks PATs)
2. Checks consent
3. Does **NOT** call `_apply_rate_limit()` — skips the global route-based limiter entirely

Then create a separate AI rate limit dependency used by `/ai/` router endpoints:
1. Checks whether the `X-LLM-Api-Key` header is present
2. Selects `AI_PLATFORM` or `AI_BYOK` operation type accordingly
3. Calls `check_rate_limit()` with the appropriate type

This keeps AI rate limiting fully isolated from the global auth pipeline.

`/ai/health` is exempt from AI rate limiting — it's a status check, not an LLM call. It uses `get_current_user_ai` for auth but does not depend on the AI rate limit dependency.

#### 5. Cost tracking via Redis

After each LLM call, record cost and request count in Redis using pipelined `HINCRBYFLOAT`/`HINCRBY`. Two keys per call:

```
# Per-user hourly totals (for user dashboards, budget caps)
ai_stats:user:{user_id}:{hour}
  → fields: cost (float), count (int)

# Per-dimension breakdown (for operational analytics)
ai_stats:detail:{hour}:{use_case}:{model}:{key_source}
  → fields: cost (float), count (int)
```

Where `{hour}` is formatted as `YYYY-MM-DDTHH` (e.g. `2026-04-05T14`).

All keys get a 7-day TTL as a safety net.

**Cost calculation:** Use `completion_cost(completion_response=response)` for both streaming and non-streaming. This is LiteLLM's public API — do not use `_hidden_params['response_cost']` which is private and has broken across versions. For streaming, call `completion_cost()` after the stream is fully consumed.

**Logging:** Every LLM call emits a structured info log *before* the Redis write: `logger.info("llm_call", user_id=..., use_case=..., model=..., key_source=..., cost=..., latency_ms=...)`. This provides a complete audit trail and secondary data source for reconciliation. Log metadata only — never log prompts, completions, or API keys.

Redis update is fire-and-forget (wrapped in try/except, never blocks the response). If Redis is down, the call still succeeds — cost data is lost for that call but the user isn't affected. On Redis failure, log a structured warning (`logger.warning("cost_tracking_failed", user_id=..., cost=..., use_case=..., reason=...)`).

```python
# In LLMService or a helper called after each LLM call
async def track_cost(
    redis: RedisClient,
    user_id: UUID,
    use_case: AIUseCase,
    model: str,
    key_source: KeySource,
    cost: float,
) -> None:
    hour = datetime.utcnow().strftime("%Y-%m-%dT%H")
    ttl = 7 * 86400  # 7 days

    pipe = await redis.pipeline()
    if pipe is None:
        return

    user_key = f"ai_stats:user:{user_id}:{hour}"
    detail_key = f"ai_stats:detail:{hour}:{use_case}:{model}:{key_source}"

    pipe.hincrbyfloat(user_key, "cost", cost)
    pipe.hincrby(user_key, "count", 1)
    pipe.expire(user_key, ttl)
    pipe.hincrbyfloat(detail_key, "cost", cost)
    pipe.hincrby(detail_key, "count", 1)
    pipe.expire(detail_key, ttl)

    await pipe.execute()
```

#### 6. Hourly cost flush — DB table + Railway cron

**DB table** (`ai_usage`) — single-grain fact table with hourly buckets (requires Alembic migration):

```
bucket_start    TIMESTAMPTZ     -- truncated to hour
user_id         UUID NOT NULL
use_case        VARCHAR         -- suggestions, chat, completion, transform
model           VARCHAR         -- gemini/gemini-2.5-flash-lite, etc.
key_source      VARCHAR         -- platform, user
request_count   INT
total_cost      DECIMAL
UNIQUE (bucket_start, user_id, use_case, model, key_source)
```

One grain, one table. Global analytics (total cost by model, cost by use case) are derived via `GROUP BY` — no mixed-grain rows with `user_id = NULL`. Hourly buckets provide enough resolution for operational monitoring without excessive row count.

**Extend the existing `run_cleanup()` in `backend/src/tasks/cleanup.py`** to include AI usage flushing as a new phase. Change the Railway cron schedule from daily (`30 0 * * *`) to hourly (`30 * * * *`). The existing cleanup phases (trash, history) are cheap and idempotent, so running them hourly is harmless.

Add AI flush as the first phase (time-sensitive due to 7-day TTL), before the existing cleanup phases:
1. **Flush AI usage from Redis to DB** (new)
2. Cleanup trash (soft-deleted items past retention) (existing)
3. Cleanup old history records (existing)

Each task logs its results. If one fails, it logs the error and continues to the next (existing pattern).

The flush step:
1. Scan for the previous hour's Redis keys (`ai_stats:user:*:{previous_hour}` and `ai_stats:detail:{previous_hour}:*`)
2. Read all hashes
3. Upsert rows into `ai_usage` (`INSERT ON CONFLICT UPDATE`, incrementing `request_count` and `total_cost`)
4. Delete processed keys only after successful DB write

**Note:** `litellm` must be moved from dev dependencies to main dependencies in `pyproject.toml` before deploying (currently only installed with `--no-dev` excluded).

#### 7. AI Router (`backend/src/api/routers/ai.py`)

All `/ai/` endpoints use `get_current_user_ai` for auth (Auth0-only, no default rate limiting). AI features are for the web frontend and native apps only, not for programmatic PAT access. If programmatic AI access is needed in the future (e.g. bulk auto-tag via CLI), it can be added intentionally with its own rate limit considerations.

```python
router = APIRouter(prefix="/ai", tags=["ai"])

@router.get("/health")
async def ai_health(
    current_user: User = Depends(get_current_user_ai),
    limits: TierLimits = Depends(get_current_limits),
    llm_api_key: str | None = Depends(get_llm_api_key),
):
    """Check if AI features are available for this user. No AI rate limit consumed."""
    has_byok = llm_api_key is not None
    ai_bucket = OperationType.AI_BYOK if has_byok else OperationType.AI_PLATFORM
    quota = await get_rate_limit_status(current_user.id, ai_bucket, get_tier_safely(current_user.tier))
    return {
        "available": limits.rate_ai_per_day > 0 or (has_byok and limits.rate_ai_byok_per_day > 0),
        "byok": has_byok,
        "remaining_daily": quota.remaining,
        "limit_daily": quota.limit,
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
  - `_resolve_platform_key` raises `ValueError` for unknown provider prefix
  - `complete` calls `acompletion` with correct args including `timeout=30` and `num_retries=1` (mock LiteLLM)
  - `complete` with `response_format` passes Pydantic model through
  - `complete` returns cost via `completion_cost()` (not `_hidden_params`)
  - `stream` calls `acompletion` with `timeout=60` and no `num_retries`
  - Error handling: LiteLLM raises `AuthenticationError` (bad key) → `llm_auth_failed` (422)
  - Error handling: LiteLLM raises `RateLimitError` (provider rate limit) → `llm_rate_limited` (429)
  - Error handling: LiteLLM raises timeout → `llm_timeout` (504)
  - Structured info log emitted on every LLM call (metadata only, no prompts/completions/keys)

- **Unit tests for auth + rate limits:**
  - `get_current_user_ai` authenticates user (Auth0-only, blocks PATs)
  - `get_current_user_ai` checks consent
  - `get_current_user_ai` does NOT call `_apply_rate_limit()` (no WRITE/READ quota consumed)
  - Pro tier has non-zero AI limits (both platform and BYOK)
  - Free/Standard tiers have zero AI limits (both platform and BYOK)
  - BYOK limits are higher than platform limits for Pro
  - AI rate limit dependency selects `AI_PLATFORM` when no BYOK header
  - AI rate limit dependency selects `AI_BYOK` when `X-LLM-Api-Key` header present
  - `/ai/health` does not consume AI quota
  - `SENSITIVE` operation type comment no longer references AI/LLM

- **Unit tests for cost tracking:**
  - `track_cost` writes to both user and detail Redis keys with hourly key format
  - `track_cost` with Redis unavailable → no error raised, warning logged
  - Correct key format: `ai_stats:user:{user_id}:{hour}` and `ai_stats:detail:{hour}:{use_case}:{model}:{key_source}`
  - TTL is set on keys

- **Unit tests for cost flush cron:**
  - Reads previous hour's Redis keys → upserts correct rows to `ai_usage` table
  - Handles empty Redis (no keys for previous hour) gracefully
  - Upserts increment `request_count` and `total_cost` on conflict
  - Deletes processed Redis keys after successful DB write
  - Handles DB write failure → does not delete Redis keys (data preserved for retry)

- **Integration tests for `/ai/health`:**
  - Pro user → `available: true`, `remaining_daily` and `limit_daily` present
  - Free user → `available: false`
  - Pro user with `X-LLM-Api-Key` header → `byok: true`
  - Response includes use-case model mapping
  - After N AI calls, `remaining_daily` reflects correct remaining count (reads from Redis AI bucket)
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

All string fields have `max_length` validators to prevent cost abuse at the API boundary — a malicious or buggy client sending 100k characters would burn platform API budget without these guards.

```python
class SuggestTagsRequest(BaseModel):
    title: str | None = Field(None, max_length=500)
    url: str | None = Field(None, max_length=2000)
    description: str | None = Field(None, max_length=1000)
    content_snippet: str | None = Field(None, max_length=2500)
    existing_tags: list[str] = []       # user's current tag vocabulary

class SuggestTagsResponse(BaseModel):
    tags: list[str]

class SuggestMetadataRequest(BaseModel):
    url: str | None = Field(None, max_length=2000)
    title: str | None = Field(None, max_length=500)
    content_snippet: str | None = Field(None, max_length=2500)

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
- **Relationship suggestions:** This is a two-step operation. First, search for candidate items (using existing content search). Then send the current item + candidates to the LLM to judge relevance. Per candidate, send only: title, type, and first 200 characters of description. Total prompt budget for relationship suggestions: ~3000 tokens (system prompt + source item metadata + 10 candidates).

**BYOK structured output:** Suggestion endpoints require models that support structured output (Pydantic `response_format`). This works reliably with OpenAI, Gemini, and Anthropic major models. If a BYOK user chooses a model that doesn't support structured output, LiteLLM will raise an error that our error handler surfaces as `llm_bad_request`. The `/ai/health` endpoint should document which capabilities each use case requires so BYOK users can make informed model choices.

#### 3. AI router endpoints

Each endpoint follows the same pattern:

```python
@router.post("/suggest-tags", response_model=SuggestTagsResponse)
async def suggest_tags(
    data: SuggestTagsRequest,
    current_user: User = Depends(get_current_user_ai),
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
  - Oversized `content_snippet` (exceeds max_length) → 422 validation error
  - BYOK model without structured output support → `llm_bad_request` error with clear message

- **Unit tests for relationship suggestions:**
  - Search step returns candidates → passed to LLM
  - Search returns no candidates → returns empty list (no LLM call needed)
  - Current item excluded from candidates
  - Candidate descriptions truncated to 200 chars in prompt

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

New settings page named "LLM Settings" (distinct from the existing "AI Integration" page which is MCP-focused):
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
- Input validation: `max_length` on all Pydantic request schema string fields to prevent cost abuse at the API boundary (see Milestone 2 §1)
- Prompt injection: structured output (Pydantic `response_format`) helps enforce expected response format for suggestion features

### Cost Management

- **Real-time tracking:** Redis hashes accumulate cost + count per user and per use-case/model/key-source with hourly buckets (see Milestone 1, section 5)
- **Historical data:** Hourly Railway cron flushes Redis to `ai_usage` DB table (see Milestone 1, section 6)
- **Cost calculation:** Both streaming and non-streaming use `completion_cost(completion_response=response)` — the public LiteLLM API. Do not use `_hidden_params` (private, unstable across versions).
- **Audit trail:** Every LLM call emits a structured info log with metadata (user_id, use_case, model, key_source, cost, latency). Never log prompts, completions, or API keys.
- Set a monthly budget alert on the Gemini API key
- Consider a daily platform cost cap that disables platform AI if exceeded (emergency brake) — can be checked against Redis per-user key before each call
- Content snippet truncation: enforced via `max_length` on Pydantic request schemas (see Milestone 2 §1)
