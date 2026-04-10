# LLM Suggestion Evals

**Date:** 2026-04-08
**Status:** Draft

## Overview

Add evaluation tests for the four AI suggestion endpoints (`suggest-tags`, `suggest-metadata`, `suggest-relationships`, `suggest-arguments`). These evals verify that the LLM produces useful, well-formatted suggestions given realistic content.

**Key difference from MCP evals:** The MCP evals test whether an LLM can choose the right tool and call it correctly (tool selection). The suggestion evals test whether our prompts + structured output schemas produce good results (output quality). There's no tool selection step — the eval calls the suggestion function directly and checks the response.

**Framework:** Uses `flex-evals` with YAML config files, the `@evaluate` decorator, `contains`/`exact_match`/`equals` checks for deterministic assertions, and `LLMJudgeCheck` for semantic quality where exact matching is too brittle.

**Model under test:** The default platform model (`gemini/gemini-2.5-flash-lite`) since it's the cheapest and most likely to surface prompt quality issues. Better models would mask weak prompts.

**LLM-as-judge model:** `gemini/gemini-2.5-flash` — a stronger model than the one being tested. The judge should not be the same budget model evaluating its own output.

**Pass threshold:** 80%, lowered if needed after observing real variance.

**Structure:**
```
evals/
  ai_suggestions/
    config_suggest_tags.yaml
    config_suggest_metadata.yaml
    config_suggest_relationships.yaml
    config_suggest_arguments.yaml
    test_suggest_tags.py
    test_suggest_metadata.py
    test_suggest_relationships.py
    test_suggest_arguments.py
    results/              # gitignored, written by flex-evals
```

**Eval approach — call functions directly, not HTTP endpoints:**

The suggestion logic is extracted from the API router into a service layer (Milestone 0). Each suggestion function accepts all context as parameters — no database queries, no HTTP dependencies. The API router becomes a thin wrapper that fetches DB context and delegates to the service.

Evals import and call the service functions directly in-process, passing curated test data from the YAML config. This means:
- No running API server needed for evals
- No database dependency — tag vocabulary, few-shot examples, and relationship candidates are passed as parameters
- Fully reproducible — identical inputs produce identical LLM calls regardless of dev database state
- The only external dependency is the LLM provider (real API calls to gemini-2.5-flash-lite)

---

## Milestone 0: Extract Suggestion Service Layer

### Goal & Outcome

After this milestone:

- Suggestion logic is extracted from the API router into `services/suggestion_service.py`
- Each suggestion type is a standalone async function that accepts all context as parameters
- The API router delegates to these functions (thin HTTP wrapper)
- Prompt quality improvements: expanded tag vocabulary (100 with counts), richer few-shot examples (20, type-scoped, with descriptions), relationship search uses title + description
- Response caps enforced in service layer (7 tags, 5 relationships)
- `content_type` field added to `SuggestTagsRequest` (required) — frontend updated to pass it
- Request schema `max_length` constraints relaxed — abuse prevention only, service controls prompt truncation
- Service-level unit tests cover core logic (dedup, caps, filtering, error handling)
- All existing API-level tests pass (tag suggestion tests updated for required `content_type` field)

### Implementation Outline

#### 1. Create `backend/src/services/suggestion_service.py`

Extract four functions, one per suggestion type. Each function takes pre-fetched context as parameters and returns the response model. The function is responsible for: building the prompt → calling the LLM → parsing the response → post-processing (filtering, dedup, validation).

**Key design principle:** No database queries inside the service functions. The router fetches any DB-dependent context (tag vocabulary, few-shot examples, relationship candidates) and passes it in.

**Use Pydantic models for structured context parameters** instead of `list[dict]`. This makes the contract between router → service → prompt builder explicit and enforces it for both API callers and eval callers.

```python
# schemas/ai.py — new context models

class TagVocabularyEntry(BaseModel):
    """A tag from the user's vocabulary with usage count."""
    name: str
    count: int

class TagFewShotExample(BaseModel):
    """A recent item used as a tagging style reference in tag suggestion prompts."""
    title: str
    description: str
    tags: list[str]

class RelationshipCandidateContext(BaseModel):
    """A candidate item passed to the relationship suggestion service.
    Distinct from RelationshipCandidate (the public API response schema)
    — this includes description and content_preview for prompt building."""
    entity_id: str
    entity_type: str
    title: str
    description: str
    content_preview: str
```

