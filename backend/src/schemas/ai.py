"""Request/response schemas for AI suggestion endpoints."""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


# ---------------------------------------------------------------------------
# Shared error response
# ---------------------------------------------------------------------------


class AIErrorResponse(BaseModel):
    """
    Common error envelope for AI endpoint failures.

    All AI endpoints return errors in this shape (possibly with additional
    fields for quota / field-limit errors). The `error_code` field lets
    clients distinguish error classes without parsing the human-readable
    `detail` message.
    """

    detail: str = Field(
        ...,
        description="Human-readable error message safe to surface to end users.",
    )
    error_code: str | None = Field(
        None,
        description=(
            "Machine-readable error identifier. Present for typed errors "
            "(`llm_auth_failed`, `llm_rate_limited`, `llm_timeout`, `llm_bad_request`, "
            "`llm_connection_error`, `llm_unavailable`, `QUOTA_EXCEEDED`, "
            "`FIELD_LIMIT_EXCEEDED`). Absent for generic errors such as 429 platform "
            "rate-limit, 422 request validation, and 451 consent-required."
        ),
    )


# ---------------------------------------------------------------------------
# Context models (passed from router → service → prompt builder)
# ---------------------------------------------------------------------------


class TagVocabularyEntry(BaseModel):
    """A tag from the user's vocabulary with usage count."""

    name: str
    count: int


class RelationshipCandidateContext(BaseModel):
    """
    A candidate item passed to the relationship suggestion service.

    Distinct from RelationshipCandidate (the public API response schema)
    — this includes description and content_preview for prompt building.
    """

    entity_id: str
    entity_type: str
    title: str
    description: str
    content_preview: str


# ---------------------------------------------------------------------------
# Health / Models (config endpoints — no AI rate limit consumed)
# ---------------------------------------------------------------------------


class AIHealthResponse(BaseModel):
    """Availability + remaining AI quota for the caller."""

    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {"available": True, "byok": False, "remaining_daily": 497, "limit_daily": 500},
                {"available": True, "byok": True, "remaining_daily": 1998, "limit_daily": 2000},
            ],
        },
    )

    available: bool = Field(
        ...,
        description=(
            "Whether AI features are available for this user at all. False for tiers "
            "whose platform *and* BYOK daily limits are both zero."
        ),
    )
    byok: bool = Field(
        ...,
        description=(
            "Whether the current request included an `X-LLM-Api-Key` header. "
            "Determines which rate-limit bucket the `remaining_daily` / `limit_daily` "
            "values reflect (BYOK vs platform)."
        ),
    )
    remaining_daily: int = Field(
        ...,
        description="Remaining calls in the current UTC day for this bucket.",
    )
    limit_daily: int = Field(..., description="Total daily limit for this bucket and tier.")


class AIModelEntry(BaseModel):
    """One supported model with pricing."""

    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "id": "openai/gpt-5.4-nano",
                    "provider": "openai",
                    "tier": "budget",
                    "input_cost_per_million": 0.05,
                    "output_cost_per_million": 0.40,
                },
            ],
        },
    )

    id: str = Field(
        ...,
        description="Provider-prefixed model ID to pass as `model` on suggestion requests.",
    )
    provider: str = Field(..., description="`openai`, `google`, or `anthropic`.")
    tier: str = Field(
        ...,
        description="Relative quality/price tier: `budget`, `balanced`, or `flagship`.",
    )
    input_cost_per_million: float | None = Field(
        None,
        description=(
            "USD per million input tokens, if known. Absent only when LiteLLM "
            "doesn't have a cost entry."
        ),
    )
    output_cost_per_million: float | None = Field(
        None,
        description="USD per million output tokens, if known.",
    )


class AIModelsResponse(BaseModel):
    """Curated list of supported models and per-use-case defaults."""

    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "models": [
                        {
                            "id": "openai/gpt-5.4-nano",
                            "provider": "openai",
                            "tier": "budget",
                            "input_cost_per_million": 0.05,
                            "output_cost_per_million": 0.40,
                        },
                    ],
                    "defaults": {
                        "suggestions": "openai/gpt-5.4-nano",
                        "transform": "gemini/gemini-flash-lite-latest",
                        "auto_complete": "gemini/gemini-flash-lite-latest",
                        "chat": "openai/gpt-5.4-mini",
                    },
                },
            ],
        },
    )

    models: list[AIModelEntry] = Field(
        ...,
        description="All supported models (GA only, no preview/experimental).",
    )
    defaults: dict[str, str] = Field(
        ...,
        description=(
            "Per-use-case default model ID. Keys correspond to the `AIUseCase` enum: "
            "`suggestions`, `transform`, `auto_complete`, `chat`. Platform callers "
            "(no BYOK key) are always routed to the default for the endpoint's use "
            "case regardless of the `model` field they send."
        ),
    )


