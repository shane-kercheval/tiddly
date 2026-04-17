# Prompt Argument Endpoint: Split + Rename + Explicit Field Selection

**Date:** 2026-04-17
**Status:** Planned
**Breaking change:** Yes — pre-GA, no backwards-compatibility shim required.

---

## Background

Today `POST /ai/suggest-arguments` carries two unrelated use cases selected by the shape of the request body:

1. **Generate-all**: given a Jinja2 prompt template, propose `{name, description, required}` for every placeholder not already declared.
2. **Individual**: given an existing arguments list + `target_index`, fill in whichever field is empty on `arguments[target_index]`.

The individual path contains a real footgun. In `backend/src/services/suggestion_service.py:384`:

```python
suggest_field = "name" if target_arg.description and not target_arg.name else "description"
```

When the caller sends a `target_index` entry with **both** `name` and `description` populated, the server silently regenerates `description`, overwriting the caller's input without a corresponding documented intent. The endpoint's docstring frames individual mode as "fill the missing field," so this both-populated branch is not what the caller asked for — and it still charges quota + provider cost.

Beyond that specific footgun, the single endpoint has to carry mode-sniffing logic in:

- The request schema (`target_index: int | None`)
- The service (`suggest_arguments` dispatches on `target_index`)
- The prompt builder (`build_argument_suggestion_messages` branches on `target_arg is None` and `suggest_field`)
- The frontend hook (`useArgumentSuggestions` has three public methods — `suggestAll`, `suggestName`, `suggestDescription` — that all route through one `suggestArguments()` call and disambiguate only via payload shape)
- The eval config (one YAML with a `mode` discriminator and per-test `suggest_field`)

The decision is to **split into two endpoints** and **make caller intent explicit** rather than inferring it from shape. The old endpoint is removed outright. No dual-serve period, no compatibility aliases.

### Rename

`/ai/suggest-arguments` is also being renamed to use `prompt-argument(s)` in the URL path to disambiguate from "arguments" in the general AI / tool-use sense. This is the right moment to rename since we're already breaking the contract.

---

## Target API design

### `POST /ai/suggest-prompt-arguments` (plural — generate-all)

Propose all new placeholders for a template.

| Field | Required | Default | Purpose |
|---|---|---|---|
| `prompt_content` | **yes** | — | Jinja2 template (≤ 50 KB). |
| `arguments` | no | `[]` | Existing `{name, description}` entries — names excluded from placeholder extraction (case-insensitive). |
| `model` | no | `null` | BYOK model ID; platform callers: ignored. |

**Response:** `{"arguments": [{name, description, required}, ...]}` — one entry per new placeholder.

**Short-circuit (empty response, no LLM call, quota still consumed):**
- Every placeholder in `prompt_content` is already in `arguments` (by name, case-insensitive) — the one remaining short-circuit, since `prompt_content` is now schema-required and enforced non-empty.

No `target_index`, no `target_field`. Nothing to disambiguate.

### `POST /ai/suggest-prompt-argument-field` (singular — individual / refine one field)

Refine exactly one field of one argument.

| Field | Required | Default | Purpose |
|---|---|---|---|
| `target_index` | **yes** | — | Index into `arguments`. `ge=0`; must be within bounds. |
| `target_field` | **yes** | — | `Literal["name", "description"]`. Scalar, not list. |
| `arguments` | **yes** | — | Existing `{name, description}` entries. Must be non-empty (caller must provide the entry being refined). |
| `prompt_content` | no | `null` | Optional Jinja2 template used as grounding context. |
| `model` | no | `null` | BYOK model ID; platform callers: ignored. |

**Response:** `{"arguments": [{name, description, required}, ...]}` — always a single-element list on a successful LLM call. Empty list only when the LLM produced an invalid identifier for `target_field="name"` and validation rejected it (quota charged).

**No success-path short-circuit.** All malformed-input cases (empty target + empty content, out-of-range index, etc.) are rejected at the schema boundary (422) or the service boundary (400). If the request validates, an LLM call is made.

**Error cases:**
- `target_index` out of range (index ≥ `len(arguments)`) → `400` (service-level `ValueError` → `HTTPException`)
- `target_index < 0` → `422` (Pydantic `ge=0`)
- Invalid `target_field` value → `422` (Pydantic Literal)
- Missing any required field → `422` (Pydantic)
- `arguments` empty list → `422` (Pydantic `field_validator`)
- `prompt_content` is an empty string → `422` (Pydantic `min_length=1`; `None` is fine)
- `arguments[target_index]` has both `name` and `description` empty AND `prompt_content` is null/empty → `422` (Pydantic `model_validator`; no grounding signal for the LLM)