These replace the `list[dict]` parameters currently used in `build_tag_suggestion_messages()` and `build_relationship_suggestion_messages()`. `RelationshipCandidate` (the existing public response schema with `entity_id`, `entity_type`, `title`) remains unchanged. Update the prompt builders to accept the Pydantic models.

**Docstring requirements:** Every service function must have a clear docstring that specifies:
- What the function does (purpose)
- Implicit constraints on list inputs/outputs (min/max lengths, caps, filtering rules)
- What post-processing is applied (dedup, validation, truncation)
- What errors it raises

This makes the contract self-documenting for both router callers and eval callers.

**Return types:** Service functions return raw data (not HTTP response models). Use dataclasses or Pydantic models where applicable to keep the contract explicit. The router wraps results in API response schemas.

```python
# services/suggestion_service.py

@dataclass
class MetadataSuggestion:
    """Result from suggest_metadata. Only requested fields are non-None."""
    title: str | None
    description: str | None


async def suggest_tags(
    *,
    title: str | None,
    url: str | None,
    description: str | None,
    content_snippet: str | None,
    content_type: str,
    current_tags: list[str],
    tag_vocabulary: list[TagVocabularyEntry],
    few_shot_examples: list[TagFewShotExample],
    llm_service: LLMService,
    config: ResolvedConfig,
) -> tuple[list[str], float | None]:
    """Suggest tags for a content item based on its metadata and the user's tag vocabulary.

    Builds a prompt with the item context, user's tag vocabulary (up to 100 entries
    with usage counts), and few-shot examples (up to 20 items of the same content
    type). Calls the LLM and post-processes the response.

    Args:
        content_type: The entity type ("bookmark", "note", "prompt"). Included in
            the system prompt so the LLM can tailor suggestions to the content type.
        current_tags: Tags already on this item. Used for case-insensitive dedup
            against the LLM response.
        tag_vocabulary: User's existing tags sorted by frequency, up to 100 entries.
            Each entry includes name and usage count. Rendered in the prompt as
            "python (47), flask (12), api (8)" format.
        few_shot_examples: Recent items for tagging style reference, up to 20 items.
            Should be scoped to the same content_type by the caller.

    Returns:
        Tuple of (tags, cost). Tags are deduplicated against current_tags
        (case-insensitive) and capped at 7.

    Raises:
        LLMResponseParseError: If the LLM returns invalid/unparseable output
            (including empty response.choices). Carries cost so the caller can
            still track spend.
    """
    ...


async def suggest_metadata(
    *,
    fields: list[str],
    url: str | None,
    title: str | None,
    description: str | None,
    content_snippet: str | None,
    llm_service: LLMService,
    config: ResolvedConfig,
) -> tuple[MetadataSuggestion, float | None]:
    """Suggest title and/or description for a content item.

    The fields parameter controls which fields are generated. Existing values
    for non-requested fields are sent as context but not regenerated.

    Args:
        fields: Which fields to generate. Must contain at least one of
            "title", "description". Controls which structured output schema
            is used (_TitleOnly, _DescriptionOnly, _TitleAndDescription).

    Returns:
        Tuple of (MetadataSuggestion, cost). Only requested fields are non-None
        in the result. Generated title is prompted to be under 100 characters;
        no server-side truncation (the prompt instruction is the constraint).

    Raises:
        LLMResponseParseError: If the LLM returns invalid/unparseable output
            (including empty response.choices). Carries cost so the caller can
            still track spend.
    """
    ...


async def suggest_relationships(
    *,
    title: str | None,
    url: str | None,
    description: str | None,
    content_snippet: str | None,
    candidates: list[RelationshipCandidateContext],
    llm_service: LLMService,
    config: ResolvedConfig,
) -> tuple[list[RelationshipCandidate], float | None]:
    """Suggest related items from a pre-built candidate list.

    The caller is responsible for searching and deduplicating candidates.
    This function sends candidates to the LLM for relevance judgment and
    filters the response.

    Args:
        candidates: Pre-searched, pre-deduped candidate items, up to 10.
            Each includes entity_id, entity_type, title, description, and
            content_preview for prompt building.

    Returns:
        Tuple of (candidates, cost). Returned candidates are validated as a
        subset of input candidate IDs (no hallucinated IDs) and capped at 5.
        Returns ([], cost=None) immediately if candidates is empty (no LLM call).

    Raises:
        LLMResponseParseError: If the LLM returns invalid/unparseable output
            (including empty response.choices). Carries cost so the caller can
            still track spend.
    """
    ...


async def suggest_arguments(
    *,
    prompt_content: str | None,
    arguments: list[ArgumentInput],
    target: str | None,
    llm_service: LLMService,
    config: ResolvedConfig,
) -> tuple[list[ArgumentSuggestion], float | None]:
    """Suggest prompt template arguments.

    Two modes based on target:
    - target=None (generate-all): Extracts {{ placeholder }} names from
      prompt_content, excludes names already in arguments, and asks the LLM
      to generate descriptions for new placeholders. Returns early with an
      empty list if no new placeholders are found (no LLM call).
    - target=<name> (individual): Suggests a name and/or description for
      a specific argument.

    Args:
        prompt_content: The Jinja2 template text. Used for placeholder
            extraction in generate-all mode and as context in both modes.
        arguments: Existing arguments with name/description. In generate-all
            mode, names are excluded from placeholder extraction.
        target: Argument name to suggest for, or None for generate-all.

    Returns:
        Tuple of (suggestions, cost). Argument names are validated against
        ARG_NAME_PATTERN (lowercase_with_underscores, starts with letter);
        invalid names are filtered out. If the LLM omits `required`, it
        defaults to False (ArgumentSuggestion schema default).
        Returns ([], cost=None) in generate-all mode if prompt_content is
        None or all placeholders already have arguments (no LLM call).

    Raises:
        LLMResponseParseError: If the LLM returns invalid/unparseable output
            (including empty response.choices). Carries cost so the caller can
            still track spend.
    """
    ...
```

