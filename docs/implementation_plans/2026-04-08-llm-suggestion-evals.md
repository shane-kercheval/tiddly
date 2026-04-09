# LLM Suggestion Evals

**Date:** 2026-04-08
**Status:** Draft

## Overview

Add evaluation tests for the four AI suggestion endpoints (`suggest-tags`, `suggest-metadata`, `suggest-relationships`, `suggest-arguments`). These evals verify that the LLM produces useful, well-formatted suggestions given realistic content.

**Key difference from MCP evals:** The MCP evals test whether an LLM can choose the right tool and call it correctly (tool selection). The suggestion evals test whether our prompts + structured output schemas produce good results (output quality). There's no tool selection step — the eval calls the suggestion function directly and checks the response.

**Framework:** Uses `flex-evals` with YAML config files, the `@evaluate` decorator, `contains`/`exact_match`/`equals` checks for deterministic assertions, and `LLMJudgeCheck` for semantic quality where exact matching is too brittle.

**Model under test:** The default platform model (`gemini/gemini-2.5-flash-lite`) since it's the cheapest and most likely to surface prompt quality issues. Better models would mask weak prompts.

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
- Service-level unit tests cover core logic (dedup, caps, filtering, error handling)
- All existing API-level tests pass unchanged

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

```python
# services/suggestion_service.py

async def suggest_tags(
    *,
    title: str | None,
    url: str | None,
    description: str | None,
    content_snippet: str | None,
    current_tags: list[str],
    tag_vocabulary: list[TagVocabularyEntry],
    few_shot_examples: list[TagFewShotExample],
    llm_service: LLMService,
    config: ResolvedConfig,
) -> tuple[list[str], float | None]:
    """Build prompt, call LLM, filter results.
    Returns (deduplicated tag list capped at 7, cost).
    Case-insensitive dedup against current_tags is handled here."""
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
) -> tuple[SuggestMetadataResponse, float | None]:
    """Build prompt, call LLM, return title/description."""
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
    """Build prompt, call LLM, filter to valid candidate IDs, cap at 5.
    Validates returned IDs are a subset of input candidates."""
    ...


async def suggest_arguments(
    *,
    prompt_content: str | None,
    arguments: list[dict],
    target: str | None,
    placeholder_names: list[str] | None,  # Pre-extracted by router for generate-all
    llm_service: LLMService,
    config: ResolvedConfig,
) -> tuple[list[ArgumentSuggestion], float | None]:
    """Build prompt, call LLM, filter invalid names."""
    ...
```

Each function returns `(result, cost)`. The router uses `cost` for `track_cost()`.

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

Currently the title-based search uses only `data.title` as the query. Change to concatenate `title + description` (truncated to a reasonable length) when both are available. This gives the full-text search more signal for finding relevant candidates.

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

#### 3. Move `_parse_llm_response` and `_sanitize_structured_content` to service layer

These are currently private functions in the router. They belong in the service since the service handles LLM response parsing.

**Error handling change:** `_parse_llm_response` currently raises `HTTPException(502)` on invalid LLM responses. Service functions should not raise HTTP exceptions. Add a `LLMResponseParseError` exception class in the service layer. The router catches it and returns HTTP 502 with the existing `llm_invalid_response` error code. This follows the same pattern as the existing LiteLLM exception handler on the AI router.

#### 4. Update prompt builders to accept Pydantic models

`build_tag_suggestion_messages()` currently takes `few_shot_examples: list[dict]` and accesses `.get("title")`, `.get("tags")`, etc. Update to accept `list[TagFewShotExample]` and use attribute access. Same for `build_relationship_suggestion_messages()` — update to accept `list[RelationshipCandidateContext]`.

#### 5. Relationship candidate search stays in the router

The relationship endpoint's search logic (title search + tag search + dedup) remains in the router because it requires DB access. The service function receives pre-built `candidates: list[RelationshipCandidateContext]`. The service validates that returned entity_ids are a subset of the input candidates (no hallucinated IDs) — this filtering logic moves from the router to the service.

#### 6. Frontend: pass `content_type` to suggest-tags

Update `frontend/src/types.ts` to add `content_type: string` to `SuggestTagsRequest`. Update the frontend call sites (hooks that call `suggestTags()`) to pass the content type (`'bookmark'`, `'note'`, or `'prompt'`). The content type is known at each call site from the component context.

### Testing Strategy

**Existing API-level tests** (`test_ai_suggestions.py`, `test_ai.py`) must pass unchanged — they verify the router wiring is correct after the refactor.

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
- **Cost passthrough:** Cost from `llm_service.complete()` is returned in the tuple

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

- `create_bookmark_via_api(url, title, description, content, tags)` — Create a bookmark for test data setup. Needed for relationship evals (Milestone 3) but added here alongside the existing `create_note_via_api`.

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
- `tag_vocabulary` — curated list defined in the test file (e.g. `["python", "javascript", "react", "flask", "api", "tutorial", "devops", "docker", "machine-learning", "testing"]`)
- `few_shot_examples` — curated list defined in the test file (realistic items with tags)
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

#### 5. Checks

**Deterministic checks:**
- Tags is a non-empty list
- Each expected tag appears in the response (`contains` check)
- `current_tags` are excluded from response (`contains` with `negate`)

**LLM-as-judge check (for quality):**
- Use a specific rubric, not a vague quality question. Example: "The content is about [brief topic]. For each suggested tag, score 1 if it is directly related to the content's topic or domain, 0 if not. Pass if all tags score 1."
- Use a Pydantic response format for structured judge output (e.g. `pass: bool, reasoning: str`)
- This catches cases where the tags are structurally valid but semantically wrong

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
- Title length ≤ 200 characters (schema limit)
- Description length ≤ 1000 characters (schema limit)

**LLM-as-judge checks (with specific rubrics):**
- Title: "Given this content, score the suggested title: 1 if it accurately summarizes the main topic in under 100 characters, 0 if it is misleading, too vague, or too long. Pass if score is 1."
- Description: "Given this content, score the suggested description: 1 if it is a useful 1-2 sentence summary that captures the key information, 0 if it is vague, inaccurate, or too long. Pass if score is 1."

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

**LLM-as-judge (for description quality, with specific rubric):**
- "Given a prompt template argument named [name] in the context of this template, score the suggested description: 1 if it clearly explains what the argument represents and includes an example or expected format, 0 if it is vague or unhelpful. Pass if score is 1."

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

Each eval run makes real LLM calls. With the default model (gemini-2.5-flash-lite at $0.10/M input, $0.40/M output), ~210 calls at ~500 tokens each ≈ ~$0.05 per full eval run. Negligible.

### Results

Results are written to `evals/ai_suggestions/results/` (gitignored). Use `make eval-viewer` to inspect.