**Caller intent becomes explicit.** If the caller wants to regenerate `description` on an entry where `description` already has text, they pass `target_field: "description"` — a deliberate request to overwrite. The server never guesses.

### Shared response shape

Both endpoints return `{"arguments": list[ArgumentSuggestion]}` — same element shape as today (`ArgumentSuggestion` is unchanged). One shared response model is fine; the difference is purely the semantic count (N vs 1) documented per-endpoint.

---

## Files that need touching (summary — fuller context in each milestone)

Backend:
- `backend/src/schemas/ai.py` — request models
- `backend/src/api/routers/ai.py` — route handlers + docstrings + error-response table adjustments
- `backend/src/api/main.py` — AI tag description mentions `/ai/suggest-arguments`
- `backend/src/services/suggestion_service.py` — split `suggest_arguments` into two public functions
- `backend/src/services/llm_prompts.py` — split `build_argument_suggestion_messages` into two
- `backend/src/services/_suggestion_llm_schemas.py` — unchanged (internal LLM response schemas are still valid)

Backend tests:
- `backend/tests/services/test_suggestion_service.py`
- `backend/tests/api/test_ai_suggestions.py`
- `backend/tests/api/test_ai.py`
- `backend/tests/schemas/test_ai_schemas.py`

Frontend:
- `frontend/src/types.ts`
- `frontend/src/services/aiApi.ts` (+ `aiApi.test.ts`)
- `frontend/src/hooks/useArgumentSuggestions.ts` (+ `.test.ts`)
- `frontend/src/hooks/useAIArgumentIntegration.test.ts` — only if call sites change shape

Evals:
- `evals/ai_suggestions/test_suggest_arguments.py` → split into two files
- `evals/ai_suggestions/config_suggest_arguments.yaml` → split into two configs

Docs / ops:
- `Makefile` — `evals-ai-suggestions-arguments` target splits into two
- `docs/architecture.md` — "Wired up" list in AI use-case wiring table
- `frontend/public/llms.txt` — check for references; update if present
- `frontend/src/pages/docs/DocsAPI.tsx`, `DocsAIFeatures.tsx` — check for references to the old URL; update if present

---

## Guidance for the implementing agent

- **Read before implementing.** Before starting each milestone, read the listed files in full so you understand the surrounding conventions (error-response tables, docstring style, test patterns).
- **Ask before deciding.** If any ambiguity shows up — naming, error-code selection, whether an existing test should be rewritten vs. deleted — stop and ask. Do not guess. The project owner's feedback memory explicitly flags "don't decide UX/product details on user's behalf."
- **Verify after each milestone.** Run the scoped verify commands (`make backend-verify` after backend work, `make frontend-verify` after frontend work). Do not run the full `make tests` after frontend-only changes.
- **No backwards compatibility.** The old URL, schema name, and service function name are all removed. Do not leave aliases.
- **Stop for review after each milestone.** Each milestone is a coherent checkpoint; the project owner wants to verify before the next one starts.
- **Tests over comments.** Default to writing no comments. Cover the behavior change (especially the removal of the silent-overwrite footgun and the new 422 for "no grounding signal") with explicit tests that assert the new schema-boundary contract.
- **Preserve type hints everywhere** (user global rule — functions and unit tests).
- **No imports inside functions** unless absolutely necessary (user global rule).

### Relevant docs/URLs

- FastAPI request/response body docs: <https://fastapi.tiangolo.com/tutorial/body/>
- FastAPI responses panel docs (`responses=` on route decorators): <https://fastapi.tiangolo.com/advanced/additional-responses/>
- Pydantic v2 field constraints (`ge`, `Literal`, `model_config`): <https://docs.pydantic.dev/latest/concepts/fields/>
- Pydantic v2 JSON schema examples via `json_schema_extra`: <https://docs.pydantic.dev/latest/concepts/json_schema/#schema-customization>

---

## Milestones

Each milestone is independently reviewable. Complete code + tests + doc updates within scope before moving on. Ask for review before proceeding to the next milestone.

### Milestone 1 — Schemas + service + prompt builders (backend core)

**Goal & outcome**

Pure Python layers: no router wiring, no HTTP tests. After this milestone:
- Two new request schemas exist and validate per the target design.
- `SuggestArgumentsRequest` is deleted.
- Two public service functions exist (generate-all and individual), with no mode-sniffing.
- The prompt builder is split into two focused builders.