Each function returns `(result, cost)`. The router uses `cost` for `track_cost()`. On `LLMResponseParseError`, the router extracts `error.cost` and still tracks it (the provider was billed regardless of parse failure).

#### Response limits (enforced in service layer)

The service functions enforce hard maximums on returned suggestions, truncating if the LLM returns more:

- **Tags:** Max 7 (prompt says 3-7, but enforce the cap server-side)
- **Relationships:** Max 5 candidates

These are enforced after post-processing (dedup, filtering), so the truncation applies to the final result.

#### Prompt quality improvements (bundled with the refactor)

These changes improve suggestion quality and are natural to include since we're already changing function signatures and Pydantic models.

**Tag vocabulary — increase to 100 tags with counts:**

Currently top 50 tags by frequency, names only. Change to top 100 with usage counts. The prompt currently renders tags as a comma-separated list; change to include counts (e.g. `python (47), flask (12), api (8)`). This helps the LLM distinguish established tags from niche ones and prefer existing vocabulary. ~500 tokens for 100 tags — negligible.

The vocabulary comes from `get_user_tags_with_counts()` which already excludes inactive tags (archived/deleted items) by default. The `TagCount` object already has `content_count` — we're just not using it in the prompt today. Update the Pydantic context model:

```python
class TagVocabularyEntry(BaseModel):
    """A tag from the user's vocabulary with usage count."""
    name: str
    count: int
```

Replace `tag_vocabulary: list[str]` with `tag_vocabulary: list[TagVocabularyEntry]` in the service function and prompt builder. The router maps `TagCount` objects to `TagVocabularyEntry` (taking `content_count`).

**Few-shot examples — expand to 20, scoped by entity type:**

Currently 5 generic recent items regardless of content type. Change to up to 20 deduplicated examples:

1. **Up to 10 items of the same entity type sharing any current tags** — e.g., if tagging a bookmark with tags `python`, `api`, find up to 10 bookmarks tagged `python` OR `api` (recency-ranked)
2. **Up to 10 most recent items of the same entity type** — e.g., 10 most recent bookmarks regardless of tags
3. **Dedup** — if an item appears in both sets, keep it once

This requires adding `content_type: str` (`"bookmark"` | `"note"` | `"prompt"`) as a **required** field on `SuggestTagsRequest`. The frontend passes this when calling the endpoint. The router uses it to scope the few-shot queries by entity type. The service function receives the pre-fetched examples.

**Few-shot examples — include description:**