# ---------------------------------------------------------------------------
# Validate Key
# ---------------------------------------------------------------------------


class ValidateKeyResponse(BaseModel):
    """Result of probing a BYOK key against the selected provider."""

    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {"valid": True},
                {"valid": False, "error": "API key rejected by provider"},
            ],
        },
    )

    valid: bool = Field(..., description="Whether the provider accepted the key.")
    error: str | None = Field(
        None,
        description="Short reason string when `valid` is false. Never echoes the key itself.",
    )


class ValidateKeyRequest(BaseModel):
    """Request for key validation. Model determines which provider to test against."""

    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {"model": "openai/gpt-5.4-nano"},
                {"model": "anthropic/claude-haiku-4-5"},
            ],
        },
    )

    model: str | None = Field(
        None,
        description=(
            "Optional supported model ID used to pick the provider to validate the "
            "supplied `X-LLM-Api-Key` against. If omitted, the server validates using "
            "a default model. Call `GET /ai/models` for the supported list."
        ),
    )


# ---------------------------------------------------------------------------
# Suggest Tags
# ---------------------------------------------------------------------------


class SuggestTagsRequest(BaseModel):
    """
    Request for tag suggestions.

    The caller provides whatever metadata it has about the entity (title, url,
    description, content_snippet) — at least one should be present for useful
    results. The server additionally loads the top ~100 most-used tags from
    the caller's tag vocabulary and includes them in the LLM prompt so that
    suggestions prefer existing tags over novel ones.
    """

    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "content_type": "bookmark",
                    "title": "How async/await works under the hood",
                    "url": "https://example.com/posts/async-internals",
                    "description": "A deep dive into Python's event loop.",
                    "content_snippet": "The event loop sits at the heart of asyncio...",
                    "current_tags": ["python"],
                },
            ],
        },
    )

    model: str | None = Field(
        None,
        description=(
            "Optional supported model ID (e.g. `openai/gpt-5.4-mini`). Only honored "
            "when a BYOK key is supplied via `X-LLM-Api-Key`; platform callers are "
            "silently locked to the use-case default. Call `GET /ai/models` for the "
            "supported list."
        ),
    )
    content_type: Literal["bookmark", "note", "prompt"] = Field(
        ...,
        description="Entity type being tagged. Determines the prompt template used.",
    )
    title: str | None = Field(
        None, max_length=500,
        description="Entity title used as LLM context.",
    )
    url: str | None = Field(
        None, max_length=2048,
        description="Bookmark URL used as LLM context. Typically omitted for notes/prompts.",
    )
    description: str | None = Field(
        None, max_length=2000,
        description="Entity description used as LLM context.",
    )
    content_snippet: str | None = Field(
        None, max_length=10_000,
        description=(
            "Up to 10 KB of body content. Callers are responsible for truncation — "
            "the server rejects longer payloads with a 400 `FIELD_LIMIT_EXCEEDED`."
        ),
    )
    current_tags: list[str] = Field(
        default_factory=list,
        description="Tags already applied to the entity. Excluded from the suggestion set.",
    )


class SuggestTagsResponse(BaseModel):
    """Response with suggested tags."""

    model_config = ConfigDict(
        json_schema_extra={
            "examples": [{"tags": ["async", "python", "event-loop", "concurrency"]}],
        },
    )

    tags: list[str] = Field(
        ...,
        description=(
            "Suggested tags, already filtered to exclude `current_tags`. Order is "
            "LLM-provided and loosely represents confidence — preferred tags first."
        ),
    )


# ---------------------------------------------------------------------------
# Suggest Metadata
# ---------------------------------------------------------------------------