Functional outcomes:
- Callers of the service layer can invoke generate-all with `prompt_content` + optional `arguments`.
- Callers of the service layer can invoke individual refine with `target_index` + `target_field` + `arguments` + optional `prompt_content`.
- No codepath infers intent from the shape of the arguments list.

**Implementation outline**

1. **`backend/src/schemas/ai.py`** — In the "Suggest Arguments" section:
   - Delete `SuggestArgumentsRequest`.
   - Keep `ArgumentInput`, `ArgumentSuggestion`. Rename `SuggestArgumentsResponse` → `SuggestPromptArgumentsResponse` via search-and-replace. **Single shared response model** across both endpoints — the element shape is identical (`list[ArgumentSuggestion]`); the N-vs-1 semantic difference is documented per-endpoint in the router docstrings, not via type split.
   - Add `SuggestPromptArgumentsRequest` (plural, generate-all). `prompt_content` is **required and non-empty** (`min_length=1, max_length=50_000`). An empty template is a malformed request, not a valid input — a 422 is louder and more useful than a silent empty-response short-circuit.

     ```python
     class SuggestPromptArgumentsRequest(BaseModel):
         model: str | None = Field(None, description=...)
         prompt_content: str = Field(..., min_length=1, max_length=50_000, description=...)
         arguments: list[ArgumentInput] = Field(default_factory=list, description=...)
     ```

   - Add `SuggestPromptArgumentFieldRequest` (singular, individual). Four layers of schema-boundary validation: `target_index >= 0`, `arguments` non-empty, `prompt_content` non-empty when present (`min_length=1`), and a `model_validator(mode="after")` that rejects "no grounding signal" (empty target entry + null/empty prompt_content) with 422. The `SuggestMetadataRequest.fields` empty-list validator at `schemas/ai.py:523` is the precedent for field-level validators; the model-level validator is new in this file.

     ```python
     class SuggestPromptArgumentFieldRequest(BaseModel):
         model: str | None = Field(None, description=...)
         prompt_content: str | None = Field(None, min_length=1, max_length=50_000, description=...)
         arguments: list[ArgumentInput] = Field(..., description=...)
         target_index: int = Field(..., ge=0, description=...)
         target_field: Literal["name", "description"] = Field(..., description=...)

         @field_validator("arguments")
         @classmethod
         def arguments_not_empty(cls, v: list[ArgumentInput]) -> list[ArgumentInput]:
             if not v:
                 raise ValueError("arguments must contain at least one entry")
             return v

         @model_validator(mode="after")
         def has_grounding_signal(self) -> "SuggestPromptArgumentFieldRequest":
             # `target_index` bounds vs. list length are still checked at the
             # service layer (400). Here we only enforce the grounding
             # invariant — if target_index is in range, does the LLM have
             # ANYTHING to work with?
             if self.target_index >= len(self.arguments):
                 return self  # let the service-level ValueError handle it as 400
             target = self.arguments[self.target_index]
             has_target_context = bool(target.name or target.description)
             has_template_context = bool(self.prompt_content)
             if not has_target_context and not has_template_context:
                 raise ValueError(
                     "Cannot refine: target argument has no name or description "
                     "and prompt_content is empty. LLM has no grounding signal.",
                 )
             return self
     ```

     The service-level 400 (`target_index out of range`) remains, but now only fires for the real case: a non-empty list where `target_index >= len(arguments)`. Empty-list never reaches the service. The both-empty + no-content case is also a schema-boundary rejection — it never reaches the service.

   - Populate realistic `json_schema_extra` examples on both (match the existing convention in the file — primary example with every field populated, prose docstring for null cases).

2. **`backend/src/services/llm_prompts.py`** — Replace `build_argument_suggestion_messages` with two focused builders:

   ```python
   def build_generate_all_arguments_messages(
       prompt_content: str,
       existing_arguments: list[ArgumentInput],
       placeholder_names: list[str],
   ) -> list[dict]: ...

   def build_refine_argument_messages(
       target_field: Literal["name", "description"],
       target_arg: ArgumentInput,
       existing_arguments: list[ArgumentInput],
       prompt_content: str | None,
   ) -> list[dict]: ...
   ```

   Rationale: each builder has one system prompt, no mode switches. The existing three prompt bodies (generate-all, suggest-name, suggest-description) in `llm_prompts.py:242-267` all persist — just split across two functions instead of one branching function. `extract_template_placeholders` stays shared.