Currently the prompt builder receives `description` but doesn't render it. Add truncated description (~200 chars) to the few-shot example rendering. This gives the LLM more context about what the user considered important about each item, improving tagging style matching.

Update the prompt builder to render:
```
- "Flask REST API Tutorial" (A comprehensive guide to building REST APIs...) → python, flask, tutorial
```

**Relationship search — use title + description as query:**

Currently the title-based search uses only `data.title` as the query. Change to concatenate title + first 200 characters of description when both are available. This gives the full-text search more signal for finding relevant candidates.

#### Request schema `max_length` changes

The current `max_length` constraints on request schemas conflate abuse prevention with prompt quality control. The service layer should control truncation for prompt building (it knows the prompt budget). The API schema limits should only prevent abuse.

Changes to `schemas/ai.py`:

| Field | Current limit | New limit | Rationale |
|-------|--------------|-----------|-----------|
| `title` | 500 | Remove | Naturally short, service truncates if needed |
| `description` | 1000 | Remove | Naturally bounded, service truncates if needed |
| `url` | 2000 | 2048 | RFC standard, real constraint |
| `content_snippet` | 2500 | 10,000 | Service truncates for prompt budget |
| `prompt_content` | 5000 | 50,000 | Long templates need full context for accurate argument suggestions |

These apply across all four request schemas (`SuggestTagsRequest`, `SuggestMetadataRequest`, `SuggestRelationshipsRequest`, `SuggestArgumentsRequest`). The service functions handle truncation internally based on prompt budget.

#### Cross-references between API and evals

Add comments in the router and service layer pointing to the eval configs, so changes to context-fetching logic (e.g. changing from 5 to 10 few-shot examples, or adding tag counts) trigger a reminder to update eval test data:

```python
# In the router, where few-shot examples are fetched:
# NOTE: Eval test data mirrors this structure — update evals/ai_suggestions/
# config_suggest_tags.yaml if you change the number of examples or fields fetched.

# In the service function signatures:
# NOTE: Eval configs pass these parameters directly — update eval YAML configs
# if you change the parameter contract.
```

#### 2. Slim down the router (`backend/src/api/routers/ai.py`)

Each endpoint becomes:
1. Resolve LLM config
2. Fetch DB-dependent context (tags: vocabulary + few-shot; relationships: search candidates)
3. Call the service function
4. Track cost
5. Return response

Example for tags:
```python
@router.post("/suggest-tags", response_model=SuggestTagsResponse)
async def suggest_tags_endpoint(data, current_user, llm_api_key, _rate_limit, db):
    llm_service = get_llm_service()
    config = llm_service.resolve_config(AIUseCase.SUGGESTIONS, ...)

    tag_counts = await get_user_tags_with_counts(db, current_user.id)
    few_shot_examples = await _get_few_shot_examples(
        db, current_user.id, data.current_tags, data.content_type,
    )

    tags, cost = await suggestion_service.suggest_tags(
        title=data.title, url=data.url, ...,
        tag_vocabulary=[
            TagVocabularyEntry(name=tc.name, count=tc.content_count)
            for tc in tag_counts[:100]
        ],
        few_shot_examples=few_shot_examples,
        llm_service=llm_service, config=config,
    )

    await track_cost(...)
    return SuggestTagsResponse(tags=tags)
```

#### 3. Move `_parse_llm_response` to service layer

This is currently a private function in the router. It belongs in the service since the service handles LLM response parsing. (`_sanitize_structured_content` is already in `llm_service.py` — no move needed.)

**Error handling change:** `_parse_llm_response` currently raises `HTTPException(502)` on invalid LLM responses. Service functions should not raise HTTP exceptions. Add a `LLMResponseParseError` exception class in the service layer with a `cost: float | None` field — the provider was billed even if the response is unparseable. The router catches it, calls `track_cost()` with `error.cost`, and returns HTTP 502 with the existing `llm_invalid_response` error code.

```python
class LLMResponseParseError(Exception):
    """Raised when the LLM returns a response that cannot be parsed into the expected schema."""
    def __init__(self, message: str, cost: float | None = None):
        super().__init__(message)
        self.cost = cost
```

LiteLLM provider exceptions (`AuthenticationError`, `RateLimitError`, `Timeout`, etc.) are NOT caught by the service — they propagate through to the router's existing exception handler. This is the same boundary as today.