class SuggestMetadataRequest(BaseModel):
    """
    Request for title and/or description suggestions.

    The `fields` array controls which fields are **generated** by the LLM.
    Any existing `title` / `description` values supplied in the request are
    used as **context** for generating the requested fields — they are not
    overwritten and are not returned in the response unless explicitly
    requested via `fields`.

    Example: to regenerate only the description while keeping the existing
    title as grounding context, send `fields: ["description"]` along with
    the current `title` value.
    """

    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "fields": ["title", "description"],
                    "url": "https://example.com/posts/async-internals",
                    "content_snippet": "The event loop sits at the heart of asyncio...",
                },
                {
                    "fields": ["description"],
                    "title": "Async/await internals",
                    "content_snippet": "The event loop sits at the heart of asyncio...",
                },
            ],
        },
    )

    model: str | None = Field(
        None,
        description=(
            "Optional supported model ID. Only honored when a BYOK key is supplied "
            "via `X-LLM-Api-Key`; platform callers are silently locked to the "
            "use-case default. Call `GET /ai/models` for the supported list."
        ),
    )
    fields: list[Literal["title", "description"]] = Field(
        default_factory=lambda: ["title", "description"],
        description=(
            "Which fields to generate. Must contain at least one of `title` or "
            "`description`. Fields *not* listed here are used as LLM context when "
            "supplied but are not returned in the response."
        ),
    )
    url: str | None = Field(
        None, max_length=2048,
        description="Bookmark URL used as LLM context.",
    )

    @field_validator("fields")
    @classmethod
    def fields_not_empty(cls, v: list) -> list:
        """At least one field must be requested."""
        if not v:
            raise ValueError("fields must contain at least one of 'title' or 'description'")
        return v

    title: str | None = Field(
        None, max_length=500,
        description=(
            "Existing title used as LLM context. Not returned unless `title` is "
            "included in `fields`."
        ),
    )
    description: str | None = Field(
        None, max_length=2000,
        description=(
            "Existing description used as LLM context. Not returned unless "
            "`description` is included in `fields`."
        ),
    )
    content_snippet: str | None = Field(
        None, max_length=10_000,
        description=(
            "Up to 10 KB of body content. Caller is responsible for truncation; the "
            "server rejects longer payloads with a 400 `FIELD_LIMIT_EXCEEDED`."
        ),
    )


class SuggestMetadataResponse(BaseModel):
    """Response with suggested title and/or description."""

    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "title": "Async/await internals in Python",
                    "description": "A walkthrough of how the event loop schedules coroutines.",
                },
                {
                    "title": None,
                    "description": "A walkthrough of how the event loop schedules coroutines.",
                },
            ],
        },
    )

    title: str | None = Field(
        None,
        description="Generated title. `null` unless `title` was in the request `fields`.",
    )
    description: str | None = Field(
        None,
        description=(
            "Generated description. `null` unless `description` was in the "
            "request `fields`."
        ),
    )


# Internal response models for structured output — each tells the LLM
# exactly which field(s) to generate.

class _TitleOnly(BaseModel):
    """Internal: LLM response format when only title is requested."""

    title: str


class _DescriptionOnly(BaseModel):
    """Internal: LLM response format when only description is requested."""

    description: str


class _TitleAndDescription(BaseModel):
    """Internal: LLM response format when both fields are requested."""

    title: str
    description: str


# ---------------------------------------------------------------------------
# Suggest Relationships
# ---------------------------------------------------------------------------


class SuggestRelationshipsRequest(BaseModel):
    """
    Request for relationship suggestions.

    The server first performs an internal FTS search across the caller's
    bookmarks, notes, and prompts to find candidate items matching the
    supplied title/description and tags. The LLM is then asked to pick
    the most relevant subset from those candidates. If all of `title`,
    `description`, and `current_tags` are empty, the response is an
    immediate empty list (no LLM call, no quota consumed).
    """

    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "title": "How async/await works under the hood",
                    "description": "A deep dive into Python's event loop.",
                    "current_tags": ["python", "async"],
                    "source_id": "01234567-89ab-7def-0123-456789abcdef",
                    "existing_relationship_ids": [],
                },
            ],
        },
    )

    model: str | None = Field(
        None,
        description=(
            "Optional supported model ID. Only honored with BYOK. Call "
            "`GET /ai/models` for the supported list."
        ),
    )
    source_id: str | None = Field(
        None,
        description=(
            "ID of the item being related (the source). If supplied, it is excluded "
            "from candidate results so the item never suggests itself as a relation."
        ),
    )
    title: str | None = Field(
        None, max_length=500,
        description="Title of the source item. Used for both candidate search and LLM grounding.",
    )
    url: str | None = Field(
        None, max_length=2048,
        description="URL of the source item. Used as LLM context.",
    )
    description: str | None = Field(
        None, max_length=2000,
        description=(
            "Description of the source item. Used for both candidate search "
            "and LLM grounding."
        ),
    )
    content_snippet: str | None = Field(
        None, max_length=10_000,
        description="Up to 10 KB of body content used as LLM context.",
    )
    current_tags: list[str] = Field(
        default_factory=list,
        description=(
            "Tags on the source item. Used to find tag-based candidates in addition "
            "to the title/description FTS search."
        ),
    )
    existing_relationship_ids: list[str] = Field(
        default_factory=list,
        description=(
            "IDs of items already linked to the source. Excluded from candidate "
            "results so the response only contains *new* potential relationships."
        ),
    )


