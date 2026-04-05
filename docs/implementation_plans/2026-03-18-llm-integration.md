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
- **Milestone structure:** 1a (LLM Service + Router) → 1b (Rate Limiting) → 1c (Cost Tracking) → 2 (Suggestion Backend) → 3 (Suggestion Frontend). Each is independently deployable and testable.

**References:**
- LiteLLM docs: https://docs.litellm.ai/docs/
- LiteLLM async: https://docs.litellm.ai/docs/completion/stream (`acompletion`)
- LiteLLM structured output: https://docs.litellm.ai/docs/completion/json_mode (Pydantic `response_format`)
- LiteLLM provider prefixes: https://docs.litellm.ai/docs/providers (e.g. `gemini/`, `anthropic/`)
- Sandbox PoC notebook: `sandbox/litellm.ipynb`

---

## Milestone 1a: LLM Service + AI Router

### Goal & Outcome

Establish the core backend infrastructure for AI features. After this milestone:

- A new `LLMService` wraps LiteLLM with use-case-based model resolution, key routing (platform vs BYOK), and error handling
- A new `/ai/` router exists with a health-check endpoint and models endpoint
- BYOK header extraction works
- The service is wired up and callable, but not yet rate-limited or cost-tracked

### Implementation Outline

#### 1. LLM Service (`backend/src/services/llm_service.py`)