**Cost tracking on error:** The router always calls `track_cost()` when catching `LLMResponseParseError`, even when `error.cost` is None — `track_cost()` handles None gracefully (logs warning, skips Redis write). The service function should also check for empty `response.choices` before accessing `[0]` and raise `LLMResponseParseError` with whatever cost is available.

**Router maps `_get_few_shot_examples` output:** The router's `_get_few_shot_examples` helper returns data from DB queries. The router converts this to `list[TagFewShotExample]` before passing to the service function.

#### 4. Update prompt builders to accept Pydantic models

`build_tag_suggestion_messages()` currently takes `few_shot_examples: list[dict]` and accesses `.get("title")`, `.get("tags")`, etc. Update to accept `list[TagFewShotExample]` and use attribute access. Also add `content_type: str` parameter so the system prompt can say "You are tagging a {content_type}." Same for `build_relationship_suggestion_messages()` — update to accept `list[RelationshipCandidateContext]`.

#### 5. Relationship candidate search stays in the router

The relationship endpoint's search logic (title search + tag search + dedup) remains in the router because it requires DB access. The service function receives pre-built `candidates: list[RelationshipCandidateContext]`. The service validates that returned entity_ids are a subset of the input candidates (no hallucinated IDs) — this filtering logic moves from the router to the service.

#### 6. Frontend: pass `content_type` to suggest-tags

Update `frontend/src/types.ts` to add `content_type: string` to `SuggestTagsRequest`. Update the frontend call sites (hooks that call `suggestTags()`) to pass the content type (`'bookmark'`, `'note'`, or `'prompt'`). The content type is known at each call site from the component context.

### Testing Strategy

**Existing API-level tests** (`test_ai_suggestions.py`, `test_ai.py`) verify the router wiring is correct after the refactor. Tag suggestion tests will need `content_type` added to their request payloads since it's now a required field. All other endpoint tests should pass unchanged.

**New service-level tests** (`test_suggestion_service.py`) — mock `llm_service.complete()` and test the core logic:

- **Tag dedup:** LLM returns tags including one matching `current_tags` (case-insensitive) → filtered out
- **Tag cap:** LLM returns 10 tags → only 7 returned
- **Tag empty response:** LLM returns empty tags list → empty list returned
- **Relationship ID validation:** LLM returns candidate IDs not in input set → hallucinated IDs filtered out
- **Relationship cap:** LLM returns 8 candidates → only 5 returned
- **Relationship empty candidates:** Empty candidates input → empty result, no LLM call
- **Argument name filtering:** LLM returns invalid names (spaces, uppercase) → filtered out
- **Metadata field selection:** `fields=["title"]` → uses `_TitleOnly` response format, `description` is null in response
- **Metadata both fields:** `fields=["title", "description"]` → both populated
- **Parse error:** LLM returns invalid JSON → raises `LLMResponseParseError` (not HTTPException)
- **Parse error carries cost:** `LLMResponseParseError.cost` is populated so the router can still track spend
- **Cost passthrough:** Cost from `llm_service.complete()` is returned in the tuple
- **Argument placeholder extraction:** `suggest_arguments` with `target=None` extracts placeholders from `prompt_content`, excludes existing argument names, returns early if none are new
- **Argument early return:** All placeholders already have arguments → empty list returned, no LLM call

**New frontend tests:** Verify `content_type` is passed in `SuggestTagsRequest` from each call site.

Run `make backend-verify` and `make frontend-verify` to confirm everything passes.

---

## Milestone 1: Tag Suggestion Evals

### Goal & Outcome

After this milestone:

- Eval infrastructure for AI suggestions is established (helpers, Makefile target)
- Tag suggestion evals run against the default model
- Checks verify both structural correctness and semantic relevance

### Implementation Outline

#### 1. Shared helpers

Add to `evals/utils.py`:

- `create_bookmark_via_api(url, title, description, content, tags)` — Create a bookmark for test data setup. General utility alongside the existing `create_note_via_api`.

- `create_suggestion_checks(check_specs, llm_function, judge_models)` — Wraps `create_checks_from_config()`. For `type: "llm_judge"` checks, injects `llm_function` and `response_format` into `arguments` at load time. All other check types pass through unchanged. This keeps all check definitions in YAML while providing the runtime objects that `LLMJudgeCheck` requires.