3. **`backend/src/services/suggestion_service.py`** — Replace `suggest_arguments` and `_suggest_arguments_generate_all` with two public functions:

   ```python
   async def suggest_prompt_arguments(
       *,
       prompt_content: str,
       arguments: list[ArgumentInput],
       llm_service: LLMService,
       config: LLMConfig,
   ) -> tuple[list[ArgumentSuggestion], float | None]:
       """Generate descriptions for all new placeholders in the template."""

   async def suggest_prompt_argument_field(
       *,
       prompt_content: str | None,
       arguments: list[ArgumentInput],
       target_index: int,
       target_field: Literal["name", "description"],
       llm_service: LLMService,
       config: LLMConfig,
   ) -> tuple[list[ArgumentSuggestion], float | None]:
       """Refine exactly one field of arguments[target_index]."""
   ```

   Behaviors:
   - `suggest_prompt_arguments`: same body as current `_suggest_arguments_generate_all`, trivially relocated. Drop the `if not prompt_content: return [], None` branch — the schema layer enforces non-empty content, so that branch is unreachable.
   - `suggest_prompt_argument_field`:
     - Raise `ValueError("target_index N is out of range ...")` if `target_index >= len(arguments)` (router maps to 400 as today).
     - No "both-empty" short-circuit — that case is 422'd at the schema boundary. If the request reached the service, there is grounding to call the LLM on.
     - Build messages via `build_refine_argument_messages`.
     - Use `ArgumentNameSuggestion` or `ArgumentDescriptionSuggestion` response_format based on `target_field`.
     - Validate the generated name via `validate_argument_name` when `target_field == "name"` — on failure, return `[], cost` (preserves current behavior; still charges).
     - For `target_field == "description"`, preserve `target_arg.name` in the returned suggestion; for `target_field == "name"`, preserve `target_arg.description`. Matches current behavior.

4. **`backend/src/services/_suggestion_llm_schemas.py`** — No changes needed. `ArgumentNameSuggestion` and `ArgumentDescriptionSuggestion` remain valid.

**Testing strategy** (`backend/tests/services/test_suggestion_service.py`)

Replace the existing `TestSuggestArguments` class with two classes mirroring the split.

`TestSuggestPromptArguments` (plural):
- `test_extracts_placeholders` — template with 2 placeholders, empty existing args → returns both.
- `test_excludes_existing_placeholders` — one placeholder already in `arguments` → excluded (case-insensitive check).
- `test_no_placeholders_short_circuits` — template with no `{{ }}` → returns `[], None`, LLM not called.
- `test_all_placeholders_defined_short_circuits` — every placeholder already present → returns `[], None`, LLM not called.
- `test_filters_invalid_names` — LLM returns an invalid identifier → filtered out.
- `test_required_field_preserved` — verify `required=True/False` is carried through.
- `test_parse_error_raises_with_cost` — LLM returns bad JSON → `LLMResponseParseError` with `.cost` set.

Note: no service-level test for empty `prompt_content` — the schema forbids it at 422, so the branch doesn't exist in the service. The schema test below covers the 422 case.

`TestSuggestPromptArgumentField` (singular):
- `test_refine_name_generates_name` — `target_field="name"`, entry has description only → returns single suggestion with LLM-generated name and preserved description.
- `test_refine_description_generates_description` — `target_field="description"`, entry has name only → returns single suggestion with preserved name and LLM-generated description.
- `test_refine_name_when_both_populated_overwrites_name` — entry has both `name` and `description`, `target_field="name"` → LLM *is* called, returned suggestion has new name + original description. **This is the explicit-opt-in regression test** proving the footgun is gone (the caller had to ask for it).
- `test_refine_description_when_both_populated_overwrites_description` — symmetric.
- `test_refine_name_with_empty_target_but_template_context_calls_llm` — both target fields empty, `prompt_content` provided → LLM *is* called (template is grounding).
- `test_invalid_name_generated_returns_empty_with_cost` — `target_field="name"`, LLM returns an invalid identifier → returns `([], cost)`.
- `test_target_index_out_of_range_raises_value_error` — `target_index >= len(arguments)` → `ValueError`, LLM not called.
- `test_parse_error_raises_with_cost` — bad JSON → `LLMResponseParseError` with cost.

Note: no service-level test for "both-empty target + empty content" — that's a schema-boundary 422 now, covered by the schema tests below. The branch doesn't exist in the service.