class RelationshipCandidate(BaseModel):
    """A candidate item for a relationship suggestion."""

    entity_id: str = Field(..., description="UUID of the candidate item.")
    entity_type: str = Field(..., description="One of `bookmark`, `note`, or `prompt`.")
    title: str = Field(..., description="Candidate's title, for display.")


class SuggestRelationshipsResponse(BaseModel):
    """Response with relationship candidates."""

    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "candidates": [
                        {
                            "entity_id": "01920000-0000-7000-8000-000000000001",
                            "entity_type": "bookmark",
                            "title": "Python asyncio documentation",
                        },
                    ],
                },
                {"candidates": []},
            ],
        },
    )

    candidates: list[RelationshipCandidate] = Field(
        ...,
        description=(
            "LLM-filtered relevant candidates. Empty list if no candidates were "
            "found, or if the source item had no `title`/`description`/`current_tags` "
            "to match against (in which case no LLM call is made)."
        ),
    )


# ---------------------------------------------------------------------------
# Suggest Arguments
# ---------------------------------------------------------------------------


class ArgumentInput(BaseModel):
    """An existing argument provided for context."""

    name: str | None = Field(
        None, max_length=200,
        description="Argument identifier as used in the prompt template (e.g. `user_query`).",
    )
    description: str | None = Field(
        None, max_length=500,
        description="Human-readable description of what the argument represents.",
    )


class SuggestArgumentsRequest(BaseModel):
    """
    Request for prompt argument suggestions.

    Two modes:

    - **Generate-all** (`target_index: null`): extract every placeholder in
      `prompt_content` that isn't already covered by `arguments`, and propose
      name + description + required flag for each new one.
    - **Individual** (`target_index: N`): suggest either a name *or* a
      description for `arguments[N]` depending on which field is currently
      missing on that entry. If both are missing the server picks description.
    """

    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "prompt_content": "Summarize {{ document }} in {{ num_sentences }} sentences.",
                    "arguments": [],
                    "target_index": None,
                },
                {
                    "prompt_content": "Summarize {{ document }} in {{ num_sentences }} sentences.",
                    "arguments": [
                        {"name": "document", "description": None},
                        {"name": "num_sentences", "description": None},
                    ],
                    "target_index": 0,
                },
            ],
        },
    )

    model: str | None = Field(
        None,
        description=(
            "Optional supported model ID. Only honored with BYOK. Call "
            "`GET /ai/models` for the supported list."
        ),
    )
    prompt_content: str | None = Field(
        None, max_length=50_000,
        description=(
            "The prompt template text (Jinja2). Up to 50 KB. Required for "
            "generate-all mode; optional context for individual mode."
        ),
    )
    arguments: list[ArgumentInput] = Field(
        default_factory=list,
        description=(
            "Existing arguments. In generate-all mode, used to skip already-defined "
            "placeholders. In individual mode, the entry at `target_index` is the "
            "one being filled in."
        ),
    )
    target_index: int | None = Field(
        None, ge=0,
        description=(
            "Zero-based index into `arguments` identifying which entry to refine. "
            "`null` selects generate-all mode. Must be a valid index when set."
        ),
    )


class ArgumentSuggestion(BaseModel):
    """A suggested argument with name, description, and required flag."""

    name: str = Field(
        ...,
        description="Argument identifier (lowercase with underscores — e.g. `code_to_review`).",
    )
    description: str = Field(
        ...,
        description="Plain-language description of what the argument represents.",
    )
    required: bool = Field(
        False,
        description="Whether the template appears to treat this argument as required.",
    )


class SuggestArgumentsResponse(BaseModel):
    """Response with suggested arguments."""

    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "arguments": [
                        {
                            "name": "document",
                            "description": "The source text to summarize.",
                            "required": True,
                        },
                        {
                            "name": "num_sentences",
                            "description": "How many sentences to produce.",
                            "required": True,
                        },
                    ],
                },
            ],
        },
    )

    arguments: list[ArgumentSuggestion] = Field(
        ...,
        description=(
            "In generate-all mode: all new placeholders detected in `prompt_content`. "
            "In individual mode: a single-element list containing the refined entry."
        ),
    )


# Internal response models for individual mode — each tells the LLM
# exactly which field to generate (like _TitleOnly/_DescriptionOnly for metadata).

class _ArgumentNameSuggestion(BaseModel):
    """Internal: LLM response format when suggesting a name for an argument."""

    name: str


class _ArgumentDescriptionSuggestion(BaseModel):
    """Internal: LLM response format when suggesting a description for an argument."""

    description: str