```python
def create_suggestion_checks(
    check_specs: list[dict],
    llm_function: Callable,
    judge_response_models: dict[str, type[BaseModel]],
) -> list[Check]:
    """Create checks from YAML specs, injecting runtime objects for llm_judge checks."""
    checks = []
    for spec in check_specs:
        if spec["type"] == "llm_judge":
            # Inject runtime objects that can't be expressed in YAML
            spec["arguments"]["llm_function"] = llm_function
            model_key = spec["arguments"].get("response_model", "default")
            spec["arguments"]["response_format"] = judge_response_models[model_key]
        checks.append(Check(
            type=spec["type"],
            arguments=spec["arguments"],
            metadata=spec.get("metadata"),
        ))
    return checks
```

The `llm_function` callable uses `gemini/gemini-2.5-flash` (the judge model) with structured output. The `judge_response_models` dict maps check-specific model keys to Pydantic classes (e.g. `"tags": TagJudgeResult, "default": DefaultJudgeResult`).

#### 2. Makefile target

Add `evals-ai-suggestions` target:
```makefile
evals-ai-suggestions:  ## Run AI suggestion evaluations only
	PYTHONPATH=$(PYTHONPATH) uv run pytest evals/ai_suggestions/ -vs --timeout=300
```

Also add to the existing `evals` target so `make evals` runs everything.

#### 3. Test data strategy

Evals call `suggest_tags()` directly from `services/suggestion_service.py` — no HTTP server or database needed. All context is passed as parameters:

- `title`, `description`, `content_snippet`, `url` — defined in YAML test cases
- `current_tags` — defined in YAML test cases
- `tag_vocabulary` — curated list of ~30 tags defined in the test file (e.g. covering web dev, data science, devops, general programming). Larger than trivial to test vocabulary navigation, not just recognition. Each entry includes a realistic usage count.
- `few_shot_examples` — curated list defined in the test file. Examples use 2-4 lowercase hyphenated tags drawn from the curated vocabulary (consistent style). Include title + description + tags per example.
- `llm_service` + `config` — real LLM service with default model

This makes evals fully reproducible regardless of dev database state.

#### 4. Tag suggestion test cases (~6 cases)

Each test case defines realistic content and expected tags that should appear in the response.

**Test cases:**

| ID | Content | Expected tags (contains) |
|----|---------|------------------------|
| `python-flask-tutorial` | Bookmark: "Building REST APIs with Flask" + tutorial content | `python`, `flask` |
| `javascript-react-guide` | Bookmark: "React Hooks Deep Dive" + React content | `javascript`, `react` |
| `devops-docker-note` | Note: "Docker Compose for Local Development" | `devops`, `docker` |
| `machine-learning-paper` | Bookmark: ML paper about neural networks | `machine-learning` |
| `minimal-context` | Bookmark with only a title, no content/description | Still produces tags (from title alone) |
| `existing-tags-excluded` | Bookmark with `current_tags: ["python"]` | `python` NOT in response |
| `vocabulary-preference` | Content about "ML" where vocabulary contains `machine-learning` but not `ml` | `machine-learning` (prefers vocabulary form) |
| `tag-count-boundary` | Broad "2024 Year in Review" post covering many topics | Returns 3-7 tags (not more, even though many topics) |

#### 5. Checks

**Deterministic checks:**
- Tags is a non-empty list
- Each expected tag appears in the response (`contains` check)
- `current_tags` are excluded from response (`contains` with `negate`)

**LLM-as-judge check (for quality):**

All checks (deterministic and judge) are defined in the YAML config. The check loader detects `type: "llm_judge"` entries and injects the runtime objects (`llm_function` callable, `response_format` Pydantic class) at load time. This keeps all check definitions centralized in YAML.

Judge checks use `gemini/gemini-2.5-flash` (stronger than the model under test) and return structured responses with counts and reasoning for diagnosability:

```python
# Pydantic response model for tag judge
class TagJudgeResult(BaseModel):
    relevant_count: int
    total_count: int
    passed: bool
    reasoning: str
```

Example YAML judge check:
```yaml
- type: "llm_judge"
  arguments:
    prompt: |
      The content has this title: "{{$.test_case.input.title}}"
      and this description: "{{$.test_case.input.description}}".

      The suggested tags are: {{$.output.value.tags}}

      For each tag, score 1 if directly related to the content's topic or domain, 0 if not.
      Return relevant_count, total_count, and passed=true if all tags score 1.
      Include brief reasoning.
  metadata:
    name: "Tags are relevant"
```