Schema-level tests in `backend/tests/schemas/test_ai_schemas.py`:
- `SuggestPromptArgumentFieldRequest` rejects empty `arguments` list with a `ValidationError`.
- `SuggestPromptArgumentFieldRequest` rejects an unknown `target_field` literal.
- `SuggestPromptArgumentFieldRequest` rejects missing `target_field` / missing `target_index` / missing `arguments`.
- `SuggestPromptArgumentFieldRequest` rejects `target_index < 0`.
- `SuggestPromptArgumentFieldRequest` rejects `prompt_content=""` (`min_length=1`; `None` is fine).
- `SuggestPromptArgumentFieldRequest` rejects both-empty target + null `prompt_content` (model_validator: no grounding signal).
- `SuggestPromptArgumentFieldRequest` accepts both-empty target + non-empty `prompt_content` (template is the grounding).
- `SuggestPromptArgumentFieldRequest` accepts `target_index >= len(arguments)` at the schema layer — bounds-vs-length is a service-layer 400, not a schema 422. The model_validator's short-circuit on out-of-range means this shouldn't raise.
- `SuggestPromptArgumentsRequest` requires `prompt_content` (missing key → `ValidationError`).
- `SuggestPromptArgumentsRequest` rejects `prompt_content=""` (empty string — `min_length=1`).
- Remove any tests that referenced `SuggestArgumentsRequest`.

---

### Milestone 2 — Router wiring + endpoint-level error handling

**Goal & outcome**

After this milestone, the HTTP surface matches the target design. Functional outcomes:
- `POST /ai/suggest-prompt-arguments` and `POST /ai/suggest-prompt-argument-field` are live.
- `POST /ai/suggest-arguments` is gone (404 on any caller that still sends the old URL).
- Swagger shows both endpoints with accurate request tables, response tables, example payloads, and error-response panels.

**Implementation outline**

1. **`backend/src/api/routers/ai.py`**:
   - Delete the `@router.post("/suggest-arguments", ...)` handler and its docstring.
   - Add two new handlers — one per endpoint — following the style of existing suggestion endpoints (rate-limit dependency, cost tracking, parse-error handling via `_handle_parse_error`).
   - Each handler calls the corresponding service function from Milestone 1.
   - Docstrings: one mode per endpoint. Remove the "Modes" section; replace with request/response tables specific to that endpoint. Preserve the standard "See the `ai` tag description" footer.
   - **Refactor `_LLM_CALL_ERROR_RESPONSES[400]` to remove the singular-endpoint-specific example.** The existing `target_index_out_of_range` example currently appears on every endpoint that shares `AI_SUGGESTION_RESPONSES` (tags, metadata, relationships, and the old arguments endpoint), but only one of them actually has `target_index` — that's a pre-existing Swagger hygiene bug that this split is the right moment to fix.
     - Remove the `target_index_out_of_range` example from `_LLM_CALL_ERROR_RESPONSES[400]`. Update the 400 prose description to drop the `suggest-arguments service validation failures` language.
     - Define an endpoint-specific override for the singular endpoint:
       ```python
       _SUGGEST_PROMPT_ARGUMENT_FIELD_400 = {
           400: {
               "model": AIErrorResponse,
               "description": "... standard 400 prose + target_index out-of-range note ...",
               "content": {"application/json": {"examples": {
                   "unsupported_model": {...},
                   "llm_bad_request": {...},
                   "target_index_out_of_range": {
                       "summary": "suggest-prompt-argument-field service validation",
                       "value": {
                           "detail": "target_index 5 is out of range (arguments has 2 items)",
                       },
                   },
               }}},
           },
       }
       SUGGEST_PROMPT_ARGUMENT_FIELD_RESPONSES = {
           **AI_SUGGESTION_RESPONSES,
           **_SUGGEST_PROMPT_ARGUMENT_FIELD_400,
       }
       ```
     - The plural endpoint and the other four suggestion endpoints keep using `AI_SUGGESTION_RESPONSES` (now cleaner — no misleading `target_index` example).
     - Update the singular handler decorator: `responses=SUGGEST_PROMPT_ARGUMENT_FIELD_RESPONSES`.

2. **`backend/src/api/main.py`**:
   - Update the AI tag description at line 164 — the sentence referencing `/ai/suggest-arguments` in the "both-fields-empty individual-mode case". That sentence is now stale: with the split, there's no empty-response-with-quota-charged case on either new endpoint (the singular's empty-target case is 422'd by the model_validator). Rewrite to remove the arguments-specific example entirely, or replace with one of the remaining no-LLM-call cases (e.g. the plural endpoint returning empty when all placeholders are already declared).

**Testing strategy**

`backend/tests/api/test_ai_suggestions.py`:

Replace `TestSuggestArguments` with two classes, `TestSuggestPromptArguments` and `TestSuggestPromptArgumentField`.