**Note:** `litellm` must be moved from dev dependencies to main dependencies in `pyproject.toml` before deploying (currently only installed with `--no-dev` excluded).

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
    AUTO_COMPLETE = "auto_complete"  # editor auto-complete — fast & cheap
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
            AIUseCase.AUTO_COMPLETE: LLMConfig(
                model=settings.llm_model_auto_complete,
                api_key=self._resolve_platform_key(settings.llm_model_auto_complete, settings),
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
        "gpt-": "openai_api_key",  # Legacy OpenAI names without prefix — verify if still needed with current LiteLLM
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
llm_model_auto_complete: str = "gemini/gemini-2.5-flash-lite"
llm_model_chat: str = "gemini/gemini-2.5-flash"

# Provider API keys (only needed for providers referenced by models above)
gemini_api_key: str = ""
openai_api_key: str = ""
anthropic_api_key: str = ""

# LLM call timeouts (seconds)
llm_timeout_default: int = 30     # non-streaming (suggestions, transforms)
llm_timeout_streaming: int = 60   # streaming (chat)
```

#### 3. AI Router (`backend/src/api/routers/ai.py`)

All `/ai/` endpoints use `get_current_user_ai` for auth (Auth0-only, no default rate limiting — see Milestone 1b for the auth dependency). AI features are for the web frontend and native apps only, not for programmatic PAT access. If programmatic AI access is needed in the future (e.g. bulk auto-tag via CLI), it can be added intentionally with its own rate limit considerations.

**Note:** Until Milestone 1b is complete, use `get_current_user_auth0_only` as a temporary placeholder. The AI-specific auth dependency that skips global rate limiting is introduced in 1b.

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
    }
```

#### 4. Models endpoint

```python
@router.get("/models")
async def ai_models(
    current_user: User = Depends(get_current_user_ai),
):
    """Return curated list of supported models and per-use-case defaults."""
    return {
        "models": SUPPORTED_MODELS,
        "defaults": {
            uc.value: llm_service.get_model_for_use_case(uc)
            for uc in AIUseCase
        },
    }
```

The model list is server-driven — adding a new supported model doesn't require a frontend deploy. The `defaults` map shows the platform model per use case. The curated list is stored as a constant `SUPPORTED_MODELS` (e.g. in `llm_service.py` or a dedicated module), not in the database.

No AI rate limit consumed — this is a configuration endpoint, not an LLM call.

**Curated model list — GA models only (no preview/experimental).** Preview models lack stability guarantees, have lower rate limits, and can be shut down without notice (e.g. Gemini 3 Pro Preview was shut down March 9, 2026). When preview models go GA, they're added to this list — a one-line constant change.

```python
SUPPORTED_MODELS = [
    # Google Gemini
    {"id": "gemini/gemini-2.5-flash-lite", "provider": "google", "tier": "budget",    "input_cost_per_million": 0.10, "output_cost_per_million": 0.40},
    {"id": "gemini/gemini-2.5-flash",      "provider": "google", "tier": "balanced",  "input_cost_per_million": 0.30, "output_cost_per_million": 2.50},
    {"id": "gemini/gemini-2.5-pro",         "provider": "google", "tier": "flagship",  "input_cost_per_million": 1.25, "output_cost_per_million": 10.00},
    # OpenAI
    {"id": "openai/gpt-5.4-nano",          "provider": "openai", "tier": "budget",    "input_cost_per_million": 0.20, "output_cost_per_million": 1.25},
    {"id": "openai/gpt-5.4-mini",          "provider": "openai", "tier": "balanced",  "input_cost_per_million": 0.75, "output_cost_per_million": 4.50},
    {"id": "openai/gpt-5.4",               "provider": "openai", "tier": "flagship",  "input_cost_per_million": 2.50, "output_cost_per_million": 15.00},
    # Anthropic
    {"id": "anthropic/claude-haiku-4-5",    "provider": "anthropic", "tier": "budget",    "input_cost_per_million": 1.00, "output_cost_per_million": 5.00},
    {"id": "anthropic/claude-sonnet-4-6",   "provider": "anthropic", "tier": "balanced",  "input_cost_per_million": 3.00, "output_cost_per_million": 15.00},
    {"id": "anthropic/claude-opus-4-6",     "provider": "anthropic", "tier": "flagship",  "input_cost_per_million": 5.00, "output_cost_per_million": 25.00},
]
```

All 9 models support structured output (Pydantic `response_format`). The list is 3 providers × 3 tiers (budget / balanced / flagship) — scannable and covers all price points. The `tier` field can be used by the frontend to group the dropdown or to recommend models per use case in the future.

**Notes for implementation:**
- Verify the exact LiteLLM model ID prefixes (e.g. `openai/gpt-5.4` vs `gpt-5.4`). The `_PROVIDER_KEY_MAP` must match.
- Investigate whether LiteLLM provides a friendly display name for models or whether we maintain our own `id → name` mapping. Decide whether the display name should include the provider (e.g. "Google Gemini 2.5 Flash Lite" vs "Gemini 2.5 Flash Lite") based on what looks clearest in the dropdown.
- Pricing should be verified against current provider pricing pages at implementation time — costs may have changed.

#### 5. BYOK header extraction

A new dependency that optionally extracts the user's API key from the `X-LLM-Api-Key` header. This is separate from auth — the user is still authenticated via JWT/PAT as normal.

```python
def get_llm_api_key(request: Request) -> str | None:
    return request.headers.get("X-LLM-Api-Key")
```

#### 6. Register router in `api/main.py`

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

- **Integration tests for `/ai/health`:**
  - Pro user → `available: true`
  - Free user → `available: false`
  - Pro user with `X-LLM-Api-Key` header → `byok: true`

- **Integration tests for `/ai/models`:**
  - Returns curated model list with id, name, provider, costs
  - Returns per-use-case defaults matching settings configuration

---

## Milestone 1b: AI Rate Limiting

### Goal & Outcome

After this milestone:

- AI rate limits are enforced per tier via two new operation types (`AI_PLATFORM` / `AI_BYOK`)
- A dedicated `get_current_user_ai` auth dependency skips global rate limiting (prevents double-limiting)
- A separate AI rate limit dependency selects the correct bucket based on the BYOK header
- `/ai/health` is exempt from AI rate limiting and returns remaining quota
- The foundation is in place for all AI endpoints to be properly gated

### Implementation Outline

#### 1. AI rate limits (`backend/src/core/tier_limits.py`)

Add new AI rate limit fields to `TierLimits`. These map to two new operation types — `AI_PLATFORM` and `AI_BYOK`:

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
| Pro | 30 | 500 | 120 | 2000 |
| Dev | 1000 | 10000 | 1000 | 10000 |

#### 2. Rate limit integration

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

`/ai/health` and `/ai/models` are exempt from AI rate limiting — they are configuration/status endpoints, not LLM calls. They use `get_current_user_ai` for auth but do not depend on the AI rate limit dependency.

#### 3. Update `/ai/health` to return remaining quota

Update the health endpoint to read the AI rate limit bucket from Redis and return `remaining_daily` and `limit_daily`:

```python
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
    }
```

#### 4. Replace temporary auth dependency

Replace the `get_current_user_auth0_only` placeholder from Milestone 1a with `get_current_user_ai` on all `/ai/` endpoints.

### Testing Strategy

- **Unit tests for auth:**
  - `get_current_user_ai` authenticates user (Auth0-only, blocks PATs)
  - `get_current_user_ai` checks consent
  - `get_current_user_ai` does NOT call `_apply_rate_limit()` (no WRITE/READ quota consumed)

- **Unit tests for rate limits:**
  - Pro tier has non-zero AI limits (both platform and BYOK)
  - Free/Standard tiers have zero AI limits (both platform and BYOK)
  - BYOK limits are higher than platform limits for Pro
  - AI rate limit dependency selects `AI_PLATFORM` when no BYOK header
  - AI rate limit dependency selects `AI_BYOK` when `X-LLM-Api-Key` header present
  - `/ai/health` does not consume AI quota
  - `/ai/models` does not consume AI quota
  - `SENSITIVE` operation type comment no longer references AI/LLM

- **Integration tests for `/ai/health` with quota:**
  - `remaining_daily` and `limit_daily` present in response
  - After N AI calls, `remaining_daily` reflects correct remaining count (reads from Redis AI bucket)
  - Rate limit enforcement: exhaust AI limit, next request returns 429

---

## Milestone 1c: Cost Tracking + Flush

### Goal & Outcome

After this milestone:

- Every LLM call records cost in Redis with hourly buckets
- A structured info log is emitted per LLM call for audit trail
- An hourly Railway cron job flushes Redis cost data to a Postgres `ai_usage` table
- Cost data is durable and queryable for analytics and spend monitoring

### Implementation Outline

#### 1. Cost tracking via Redis

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

#### 2. Hourly cost flush — DB table + Railway cron

**DB table** (`ai_usage`) — single-grain fact table with hourly buckets. Generate the migration via `make migration msg='add ai_usage table'` — **never create Alembic migrations manually** (this has been a source of issues).

```
bucket_start    TIMESTAMPTZ     -- truncated to hour
user_id         UUID NOT NULL
use_case        VARCHAR         -- suggestions, chat, auto_complete, transform
model           VARCHAR         -- gemini/gemini-2.5-flash-lite, etc.
key_source      VARCHAR         -- platform, user
request_count   INT
total_cost      DECIMAL
UNIQUE (bucket_start, user_id, use_case, model, key_source)
```

One grain, one table. Global analytics (total cost by model, cost by use case) are derived via `GROUP BY` — no mixed-grain rows with `user_id = NULL`. Hourly buckets provide enough resolution for operational monitoring without excessive row count.

##### Flush function

Create `async def flush_ai_usage(db: AsyncSession, redis: RedisClient) -> None` in a new module `backend/src/tasks/ai_usage_flush.py`. This is a standalone, independently testable function — it does not depend on or call `run_cleanup()`.

The flush step:
1. Scan for the previous hour's Redis keys (`ai_stats:user:*:{previous_hour}` and `ai_stats:detail:{previous_hour}:*`)
2. Read all hashes
3. Upsert rows into `ai_usage` (`INSERT ON CONFLICT UPDATE`, incrementing `request_count` and `total_cost`)
4. Delete processed Redis keys only after successful DB write
5. Log summary: number of keys processed, total cost flushed

The module also has a `main()` entrypoint for cron invocation:

```python
async def main() -> None:
    """Entrypoint for Railway cron. Creates its own DB and Redis sessions."""
    async with get_db_session() as db, get_redis_client() as redis:
        await flush_ai_usage(db, redis)

if __name__ == "__main__":
    asyncio.run(main())
```

This follows the same pattern as `backend/src/tasks/cleanup.py` which has its own `main()` for cron invocation.

##### Railway deployment

This is a **separate Railway cron service** from the existing cleanup cron. The AI flush runs hourly; the existing cleanup runs daily. Each has one responsibility, one schedule, one failure mode.

**New Railway cron service — "AI Usage Flush":**
- Dockerfile: `Dockerfile.api` (same as API and cleanup — shares all backend code)
- Start command: `uv run python -m tasks.ai_usage_flush`
- Schedule: `30 * * * *` (every hour at :30)
- Environment: same env vars as API service (needs DB + Redis connection strings)

**Existing cleanup cron service** — unchanged:
- Schedule remains: `30 0 * * *` (daily at 00:30 UTC)
- No modifications needed

To set up the new cron service in Railway:
1. In the Railway project dashboard, click "New Service" → "Cron Job"
2. Point it at the same repo/branch as the API service
3. Set Dockerfile to `Dockerfile.api`
4. Set start command to `uv run python -m tasks.ai_usage_flush`
5. Set schedule to `30 * * * *`
6. Copy the environment variables from the API service (or use Railway's shared variables)

### Testing Strategy

- **Unit tests for cost tracking:**
  - `track_cost` writes to both user and detail Redis keys with hourly key format
  - `track_cost` with Redis unavailable → no error raised, warning logged
  - Correct key format: `ai_stats:user:{user_id}:{hour}` and `ai_stats:detail:{hour}:{use_case}:{model}:{key_source}`
  - TTL is set on keys
  - Structured info log emitted on every LLM call (metadata only, no prompts/completions/keys)

- **Unit tests for `flush_ai_usage()` (tested independently, not via `run_cleanup`):**
  - Seed Redis with known hourly keys → flushes correct rows to `ai_usage` table
  - Handles empty Redis (no keys for previous hour) gracefully
  - Upserts increment `request_count` and `total_cost` on conflict
  - Deletes processed Redis keys after successful DB write
  - Handles DB write failure → does not delete Redis keys (data preserved for retry)
  - Logs summary with keys processed and total cost flushed

---

## Milestone 2: Suggestion Features — Backend

> **Depends on:** Milestone 1a (LLM Service), Milestone 1b (Rate Limiting)

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

All request schemas include an optional `model` field. This is the user's BYOK model override — the LiteLLM model ID from their settings (e.g. `"anthropic/claude-sonnet-4-6"`). The frontend always sends it if the user has an override configured; the backend ignores it when no BYOK key is present (can't use a user-selected model with our platform key). See `LLMService.resolve_config()` in Milestone 1a for the resolution logic.

```python
class SuggestTagsRequest(BaseModel):
    model: str | None = None             # BYOK model override (ignored without BYOK key)
    title: str | None = Field(None, max_length=500)
    url: str | None = Field(None, max_length=2000)
    description: str | None = Field(None, max_length=1000)
    content_snippet: str | None = Field(None, max_length=2500)
    current_tags: list[str] = []        # tags already on this item (for deduplication)

class SuggestTagsResponse(BaseModel):
    tags: list[str]

class SuggestMetadataRequest(BaseModel):
    model: str | None = None             # BYOK model override (ignored without BYOK key)
    url: str | None = Field(None, max_length=2000)
    title: str | None = Field(None, max_length=500)
    content_snippet: str | None = Field(None, max_length=2500)

class SuggestMetadataResponse(BaseModel):
    title: str
    description: str

class SuggestRelationshipsRequest(BaseModel):
    model: str | None = None             # BYOK model override (ignored without BYOK key)
    title: str | None = Field(None, max_length=500)
    url: str | None = Field(None, max_length=2000)
    description: str | None = Field(None, max_length=1000)
    content_snippet: str | None = Field(None, max_length=2500)
    current_tags: list[str] = []                  # for search queries
    existing_relationship_ids: list[str] = []     # for deduplication

class RelationshipCandidate(BaseModel):
    entity_id: str
    entity_type: str
    title: str

class SuggestRelationshipsResponse(BaseModel):
    candidates: list[RelationshipCandidate]
```

#### 2. Prompt templates

Store prompt templates as constants in a module (e.g. `backend/src/services/llm_prompts.py`). These are system prompts that instruct the LLM on how to respond. Keep them simple and iterate.

**Data boundary:** The client sends item context (title, url, description, content_snippet, current_tags) because the item may not be saved yet or may have unsaved edits. The server loads user context (tag vocabulary, recent items for few-shot examples) from the database — the client doesn't need to assemble this.

Key design choices for prompts:
- **Tag suggestions:** The server builds the prompt with:
  1. The item's metadata from the request (title, url, description, content_snippet)
  2. The user's tag vocabulary sorted by frequency (queried from DB)
  3. Few-shot examples: recent items that use the item's `current_tags`, showing title/description + tags. If no current tags, use the user's most recent items instead.
  4. Instructions: prefer reusing tags from the vocabulary, suggest lowercase hyphenated tags consistent with the user's style, the examples are for style reference only — do not simply duplicate them.
  5. The response excludes any tags already in `current_tags` (server-side deduplication).
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
    config = llm_service.resolve_config(AIUseCase.SUGGESTIONS, llm_api_key, data.model)
    # Build messages from prompt template + request data
    # Call llm_service.complete(..., response_format=SuggestTagsResponse)
    # Track cost via Redis
    # Return parsed response
```

#### 4. Relationship suggestions — search step

The `/ai/suggest-relationships` endpoint needs to first find candidate items to evaluate. Use the existing `ContentService` search to find items with similar tags or text, then pass the top N candidates to the LLM for relevance judgment.

Use the existing `ContentService` search with the item's title as the query. This leverages the existing full-text search infrastructure. Deduplicate and exclude the source item. Send the top 10 candidates to the LLM — enough for meaningful suggestions without excessive token cost. The exact search strategy (title-only vs title+tags) can be tuned during implementation based on result quality.

#### 5. Prompt argument suggestions

A single endpoint handles all three argument suggestion use cases — the LLM context is the same (prompt content + argument info) and the response format is the same (list of argument objects).

```python
class SuggestArgumentsRequest(BaseModel):
    model: str | None = None                    # BYOK model override
    prompt_content: str | None = Field(None, max_length=5000)  # the prompt template text
    arguments: list[ArgumentInput] = []         # existing arguments (for context)
    target: str | None = None                   # which argument to suggest for (name or index); null = generate all

class ArgumentInput(BaseModel):
    name: str | None = Field(None, max_length=200)
    description: str | None = Field(None, max_length=500)

class ArgumentSuggestion(BaseModel):
    name: str
    description: str

class SuggestArgumentsResponse(BaseModel):
    arguments: list[ArgumentSuggestion]
```

**Three use cases, one endpoint:**
- **Generate all arguments:** Send `prompt_content` with no `target`. The LLM analyzes the prompt template, identifies `{{ variable }}` placeholders, and returns a name + description for each. Existing `arguments` are included so the LLM doesn't duplicate them.
- **Suggest argument name:** Send `target` identifying the argument (by index or placeholder), with that argument's `description` populated and `name` empty. The LLM returns a single-item list with a suggested name. `prompt_content` is optional but improves quality.
- **Suggest argument description:** Send `target` identifying the argument, with that argument's `name` populated and `description` empty. The LLM returns a single-item list with a suggested description. `prompt_content` is optional but improves quality.

### Testing Strategy

- **Unit tests per endpoint (mock LLMService):**
  - Valid request → structured response with correct schema
  - Missing content (e.g. no title, no URL, no content) → still works (LLM does its best with what it has)
  - Free/Standard user → 402 quota exceeded
  - Pro user → success
  - BYOK user → success with user's key passed through
  - Verify prompt construction includes user's tag vocabulary from DB (sorted by frequency)
  - Verify prompt construction includes few-shot examples from recent items
  - Verify response excludes tags already in `current_tags`
  - Verify prompt construction truncates content_snippet if too long
  - Oversized `content_snippet` (exceeds max_length) → 422 validation error
  - BYOK model without structured output support → `llm_bad_request` error with clear message

- **Unit tests for relationship suggestions:**
  - Search step returns candidates → passed to LLM
  - Search returns no candidates → returns empty list (no LLM call needed)
  - Current item excluded from candidates
  - Candidate descriptions truncated to 200 chars in prompt

- **Unit tests for argument suggestions:**
  - Generate all: prompt content with `{{ placeholders }}` → returns name + description per placeholder
  - Generate all: existing arguments excluded from suggestions
  - Suggest name: argument with description only → returns suggested name
  - Suggest description: argument with name only → returns suggested description
  - No prompt content + no description → still returns best-effort suggestion
  - Prompt content improves suggestion quality (verified via prompt construction, not output)

- **Integration tests (mock LiteLLM, real DB):**
  - End-to-end flow: create a bookmark → call suggest-tags → get tags back
  - Rate limit enforcement: exhaust AI limit → 429

---

## Milestone 3: Suggestion Features — Frontend

> **Depends on:** Milestone 2 (Suggestion Backend). Milestone 1c (Cost Tracking) is recommended but not blocking — suggestions work without cost tracking, you just lack spend visibility.

### Goal & Outcome

After this milestone:

- Users can trigger tag/metadata suggestions from the bookmark/note/prompt edit UI
- A "Suggest tags" button appears near the tag input
- A "Suggest title/description" option is available when creating/editing items
- Suggestion results are shown as selectable options (not auto-applied)
- "AI Configuration" settings page exists with BYOK key management and per-use-case model selection
- Relationship suggestions are accessible from the item detail view

### Implementation Outline

#### 1. AI settings store + settings page

**Zustand store** (`stores/aiStore.ts`):
- `apiKey: string | null` — from localStorage
- `modelOverrides: Record<string, string>` — per-use-case model overrides, keyed by `AIUseCase` value (e.g. `{ "suggestions": "anthropic/claude-sonnet-4-6" }`). Only set for overrides — if a use case has no entry, the platform default is used. Persisted to localStorage.
- `setApiKey(key)` / `clearApiKey()` — persist to/from localStorage. Clearing the key also clears all model overrides.
- `setModelOverride(useCase, modelId)` / `clearModelOverride(useCase)` — set/remove a per-use-case override
- `isConfigured: boolean` — derived: true if BYOK key is set

The store values (`apiKey` and `modelOverrides`) are sent to the backend via the `X-LLM-Api-Key` header (key) and request body or query param (model) on each AI call. The backend's `resolve_config()` already handles this — user key + user model → use both; user key + no model → fall back to platform default.

**Settings page** — new page named "AI Configuration" in the sidebar, positioned before the existing "AI Integration" (MCP) page. Follows the existing `SettingsGeneral` layout pattern (`max-w-3xl pt-3`, section headings with `h2`, card-based controls with `rounded-lg border`).

The page fetches `/ai/models` on load to get the curated model list and per-use-case defaults.

**Section 1: API Key**

Always visible. Card-based layout:
- Input field (masked by default, with show/hide toggle)
- Clear key button (only shown when a key is set)
- Test connection button — calls `/ai/health` with the key. Success: green inline checkmark + "Connected". Failure: red inline text with the error message (e.g. "Key rejected by provider").
- Info text below input: "Your API key is stored only in this browser's local storage. It is never sent to our servers — it is passed directly to the LLM provider. If you use a different browser or device, you'll need to enter it again."
- Note: "When using your own key, API calls are billed directly by your provider."

**Section 2: Models**

Shows one row per use case. Each row displays:
- Use case label (e.g. "Suggestions", "Chat", "Auto-Complete", "Transform")
- The current model — either the platform default or the user's override

**Default state (no BYOK key):** Each row shows the platform default model name as read-only text. Dropdowns are disabled. A note above the section: "Included with your Pro plan. To use different models, provide your own API key above."

**BYOK state (key entered):** Each row has an active dropdown populated from the `/ai/models` response. The platform default is shown as the first option (e.g. "Gemini 2.5 Flash Lite (default)"). Selecting a different model sets an override in the store. Selecting the default clears the override.

For this plan, only the "Suggestions" use case is active. The other rows (Chat, Auto-Complete, Transform) should be shown but disabled with a "Coming soon" label — this communicates what's planned without hiding the structure.

Note above the dropdowns when BYOK is active: "Suggestion features require models that support structured output."

#### 2. Tag suggestion UI

**Trigger:** When the user clicks the tag icon to open the tag input, the frontend fires `POST /ai/suggest-tags` in the background — only if:
1. AI is available for the user's tier (check `available` from `/ai/health`, see §7 Feature Gating)
2. The item has at least some context to base suggestions on (title, description, content, or url exists). If the item is completely blank, don't fire — it would waste a rate-limited API call for useless results. No separate button — the suggestion request is tied to the intent of "I'm working on tags."

**Request:** The frontend sends the current item's state:
- `title`, `url` (if bookmark), `description`, `content_snippet` (first ~2000 chars of content)
- `current_tags` — the tags currently on this item (may include unsaved selections)
- `model` — BYOK model override if configured

The server handles all user context (tag vocabulary, few-shot examples) — see Milestone 2 §2.

**Display — detail/edit view:** Suggested tags appear as muted/transparent chips (e.g. dashed border, lower opacity) to the right of the existing tag pills. This visually separates "tags you have" from "tags the AI recommends." Clicking a suggestion promotes it — it moves to the left and adopts the standard chip style (added to the item's tags). Suggestions are dismissed automatically when the tag input is closed.

**Display — list view:** Same interaction. Existing tags appear on the left, suggestions appear to the right in the muted style. Clicking promotes them.

**Deduplication:** The server excludes tags already in `current_tags` from the response. The frontend doesn't need to filter.

**Error handling:** Silent. If the API call fails, no suggestions are shown — the tag input works normally. Log the error to the console. No toast (suggestions are a nice-to-have, not a critical flow).

**Loading state:** Defer until implementation. Test real latency first — with concurrent DB queries and a fast model (Gemini Flash Lite), latency may be low enough that a loading indicator isn't needed. Add one later if the delay is noticeable.

#### 3. Metadata suggestion UI

A sparkle/magic icon at the right edge of the title and description input fields on bookmark, note, and prompt edit forms. The interaction is the same across all content types.

**No user context needed:** Unlike tag suggestions, titles and descriptions are content-specific — there's no "user's titling style" to learn from. The client sends item context, the server calls the LLM directly.

**Icon states:**
1. **Hidden:** User doesn't have AI available (tier check from `/ai/health`, see §7)
2. **Visible + disabled (grayed out):** User has AI but insufficient context to generate from. Tooltip explains what's needed (e.g. "Add content to enable AI title suggestion").
3. **Visible + enabled:** Enough context exists. Clickable.

**Visibility conditions:**
- **Title icon enabled when:** description OR content exists (need something to derive a title from)
- **Description icon enabled when:** content exists (title alone isn't enough to generate a meaningful description; title + content works, content alone works)

**Behavior:** Clicking the icon calls `POST /ai/suggest-metadata`. On success, the suggested text replaces the field content. The user can undo via Cmd+Z (standard browser undo) or type over it. No preview/accept/dismiss modal — that's over-engineered for a single text field replacement.

**Error handling:** Same as tag suggestions — silent. If the API fails, nothing happens. Log to console.

**Loading state:** Defer until implementation — test real latency first.

**Prompt argument suggestions:** See §5 below for the prompt-specific argument suggestion UI.

#### 4. Relationship suggestion UI

Same UX pattern as tag suggestions — suggestions fire in the background, appear as muted chips, click to promote. Detail/edit view only (relationships are not managed from the list view).

**Trigger:** When the user clicks the link icon to open the linked content input, the frontend fires `POST /ai/suggest-relationships` in the background — only if:
1. AI is available for the user's tier (see §7 Feature Gating)
2. The item has at least some context to search by (title, description, content, or current_tags exists). If the item is completely blank, don't fire.

**Request:** The frontend sends the current item's state:
- `title`, `url` (if bookmark), `description`, `content_snippet` (first ~2000 chars)
- `current_tags` — gives the server additional search terms
- `existing_relationship_ids` — for deduplication (server excludes these from candidates)
- `model` — BYOK model override if configured

The server handles all search and LLM work — see Milestone 2 §4.

**Display:** Suggested items appear as muted/transparent chips (same visual treatment as tag suggestions) to the right of existing linked content chips. Clicking a suggestion promotes it — creates the relationship, chip adopts the standard linked content style. Suggestions are dismissed when the linked content input is closed.

**Search strategy:** The server runs full-text search using the item's title and tags as queries. A note for future: when pgvector semantic search lands, its results can be merged with full-text results for better candidate coverage. The plan works with full-text only for now.

**No candidates:** If search returns zero results, the server returns an empty list without making an LLM call. The frontend shows nothing — no error, no empty state message.

**Error handling:** Silent — same as tag suggestions. Log to console.

**Loading state:** Defer until implementation. Relationship suggestions involve two searches + an LLM call, so they may be slower than tag suggestions. Add a loading indicator later if needed.

#### 5. Prompt argument suggestion UI

Magic icons in the prompt editor's arguments section. Same three icon states as metadata suggestions (hidden / disabled with tooltip / enabled). See §6 for tier gating.

**Generate all arguments — magic icon next to the "+" (add argument) button:**
- Calls `POST /ai/suggest-arguments` with `prompt_content` and existing `arguments`, no `target`
- On success, appends the suggested arguments to the existing list
- **Icon enabled when:** prompt content exists
- **Icon disabled tooltip:** "Add prompt content to enable AI argument generation"

**Suggest argument name — magic icon next to the argument name field:**
- Calls `POST /ai/suggest-arguments` with `target` set to this argument, description populated
- On success, replaces the name field. Cmd+Z to undo.
- **Icon enabled when:** argument description exists
- **Icon disabled tooltip:** "Add a description to suggest a name"

**Suggest argument description — magic icon next to the argument description field:**
- Calls `POST /ai/suggest-arguments` with `target` set to this argument, name populated
- On success, replaces the description field. Cmd+Z to undo.
- **Icon enabled when:** argument name exists
- **Icon disabled tooltip:** "Add a name to suggest a description"

`prompt_content` is sent when available (improves quality) but is not required for individual name/description suggestions.

**Error handling:** Silent — same pattern as other suggestions. Log to console.

**Loading state:** Defer until implementation.

#### 6. API integration

All AI API calls include the BYOK key header if configured:

```tsx
const aiApi = {
  suggestTags: (data: SuggestTagsRequest) =>
    api.post<SuggestTagsResponse>('/ai/suggest-tags', {
      ...data,
      model: aiStore.getModelOverride('suggestions'),  // null if no override
    }),
  // ...
}
```

The BYOK API key is sent via an axios request interceptor that conditionally adds the `X-LLM-Api-Key` header for `/ai/` paths — this keeps the key logic in one place. The model override is sent in the request body since it's per-use-case data (different use cases may use different models). The backend ignores `model` when no BYOK key is present.

#### 7. Feature gating

AI features should be hidden/disabled for users whose tier doesn't support them. The `/ai/health` endpoint (or the user's limits from `useLimits()`) tells the frontend whether AI is available. Don't show suggestion buttons to Free/Standard users — or show them disabled with an upgrade prompt.

### Testing Strategy

- **Component tests:**
  - Tag suggestions: opening tag input triggers suggestion request (if AI available)
  - Tag suggestions: muted chips appear to the right of existing tags
  - Tag suggestions: clicking a suggestion promotes it to a regular tag (moves left, standard style)
  - Tag suggestions: closing tag input clears suggestions
  - Tag suggestions: API error → no suggestions shown, no toast, error logged to console
  - Tag suggestions: not triggered for non-Pro users (no API call fired)
  - Tag suggestions: not triggered when item is completely blank (no title, description, content, or url)
  - Relationship suggestions: opening linked content input triggers suggestion request (if AI available + item has context)
  - Relationship suggestions: muted chips appear to the right of existing linked content chips
  - Relationship suggestions: clicking a suggestion promotes it (creates relationship, standard chip style)
  - Relationship suggestions: closing linked content input clears suggestions
  - Relationship suggestions: not triggered when item is completely blank
  - Relationship suggestions: not triggered for non-Pro users
  - Relationship suggestions: API error → no suggestions shown, error logged to console
  - Metadata suggestion: icon hidden for non-Pro users
  - Metadata suggestion: icon disabled (grayed out) when insufficient context, tooltip shown
  - Metadata suggestion: title icon enabled when description or content exists
  - Metadata suggestion: description icon enabled when content exists
  - Metadata suggestion: click replaces field content with suggestion
  - Metadata suggestion: Cmd+Z undoes the replacement
  - Metadata suggestion: API error → nothing happens, error logged to console
  - Prompt arguments: generate-all icon enabled when prompt content exists, disabled otherwise
  - Prompt arguments: generate-all appends suggestions to existing argument list
  - Prompt arguments: suggest-name icon enabled when argument description exists
  - Prompt arguments: suggest-description icon enabled when argument name exists
  - Prompt arguments: click replaces field content, Cmd+Z undoes
  - Prompt arguments: all icons hidden for non-Pro users
  - Prompt arguments: API error → nothing happens, error logged to console
  - AI settings (default state): shows platform default model per use case as read-only text, dropdowns disabled
  - AI settings (BYOK state): entering key persists to localStorage, model dropdowns become active
  - AI settings: selecting a model sets override in store, selecting default clears override
  - AI settings: clearing key removes key and all model overrides from localStorage, reverts to default state
  - AI settings: test connection success → green checkmark + "Connected"
  - AI settings: test connection failure → red inline error message
  - AI settings: info text about localStorage-only storage is visible
  - AI settings: non-active use cases (Chat, Auto-Complete, Transform) shown as disabled with "Coming soon"
  - AI settings: page fetches `/ai/models` on load, handles loading/error states

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
- Input validation: `max_length` on all Pydantic request schema string fields to prevent cost abuse at the API boundary (see Milestone 2, section 1)
- Prompt injection: structured output (Pydantic `response_format`) helps enforce expected response format for suggestion features

### Cost Management

- **Real-time tracking:** Redis hashes accumulate cost + count per user and per use-case/model/key-source with hourly buckets (see Milestone 1c, section 1)
- **Historical data:** Separate hourly Railway cron service flushes Redis to `ai_usage` DB table (see Milestone 1c, section 2)
- **Cost calculation:** Both streaming and non-streaming use `completion_cost(completion_response=response)` — the public LiteLLM API. Do not use `_hidden_params` (private, unstable across versions).
- **Audit trail:** Every LLM call emits a structured info log with metadata (user_id, use_case, model, key_source, cost, latency). Never log prompts, completions, or API keys.
- CRITICAL: Remind the engineer to set a monthly budget alert on the Gemini API key
- Consider a daily platform cost cap that disables platform AI if exceeded (emergency brake) — can be checked against Redis per-user key before each call
- Content snippet truncation: enforced via `max_length` on Pydantic request schemas (see Milestone 2, section 1)