The loader injects `response_format: TagJudgeResult` and `llm_function` (a callable that calls gemini-2.5-flash with structured output) when it sees `type: "llm_judge"`.

### Testing Strategy

- 6 test cases × 10 samples × 1 model = 60 LLM calls
- Pass threshold: 80%
- No database or HTTP server needed — calls service function directly

---

## Milestone 2: Metadata Suggestion Evals

### Goal & Outcome

After this milestone:

- Metadata (title/description) suggestion evals verify quality across content types
- Checks cover the `fields` parameter logic and output format constraints

### Implementation Outline

#### 1. Test data

No database entities needed — evals call `suggest_metadata()` directly with all context as parameters. Test cases define content with deliberately weak/missing titles and descriptions directly in the YAML config.

#### 2. Metadata suggestion test cases (~6 cases)

| ID | Content type | Fields requested | Expected behavior |
|----|-------------|-----------------|-------------------|
| `title-from-content` | Bookmark with rich content, no title | `["title"]` | Title is concise, relevant to content |
| `description-from-content` | Note with title + content, no description | `["description"]` | Description summarizes content in 1-2 sentences |
| `both-fields` | Bookmark with content, no title or description | `["title", "description"]` | Both populated, title concise, description longer |
| `title-with-existing-description` | Bookmark with description, requesting title | `["title"]` | `description` field is null in response |
| `description-with-existing-title` | Note with title, requesting description | `["description"]` | `title` field is null in response |
| `url-context` | Bookmark with URL + content | `["title", "description"]` | Suggestions are relevant to the URL's domain/topic |

#### 3. Checks

**Deterministic checks:**
- Requested fields are non-null in response
- Unrequested fields are null in response
- Title length ≤ 100 characters (prompt instruction, not schema)
- Description is 1-2 sentences (prompt instruction)

**LLM-as-judge checks:**

Same YAML-defined + runtime-injected approach as tag evals. Judge response model: `{passed: bool, reasoning: str}`.

- Title rubric: "Given this content, does the suggested title accurately summarize the main topic in under 100 characters? Return passed=true if accurate and concise, false if misleading, too vague, or too long. Include reasoning."
- Description rubric: "Given this content, is the suggested description a useful 1-2 sentence summary that captures the key information? Return passed=true if it is a clear summary, false if vague, inaccurate, or too long. Include reasoning."

### Testing Strategy

- 6 test cases × 10 samples × 1 model = 60 LLM calls
- Pass threshold: 80%

---

## Milestone 3: Relationship Suggestion Evals

### Goal & Outcome

After this milestone:

- Relationship suggestion evals verify the LLM selects genuinely related items from candidates
- Tests cover both precision (correct selections) and the empty-result case

### Implementation Outline

#### 1. Test data

Evals call `suggest_relationships()` directly, passing curated `candidates: list[RelationshipCandidateContext]` as a parameter. This bypasses the database search entirely — the eval controls exactly which candidates the LLM sees.

Each test case defines:
- Source item context (`title`, `description`, `content_snippet`)
- A `candidates` list of `RelationshipCandidateContext` objects with a mix of related and unrelated items
- Expected candidate IDs that should be selected

This is cleaner than creating real DB items — we control the candidate set precisely.

#### 2. Relationship suggestion test cases (~4 cases)

| ID | Source | Candidates | Expected selections |
|----|--------|-----------|-------------------|
| `python-testing` | "Python Testing Best Practices" | 3 related (pytest, unittest, TDD) + 2 unrelated (cooking, gardening) | The 3 testing-related candidates |
| `react-frontend` | "React Component Design Patterns" | 2 related (React hooks, CSS-in-JS) + 3 unrelated (database indexing, cooking, astronomy) | The 2 React-related candidates |
| `all-unrelated` | "Machine Learning with PyTorch" | 4 candidates none related to ML (cooking, gardening, knitting, woodworking) | Empty or minimal candidates |
| `all-related` | "Web Development Overview" | 4 candidates all web-related (HTML, CSS, JavaScript, REST APIs) | All 4 selected |
| `misleading-title` | "Python Testing with Pytest" | 1 candidate titled "Python Testing" but about testing pythons (herpetology), 2 genuinely related (unittest, TDD) | Herpetology candidate NOT selected, testing candidates selected |