`TestSuggestPromptArguments` (plural) — adapt existing tests:
- `test_generate_all_from_template`
- `test_generate_all_excludes_existing`
- `test_tracks_cost`
- `test_filters_invalid_argument_names`
- `test_required_field_included_in_response`
- `test_returns_empty_when_all_placeholders_exist`
- `test_missing_prompt_content_returns_422` (NEW — `prompt_content` is required; omitting it is 422)
- `test_empty_prompt_content_returns_422` (NEW — `prompt_content=""` is rejected by `min_length=1`)

`TestSuggestPromptArgumentField` (singular) — adapt existing tests + new coverage:
- `test_suggest_name_for_argument` — `target_field="name"`, description only → 200 with generated name.
- `test_suggest_description_for_argument` — `target_field="description"`, name only → 200 with generated description.
- `test_refine_description_overwrites_populated_field` — both fields populated + `target_field="description"` → LLM called, description replaced. **This is the behavior-change regression test.**
- `test_works_with_no_template_when_target_has_context` — `prompt_content` omitted but target has a name/description → 200, LLM called.
- `test_tracks_cost`
- `test_target_index_out_of_range_returns_400`
- `test_negative_target_index_returns_422`
- `test_missing_target_field_returns_422` (NEW — Pydantic required field)
- `test_invalid_target_field_returns_422` (NEW — `target_field: "foo"` → 422)
- `test_empty_arguments_returns_422` (NEW — empty list caught by validator)
- `test_empty_prompt_content_returns_422` (NEW — `prompt_content=""` rejected by `min_length=1`)
- `test_both_fields_empty_and_no_content_returns_422` (behavior-change: now 422 instead of silent empty, via model_validator)
- `test_both_fields_empty_with_template_calls_llm` (NEW — verifies template grounding still works).

`backend/tests/api/test_ai.py`:
- Update `test_suggest_arguments_unsupported_model` — rename + update URL to hit the new endpoint (pick whichever endpoint the test makes most sense against; suggest the plural endpoint since it exercises the full generate path).

---

### Milestone 3 — Frontend types, API client, hook

**Goal & outcome**

After this milestone, the UI calls the new endpoints with explicit intent per call site. Functional outcomes:
- The "Suggest all" button still works, calling the plural endpoint.
- The per-row "Suggest name" / "Suggest description" buttons still work, calling the singular endpoint with explicit `target_field`.
- Type safety: no `any` leak. Both request types exist.

**Implementation outline**

1. **`frontend/src/types.ts`** — In the `/ai/suggest-arguments` section (lines 785-803):
   - Delete `SuggestArgumentsRequest`.
   - Rename `SuggestArgumentsResponse` → `SuggestPromptArgumentsResponse`.
   - Add `SuggestPromptArgumentsRequest` and `SuggestPromptArgumentFieldRequest` matching the backend shape exactly.

   ```ts
   export interface SuggestPromptArgumentsRequest {
     model?: string | null
     prompt_content: string
     arguments?: ArgumentInput[]
   }

   export interface SuggestPromptArgumentFieldRequest {
     model?: string | null
     prompt_content?: string | null
     arguments: ArgumentInput[]
     target_index: number
     target_field: 'name' | 'description'
   }
   ```

2. **`frontend/src/services/aiApi.ts`** — Replace `suggestArguments` with two functions:

   ```ts
   export async function suggestPromptArguments(
     data: SuggestPromptArgumentsRequest,
   ): Promise<SuggestPromptArgumentsResponse> { /* POST /ai/suggest-prompt-arguments */ }

   export async function suggestPromptArgumentField(
     data: SuggestPromptArgumentFieldRequest,
   ): Promise<SuggestPromptArgumentsResponse> { /* POST /ai/suggest-prompt-argument-field */ }
   ```