#### 3. Checks

**Deterministic checks:**
- `candidates` is a list
- Each candidate has `entity_id`, `entity_type`, `title`
- Returned entity_ids are a subset of the input candidate IDs (no hallucinated IDs)

**Semantic checks:**
- Expected related items appear in candidates (by entity_id)
- Unrelated items do not appear

### Testing Strategy

- 4 test cases × 10 samples × 1 model = 40 LLM calls
- Pass threshold: 80%
- No database needed — candidates are passed directly

---

## Milestone 4: Argument Suggestion Evals

### Goal & Outcome

After this milestone:

- Argument suggestion evals cover both generate-all and individual suggestion modes
- Checks verify argument names, descriptions, and the `required` field inference

### Implementation Outline

#### 1. Test data

No database entities needed — evals call `suggest_arguments()` directly with all context as parameters. Test cases define Jinja2 templates directly in the YAML config.

#### 2. Argument suggestion test cases (~5 cases)

| ID | Mode | Template | Expected |
|----|------|----------|----------|
| `generate-all-basic` | generate-all | `Hello {{ name }}, welcome to {{ city }}` | 2 arguments: `name` and `city`, both `required: true` |
| `generate-all-conditional` | generate-all | `{{ topic }}{% if context %}\nContext: {{ context }}{% endif %}` | `topic` required, `context` not required |
| `generate-all-complex` | generate-all | Template with 4+ variables, mix of conditional/unconditional | All placeholders returned with descriptions, correct `required` |
| `suggest-name` | individual (target) | Argument with description "The programming language to use" | Suggested name is something like `language` or `programming_language` |
| `suggest-description` | individual (target) | Argument named `output_format` | Suggested description is non-empty and explains the argument |
| `generate-all-no-content` | generate-all | `prompt_content=None`, `target=None` | Empty list returned (no extraction possible, no LLM call) |

#### 3. Checks

**Deterministic checks (generate-all):**
- Number of returned arguments matches number of new placeholders
- All argument names pass `ARG_NAME_PATTERN` (lowercase, underscores, starts with letter)
- Each argument has a non-empty description
- `required` field matches template structure (unconditional = true, conditional = false)

**Deterministic checks (individual):**
- Response contains at least 1 argument
- Suggested name passes `ARG_NAME_PATTERN`
- Suggested description is non-empty

**LLM-as-judge (for description quality):**

Same approach. Judge response: `{passed: bool, reasoning: str}`.

- Rubric: "Given a prompt template argument named [name] in the context of this template, does the suggested description clearly explain what the argument represents? Return passed=true if the description is clear and helpful, false if vague or unhelpful. Include reasoning."

### Testing Strategy

- 5 test cases × 10 samples × 1 model = 50 LLM calls
- Pass threshold: 80%
- No database or HTTP server needed — calls service function directly

---

## Cross-Cutting Concerns

### Running evals

Unlike MCP evals, AI suggestion evals do **not** require a running API server. They import and call the service functions directly. The only requirement is LLM provider API keys in the environment (e.g. `GEMINI_API_KEY`).

```bash
make evals-ai-suggestions                    # All AI suggestion evals
make evals                                    # All evals (including MCP + AI suggestions)
```

### Cost awareness

Each eval run makes real LLM calls. Per-call context overhead: ~1500 tokens for 20 few-shot examples (title + description + tags each) + ~500 tokens for 100-tag vocabulary with counts ≈ ~2000 tokens input per tag suggestion call. Other endpoints are lighter. With the default model (gemini-2.5-flash-lite at $0.10/M input, $0.40/M output), ~210 calls ≈ ~$0.05 per full eval run. LLM-as-judge calls (gemini-2.5-flash) add a small additional cost. Total is negligible.

### LLM provider errors

LLM provider errors (timeouts, rate limits, connection failures) will fail the eval as unhandled exceptions. These are infrastructure issues, not prompt quality failures — don't confuse them with test failures. If evals are flaky due to provider issues, investigate the provider, not the prompts.

### Results

Results are written to `evals/ai_suggestions/results/` (gitignored). Use `make eval-viewer` to inspect.