3. **`frontend/src/hooks/useArgumentSuggestions.ts`** — Three public methods remain (no UX changes):
   - `suggestAll` → calls `suggestPromptArguments(...)`.
   - `suggestName` → calls `suggestPromptArgumentField({ target_index, target_field: 'name', arguments, prompt_content })`.
   - `suggestDescription` → calls `suggestPromptArgumentField({ target_index, target_field: 'description', arguments, prompt_content })`.

   **New client-side guard (consequence of the new 422 case):** the singular endpoint now rejects calls where `arguments[target_index]` has both fields empty AND `prompt_content` is empty/null. The hook should no-op before firing when that's true, so the user never sees a server-side validation error for an obviously-empty click. Add an early-return check in `suggestName` / `suggestDescription` analogous to how `suggestAllDisabled` is computed in `useAIArgumentIntegration.ts:109`.

   Remove the "Known limitations" comment section about overwrite during loading only if the call pattern materially changed (it didn't — keep the comment).

4. **`frontend/src/hooks/useAIArgumentIntegration.ts`** — add button-disable logic for the per-row suggest buttons (mirror `suggestAllDisabled`): disable when the row is entirely empty and `current.content` is empty. Expose the disabled flags the card needs so the UI matches the hook's no-op behavior from step 3.

**Testing strategy**

`frontend/src/services/aiApi.test.ts`:
- Update `suggestArguments invalidates health cache` → split into two tests: one for `suggestPromptArguments`, one for `suggestPromptArgumentField`. Both should verify `invalidateHealthCache()` is called.

`frontend/src/hooks/useArgumentSuggestions.test.ts`:
- Update mock imports from `suggestArguments` → `suggestPromptArguments` and `suggestPromptArgumentField`.
- Update existing tests to assert the correct API function is called per public method, with the expected payload shape (especially that `suggestName` passes `target_field: 'name'` and `suggestDescription` passes `target_field: 'description'`).
- Add: `suggestName` / `suggestDescription` no-op (API function NOT called) when the target row is entirely empty and `prompt_content` is empty.
- Add: `suggestName` / `suggestDescription` do fire when only `prompt_content` is set (template-only grounding).

`frontend/src/hooks/useAIArgumentIntegration.test.ts`:
- Update mock imports to match the new function names.

Verify with `make frontend-verify`. The user's memory explicitly says do not run backend tests for frontend-only changes.

---

### Milestone 4 — Evals split

**Goal & outcome**

Each endpoint has its own eval suite and YAML config.

**Implementation outline**

1. Create `evals/ai_suggestions/config_suggest_prompt_arguments.yaml`:
   - Copy the three `generate-all-*` test cases from the existing config.
   - Drop the `mode`, `suggest_field`, `target_index` fields from `input` sections (no longer meaningful).
   - **Judge-prompt guidance:** preserve all grading language from the current config — only remove the mode-dispatch framing. Specifically: keep the "descriptions should be specific and helpful" criterion, the "names should be lowercase_with_underscores" criterion, and anything else that applies to generate-all results. Remove the "three modes" explainer and any "individual mode returns only one argument" guardrail (irrelevant now).

2. Create `evals/ai_suggestions/config_suggest_prompt_argument_field.yaml`:
   - Copy the two `suggest-name` / `suggest-description` test cases.
   - Add a `target_field` field (scalar) to `input` and remove `mode`, `suggest_field`.
   - **Judge-prompt guidance:** preserve all grading language — only remove the three-modes framing. Specifically: keep "it is CORRECT to return only one argument" (rephrased as "this endpoint returns exactly one refined argument"); keep the "if the description clearly maps to an existing placeholder, the suggested name should match that placeholder" criterion for `target_field="name"` cases. The goal is a tighter prompt without drifting the judge's scoring behavior — changes in prompt wording should be structural (remove branching), not substantive (remove criteria).

3. Create `evals/ai_suggestions/test_suggest_prompt_arguments.py`:
   - Modeled after the current `test_suggest_arguments.py` but calls `suggest_prompt_arguments()` from the service layer with only the plural parameters.

4. Create `evals/ai_suggestions/test_suggest_prompt_argument_field.py`:
   - Modeled after the current test but calls `suggest_prompt_argument_field()` passing `target_field`.

5. Delete `evals/ai_suggestions/test_suggest_arguments.py` and `config_suggest_arguments.yaml`.

6. **`Makefile`** — replace `evals-ai-suggestions-arguments` with two targets:

   ```makefile
   evals-ai-suggestions-prompt-arguments:  ## Run prompt-argument generate-all evaluations
       PYTHONPATH=$(PYTHONPATH) uv run pytest evals/ai_suggestions/test_suggest_prompt_arguments.py -vs --timeout=300

   evals-ai-suggestions-prompt-argument-field:  ## Run prompt-argument-field individual-refine evaluations
       PYTHONPATH=$(PYTHONPATH) uv run pytest evals/ai_suggestions/test_suggest_prompt_argument_field.py -vs --timeout=300
   ```

**Testing strategy**

Evals are LLM-judged and cost real money — do not run them in the regular verify loop. Confirm the files parse and collect under `pytest --collect-only evals/ai_suggestions/` locally; run the actual evals separately per the usual eval workflow and ask the project owner before spending money on a real run.

**Recommended (not required): judge-drift sanity check.** Since the judge prompts change (structurally, not substantively — see the guidance above), the project owner may want to run both new configs once against the same model set as the last old-config run and eyeball the scores before retiring the old results. If post-split scores are meaningfully lower, that's a signal the judge prompt lost a load-bearing piece of guidance.

---

### Milestone 5 — Docs and discoverability

**Goal & outcome**

External-facing references to the old endpoint URL are fully updated. Architecture doc reflects the split.

**Implementation outline**

1. **`docs/architecture.md`** line 284 (`AI use-case wiring status` table) — update the `SUGGESTIONS` row's "Wired up" list: replace `suggest-arguments` with `suggest-prompt-arguments, suggest-prompt-argument-field`.

2. **`frontend/public/llms.txt`** — grep for `suggest-arguments`. If present, replace with both new URLs.

3. **`frontend/src/pages/docs/DocsAPI.tsx`, `DocsAIFeatures.tsx`** — grep for `suggest-arguments`. `DocsAPI.tsx:124` currently reads "argument suggestions" (generic language) and doesn't URL-reference the endpoint; it's probably fine. Confirm by reading each file before editing. Only update references that name the old URL explicitly.

4. **`AGENTS.md`** — no known references, but grep to be sure.

5. **`docs/implementation_plans/2026-03-18-llm-integration.md`** and **`docs/implementation_plans/2026-04-08-llm-suggestion-evals.md`** — historical documents; **do not edit**. If the agent feels a note should be added, ask first.

**Testing strategy**

No tests here — verify via grep that no stale `/ai/suggest-arguments` URL remains outside the `docs/implementation_plans/` historical files and outside the new plan document itself.

Final verification step: run `make backend-verify && make frontend-verify`. Do not run `make tests` (per project convention — scoped verify is preferred).

---

## Out of scope

- **Supporting `target_field` as a list** (e.g. `["name", "description"]` to refine both in one call). The discussion explicitly deferred this until a concrete caller asks for it. If the agent identifies a caller that wants this during implementation, stop and ask — do not add it silently.
- **Rate-limit bucket changes.** Both endpoints stay on `AIUseCase.SUGGESTIONS` / `AI_PLATFORM` (+ `AI_BYOK`). No bucket split.
- **Prompt-builder refactoring beyond splitting the existing function.** The system/user prompt *text* is unchanged; we're only separating the dispatch.
- **Frontend UX changes.** The three buttons remain; only the API contract changes beneath them.

---

## Decisions locked in

These were open questions during plan drafting; the project owner confirmed the recommendations. **Do not revisit without asking.**

1. **Single shared response model.** `SuggestPromptArgumentsResponse` is used by both endpoints. Not split into two types — element shape is identical and the N-vs-1 semantic lives in the router docstrings, not the type system.
2. **Empty `arguments` on singular endpoint → 422** via a Pydantic `field_validator`, matching the pattern `SuggestMetadataRequest.fields` uses at `schemas/ai.py:523`. Service-level 400 remains only for the real in-bounds-index-exceeds-length case.
3. **`prompt_content` required and non-empty on plural endpoint.** `Field(..., min_length=1, max_length=50_000)`. No silent empty-response short-circuit for empty content — that's a 422 at the schema boundary.
4. **Both-empty target + no content on singular endpoint → 422** via a Pydantic `model_validator(mode="after")`. Matches decision 3's philosophy: "no grounding signal" is a malformed request, not a 200-with-empty-quota-drain. The frontend is responsible for disabling the per-row suggest buttons when the row is empty and the template is empty (Milestone 3), so this 422 should never be user-visible.
5. **`prompt_content` on singular endpoint: `Field(None, min_length=1, ...)`.** `None` is valid (endpoint accepts no-template mode when the target argument has grounding); `""` is rejected. Treats empty string and null consistently without silently normalizing.
6. **Naming: `/ai/suggest-prompt-argument-field` for singular**, not `/ai/suggest-prompt-argument`. The singular/plural pair `suggest-prompt-arguments` + `suggest-prompt-argument` differed by one letter — a grep/log/Swagger-search footgun. `-field` at the end makes the distinction visible at a glance and describes the operation (refining a single field of an argument).
7. **Rename + semantic split land together.** The project owner explicitly decided to bundle both breaking changes in a single deploy. This is pre-GA, there are no external callers (verified via grep across CLI, MCP, Chrome extension, llms.txt), and tests cover every changed path. Do not propose splitting into two deploys.

Common thread: validate aggressively at the schema, keep the service focused on real LLM logic. Every decision above removes a branch from the service.
