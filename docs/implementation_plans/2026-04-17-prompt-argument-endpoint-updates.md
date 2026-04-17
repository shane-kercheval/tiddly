# Prompt Argument Endpoint: Split, Rename, Explicit Field Selection, Per-Row UX

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

When the caller sends a `target_index` entry with **both** `name` and `description` populated, the server silently regenerates `description`, overwriting the caller's input. The endpoint's docstring frames individual mode as "fill the missing field," so this both-populated branch is not what the caller asked for — and it still charges quota + provider cost.

Beyond that specific footgun, the single endpoint carries mode-sniffing logic in the request schema, service, prompt builder, frontend hook, and eval config. Every layer has branches that exist only because the HTTP contract is ambiguous.

The decision is to **split into two endpoints** and **make caller intent explicit** rather than inferring it from shape. The old endpoint is removed outright. No dual-serve period, no compatibility aliases.

### Rename

`/ai/suggest-arguments` is also being renamed to use `prompt-argument(s)` in the URL path to disambiguate from "arguments" in the general AI / tool-use sense. This is the right moment to rename since we're already breaking the contract.

### Per-row UX redesign

The current `ArgumentsBuilder` component renders a sparkle icon *inside each input field* (one inside the name input, one inside the description input) with hard-coded enablement rules: name-suggest disabled unless description exists, description-suggest disabled unless name exists.

The new UX replaces the per-field sparkles with a **single per-row sparkle** placed to the right of the "Required" checkbox. Clicking it suggests whichever fields are blank on that row. This simplifies the mental model ("click to fill what's empty") and lets users invoke suggestions on a fully-empty row when the prompt template has unclaimed placeholders (a capability the new backend supports).

---

## Target API design

### `POST /ai/suggest-prompt-arguments` (plural — generate-all)

Propose all new placeholders for a template.

| Field | Required | Default | Purpose |
|---|---|---|---|
| `prompt_content` | **yes** | — | Jinja2 template (`min_length=1, max_length=50_000`). |
| `arguments` | no | `[]` | Existing `{name, description}` entries — names excluded from placeholder extraction (case-insensitive). |
| `model` | no | `null` | BYOK model ID; platform callers: ignored. |

**Response:** `{"arguments": [{name, description, required}, ...]}` — one entry per new placeholder.

**No success-path short-circuits, but two no-LLM-call paths remain** (both return `{"arguments": []}` with quota consumed per FastAPI dependency ordering):
- `prompt_content` has no `{{ }}` placeholders at all (extraction returns empty).
- Every extracted placeholder is already declared in `arguments` by name (case-insensitive dedup).

No `target_index`, no `target_fields`. Nothing to disambiguate.

### `POST /ai/suggest-prompt-argument-fields` (singular — refine one row, one or both fields)

Generate one or both fields of one specific argument row.

| Field | Required | Default | Purpose |
|---|---|---|---|
| `target_index` | **yes** | — | Index into `arguments`. `ge=0`; must be within bounds. |
| `target_fields` | **yes** | — | `list[Literal["name", "description"]]`. Non-empty, ≤ 2 unique elements. |
| `arguments` | **yes** | — | Existing `{name, description}` entries; non-empty. |
| `prompt_content` | no | `null` | Optional Jinja2 template used as grounding context (`min_length=1` when present). |
| `model` | no | `null` | BYOK model ID; platform callers: ignored. |

**Response:** `{"arguments": [{name, description, required}, ...]}` — always a single-element list on a successful LLM call. Empty list only when the LLM-generated name fails `validate_argument_name` and is rejected (quota charged).

**No success-path short-circuits.** All malformed-input cases (empty target + empty content, out-of-range index, duplicate entries in `target_fields`, etc.) are rejected at the schema boundary (422) or service boundary (400). If the request validates, an LLM call is made.

**Error cases:**

- `target_index` out of range (index ≥ `len(arguments)`) → `400` (service-level `ValueError` → `HTTPException`).
- `target_index < 0` → `422` (Pydantic `ge=0`).
- `target_fields` missing / empty list / values outside `{"name", "description"}` / duplicates / > 2 elements → `422`.
- Missing any required field → `422` (Pydantic).
- `arguments` empty list → `422` (Pydantic `field_validator`).
- `prompt_content` is the empty string → `422` (Pydantic `min_length=1`; `None` is fine).
- **Grounding signal missing** → `422` (Pydantic `model_validator`). See rules below.

### Grounding-signal rules (model_validator)

The model validator enforces that the LLM has meaningful input for each requested field. Rules:

- **`target_fields == ["name"]`** requires: `arguments[target_index].description` is non-empty **OR** `prompt_content` is non-empty. (The LLM needs something to base the name on — a description of the concept, or a template placeholder it can reason about.)
- **`target_fields == ["description"]`** requires: `arguments[target_index].name` is non-empty **OR** `prompt_content` is non-empty. (Symmetric.)
- **`target_fields == ["name", "description"]`** requires: `prompt_content` is non-empty. (Both fields are being generated from scratch; only the template can serve as grounding. The row's own fields are empty by the semantic intent of the request — if they weren't, you wouldn't be asking for both.)

When `target_fields` has two elements and `arguments[target_index]` happens to have one or both fields already populated, the LLM is called anyway and the response **overwrites** both fields. This is the explicit-opt-in overwrite path — the caller deliberately asked for both, so the server complies. There is no silent inference.

### Shared response shape

Both endpoints return `{"arguments": list[ArgumentSuggestion]}` — same element shape as today. One shared response model (`SuggestPromptArgumentsResponse`); the N-vs-1 semantic lives in the router docstrings.

### Internal LLM schemas (not part of the public API)

`services/_suggestion_llm_schemas.py` already hosts internal Pydantic models that constrain LLM structured outputs (`ArgumentNameSuggestion`, `ArgumentDescriptionSuggestion`). Two additions in this plan:

```python
class _BothArgumentFieldsSuggestion(BaseModel):
    """LLM response format for the two-field refine case.

    Includes `required` so the two-field path matches generate-all's
    template-aware inference. Single-field refine does not include
    `required` (pre-existing behavior preserved — single-field patches
    one field and doesn't touch the row's required flag).
    """
    name: str
    description: str
    required: bool = False

class _GenerateAllArgumentsResult(BaseModel):
    """LLM response format for the plural generate-all endpoint.

    Decouples the LLM structured-output schema from the public HTTP
    response model so the two contracts can evolve independently.
    """
    arguments: list[_LLMGeneratedArgument]

class _LLMGeneratedArgument(BaseModel):
    name: str
    description: str
    required: bool = False
```

The service layer maps these internal types onto the public `ArgumentSuggestion` / `SuggestPromptArgumentsResponse` shapes.

---

## Files that need touching

Backend:
- `backend/src/schemas/ai.py` — request models
- `backend/src/api/routers/ai.py` — route handlers + docstrings + error-response table
- `backend/src/api/main.py` — AI tag description
- `backend/src/services/suggestion_service.py` — split into two public functions
- `backend/src/services/llm_prompts.py` — split into focused builders + new "both fields" prompt
- `backend/src/services/_suggestion_llm_schemas.py` — add internal LLM response classes

Backend tests:
- `backend/tests/services/test_suggestion_service.py`
- `backend/tests/api/test_ai_suggestions.py`
- `backend/tests/api/test_ai.py`
- `backend/tests/schemas/test_ai_schemas.py`

Frontend:
- `frontend/src/types.ts`
- `frontend/src/services/aiApi.ts` (+ `aiApi.test.ts`)
- `frontend/src/hooks/useArgumentSuggestions.ts` (+ `.test.ts`)
- `frontend/src/hooks/useAIArgumentIntegration.ts` (+ `.test.ts`)
- `frontend/src/components/ArgumentsBuilder.tsx` (UX redesign)
- Test sites that render `ArgumentsBuilder` with sparkle props

Evals:
- `evals/ai_suggestions/test_suggest_arguments.py` → split into two files
- `evals/ai_suggestions/config_suggest_arguments.yaml` → split into two configs

Ops / docs:
- `Makefile` — `evals-ai-suggestions-arguments` target splits
- `docs/architecture.md` — AI use-case wiring table
- `frontend/public/llms.txt` — grep-check for endpoint references
- `frontend/src/pages/docs/DocsAPI.tsx`, `DocsAIFeatures.tsx` — grep-check

Separate icon-consistency pass (Milestone 6):
- `frontend/src/components/ArgumentsBuilder.tsx` (sparkle color)
- Every other component that renders a sparkle icon for AI features — full audit required.

---

## Guidance for the implementing agent

- **Read before implementing.** Before starting each milestone, read the listed files in full so you understand the surrounding conventions (error-response tables, docstring style, test patterns).
- **Ask before deciding.** If any ambiguity shows up — naming, error-code selection, UX details — stop and ask. The project owner's memory explicitly flags "don't decide UX/product details on user's behalf."
- **Verify after each milestone.** Run scoped verify (`make backend-verify` after backend work, `make frontend-verify` after frontend work). Do not run `make tests` for frontend-only milestones.
- **No backwards compatibility.** The old URL, schema name, and service function name are all removed. No aliases.
- **Stop for review after each milestone.** Each milestone is a coherent checkpoint.
- **Tests over comments.** Default to no comments. Cover the behavior change (silent-overwrite removal, new 422 for no-grounding, two-field generation) with explicit tests asserting the new schema-boundary contract.
- **Preserve type hints everywhere** (user global rule — functions and unit tests).
- **No imports inside functions** unless absolutely necessary (user global rule).

### Relevant docs/URLs

- FastAPI request/response body docs: <https://fastapi.tiangolo.com/tutorial/body/>
- FastAPI responses panel docs: <https://fastapi.tiangolo.com/advanced/additional-responses/>
- Pydantic v2 field constraints / `Literal` / `model_validator`: <https://docs.pydantic.dev/latest/concepts/fields/>, <https://docs.pydantic.dev/latest/concepts/validators/#model-validators>
- Pydantic v2 JSON schema examples: <https://docs.pydantic.dev/latest/concepts/json_schema/#schema-customization>

---

## Milestones

Each milestone is independently reviewable. Complete code + tests + doc updates within scope before moving on. Ask for review before proceeding.

### Milestone 1 — Schemas + service + prompt builders (backend core)

**Goal & outcome**

Pure Python layers: no router wiring, no HTTP tests. After this milestone:
- Two new request schemas validate per the target design (including the `target_fields` list with 1–2 elements).
- `SuggestArgumentsRequest` is deleted.
- Two public service functions exist (generate-all and the refine-fields variant), with no mode-sniffing.
- The prompt builder is split, and a new "both fields" prompt exists.
- Internal LLM response schemas are decoupled from the public HTTP response model.

**Implementation outline**

1. **`backend/src/schemas/ai.py`**:

   - Delete `SuggestArgumentsRequest`.
   - Rename `SuggestArgumentsResponse` → `SuggestPromptArgumentsResponse` via search-and-replace. Single shared response model across both endpoints.
   - **Add `mode="before"` whitespace-normalization validators** on `ArgumentInput.name`, `ArgumentInput.description`, and both endpoints' `prompt_content`. Runs before standard field validators so `min_length=1` / `max_length` see already-stripped values. Whitespace-only inputs become `None` (or `""` → 422 on the plural endpoint where `prompt_content` is required). This is the single canonicalization point for whitespace handling — downstream consumers (prompt builder, LLM call, logs, tests, evals) never see leading/trailing whitespace or whitespace-only strings. `ArgumentInput` is reused by both endpoints via the `arguments` field; the normalizer runs everywhere the class is used, which is the intended behavior.

     ```python
     # ArgumentInput — applies everywhere ArgumentInput is used.
     class ArgumentInput(BaseModel):
         name: str | None = Field(None, max_length=200, description=...)
         description: str | None = Field(None, max_length=500, description=...)

         @field_validator("name", "description", mode="before")
         @classmethod
         def normalize_whitespace(cls, v: str | None) -> str | None:
             if v is None:
                 return None
             stripped = v.strip()
             return stripped or None  # "" or whitespace-only → None
     ```

   - Add `SuggestPromptArgumentsRequest` (plural). `prompt_content` is required and non-empty; `mode="before"` strip runs first so `"   "` → `""` → `min_length=1` 422.

     ```python
     class SuggestPromptArgumentsRequest(BaseModel):
         model: str | None = Field(None, description=...)
         prompt_content: str = Field(..., min_length=1, max_length=50_000, description=...)
         arguments: list[ArgumentInput] = Field(default_factory=list, description=...)

         @field_validator("prompt_content", mode="before")
         @classmethod
         def strip_prompt_content(cls, v: object) -> object:
             return v.strip() if isinstance(v, str) else v
     ```

   - Add `SuggestPromptArgumentFieldsRequest` (singular). `target_fields` is a required non-empty list of ≤ 2 unique elements; `arguments` is required and non-empty; `prompt_content` is optional (`min_length=1` when present); a `model_validator(mode="after")` enforces grounding-signal rules using the already-normalized field values.

     ```python
     class SuggestPromptArgumentFieldsRequest(BaseModel):
         model: str | None = Field(None, description=...)
         prompt_content: str | None = Field(None, min_length=1, max_length=50_000, description=...)
         arguments: list[ArgumentInput] = Field(..., description=...)
         target_index: int = Field(..., ge=0, description=...)
         target_fields: list[Literal["name", "description"]] = Field(..., description=...)

         @field_validator("prompt_content", mode="before")
         @classmethod
         def normalize_prompt_content(cls, v: object) -> object:
             # Strip and convert empty/whitespace-only to None so downstream sees canonical values.
             if not isinstance(v, str):
                 return v
             stripped = v.strip()
             return stripped or None

         @field_validator("arguments")
         @classmethod
         def arguments_not_empty(cls, v: list[ArgumentInput]) -> list[ArgumentInput]:
             if not v:
                 raise ValueError("arguments must contain at least one entry")
             return v

         @field_validator("target_fields")
         @classmethod
         def target_fields_valid(
             cls, v: list[Literal["name", "description"]],
         ) -> list[Literal["name", "description"]]:
             if not v:
                 raise ValueError("target_fields must contain at least one of 'name' or 'description'")
             if len(set(v)) != len(v):
                 raise ValueError("target_fields must not contain duplicates")
             if len(v) > 2:
                 raise ValueError("target_fields can have at most 2 elements")
             # Canonicalize to fixed order so logs/tests/evals don't depend on caller ordering.
             order = {"name": 0, "description": 1}
             return sorted(v, key=order.__getitem__)

         @model_validator(mode="after")
         def has_grounding_signal(self) -> "SuggestPromptArgumentFieldsRequest":
             # Safe from IndexError here: `arguments_not_empty` and `target_index: Field(..., ge=0)`
             # both run as field-level validation before this runs. The early-return below
             # guards the upper bound. If a future edit relaxes either of those invariants,
             # this validator needs a defensive check added — do not rely on ordering quietly.
             if self.target_index >= len(self.arguments):
                 return self  # service-layer 400 handles out-of-range
             target = self.arguments[self.target_index]
             wants_name = "name" in self.target_fields
             wants_description = "description" in self.target_fields
             # `has_template` is trivially `bool(self.prompt_content)` because the `mode="before"`
             # validator converted whitespace-only strings to None. Same for `target.name` /
             # `target.description` via ArgumentInput's normalizer. Single canonicalization point.
             has_template = bool(self.prompt_content)
             if wants_name and wants_description:
                 # Both requested — only the template can ground this.
                 if not has_template:
                     raise ValueError(
                         "Cannot generate both name and description without prompt_content "
                         "as grounding.",
                     )
             elif wants_name:
                 if not target.description and not has_template:
                     raise ValueError(
                         "Cannot suggest 'name': arguments[target_index].description is empty "
                         "and prompt_content is empty. LLM has no grounding signal.",
                     )
             else:  # wants_description
                 if not target.name and not has_template:
                     raise ValueError(
                         "Cannot suggest 'description': arguments[target_index].name is empty "
                         "and prompt_content is empty. LLM has no grounding signal.",
                     )
             return self
     ```

   - Update `json_schema_extra` examples on both models.

2. **`backend/src/services/_suggestion_llm_schemas.py`**:

   - Keep `ArgumentNameSuggestion` and `ArgumentDescriptionSuggestion` for single-field refines.
   - Add `_BothArgumentFieldsSuggestion(BaseModel)` with `name: str`, `description: str`, `required: bool = False`. The `required` field is included (symmetric with generate-all) because the two-field path regenerates the whole argument from template context — the LLM has the template and can infer whether the chosen placeholder is unconditional (required) or inside a `{% if %}` block.
   - Add `_LLMGeneratedArgument(BaseModel)` (`name`, `description`, `required: bool = False`) and `_GenerateAllArgumentsResult(BaseModel)` wrapping a `list[_LLMGeneratedArgument]`. The service layer maps these internal types onto the public `ArgumentSuggestion` shape. This decouples the LLM structured-output schema from the HTTP response model.

3. **`backend/src/services/llm_prompts.py`**:

   Replace `build_argument_suggestion_messages` with three focused builders (each with a single system prompt, no branching):

   ```python
   def build_generate_all_arguments_messages(
       prompt_content: str,
       existing_arguments: list[ArgumentInput],
       placeholder_names: list[str],
   ) -> list[dict]: ...

   def build_refine_single_field_messages(
       target_field: Literal["name", "description"],
       target_arg: ArgumentInput,
       existing_arguments: list[ArgumentInput],
       prompt_content: str | None,
   ) -> list[dict]: ...

   def build_refine_both_fields_messages(
       target_index: int,
       existing_arguments: list[ArgumentInput],
       prompt_content: str,  # guaranteed non-empty by model_validator
       unclaimed_placeholder_names: list[str],  # deterministically filtered by service
   ) -> list[dict]: ...
   ```

   The "both fields" system prompt should instruct the LLM to: propose a single `{name, description, required}` pair for the argument at `target_index`, pick **one of the listed `unclaimed_placeholder_names`** (the service pre-filters so the LLM never sees claimed names), follow `lowercase_with_underscores`, and use the existing `required_guideline` (mark required iff the chosen placeholder appears unconditionally in the template; not required if inside `{% if %}`). `extract_template_placeholders` stays shared. The service computes `unclaimed_placeholder_names` deterministically — matching the generate-all pattern at `suggestion_service.py:438-440` — so collisions with already-claimed rows are prevented before the LLM sees the request.

4. **`backend/src/services/suggestion_service.py`**:

   Replace `suggest_arguments` and `_suggest_arguments_generate_all` with:

   ```python
   async def suggest_prompt_arguments(
       *,
       prompt_content: str,
       arguments: list[ArgumentInput],
       llm_service: LLMService,
       config: LLMConfig,
   ) -> tuple[list[ArgumentSuggestion], float | None]:
       """Generate descriptions for all new placeholders. Uses `_GenerateAllArgumentsResult`
       as response_format, then maps onto public ArgumentSuggestion."""

   async def suggest_prompt_argument_fields(
       *,
       prompt_content: str | None,
       arguments: list[ArgumentInput],
       target_index: int,
       target_fields: list[Literal["name", "description"]],
       llm_service: LLMService,
       config: LLMConfig,
   ) -> tuple[list[ArgumentSuggestion], float | None]:
       """Refine one argument. Dispatches on len(target_fields): 1 → single-field
       LLM call with ArgumentNameSuggestion or ArgumentDescriptionSuggestion;
       2 → both-fields LLM call with _BothArgumentFieldsSuggestion."""
   ```

   Behaviors:
   - `suggest_prompt_arguments`: bulk relocation of `_suggest_arguments_generate_all`. Drop the `if not prompt_content` branch (schema enforces non-empty). Pass `_GenerateAllArgumentsResult` as `response_format`; map to `list[ArgumentSuggestion]` before returning.
   - `suggest_prompt_argument_fields`:
     - Raise `ValueError("target_index N is out of range ...")` if `target_index >= len(arguments)`.
     - No "both-empty" short-circuit — the schema 422's that case.
     - Branch on `len(target_fields)`:
       - **Single field**: build messages via `build_refine_single_field_messages`, response_format `ArgumentNameSuggestion` or `ArgumentDescriptionSuggestion`. For `"name"`: run `validate_argument_name`; on failure return `([], cost)`. Preserve the opposite field from `target_arg` in the returned suggestion (matches current behavior).
       - **Both fields**: two-layer placeholder-collision protection.
         1. **Pre-filter (deterministic):** before the LLM call, compute `unclaimed_placeholder_names = [p for p in extract_template_placeholders(prompt_content) if p.lower() not in existing_names]` — same pattern as generate-all. If the list is empty (every template placeholder is already claimed), return `([], None)` without calling the LLM.
         2. Build messages via `build_refine_both_fields_messages`, passing `unclaimed_placeholder_names`. Response_format `_BothArgumentFieldsSuggestion`. Validate the returned name via `validate_argument_name`; on failure return `([], cost)`.
         3. **Post-validate (defensive):** if the returned name is in `existing_names` (case-insensitive — LLM ignored the pre-filter), return `([], cost)` as backstop. Quota charged.
         4. Return a single `ArgumentSuggestion(name=..., description=..., required=parsed.required)`. The `required` flag comes from the LLM — the two-field path IS the regenerate-whole-row path, so `required` inference is meaningful here (unlike single-field, which preserves the existing argument's implicit state).

**Testing strategy** (`backend/tests/services/test_suggestion_service.py`)

Replace the existing `TestSuggestArguments` with two classes:

`TestSuggestPromptArguments` (plural):
- `test_extracts_placeholders` — 2 placeholders, empty existing args → both returned.
- `test_excludes_existing_placeholders` — case-insensitive dedup against existing `arguments`.
- `test_no_placeholders_short_circuits` — raw template, no `{{ }}` → `([], None)`, LLM not called.
- `test_all_placeholders_defined_short_circuits` — every placeholder already declared → `([], None)`, LLM not called.
- `test_filters_invalid_names` — LLM returns an invalid identifier → filtered out.
- `test_required_field_preserved` — `required=True/False` carried through.
- `test_parse_error_raises_with_cost` — bad JSON → `LLMResponseParseError` with cost.
- `test_uses_internal_llm_schema` — assert the `response_format` passed to `llm_service.complete` is `_GenerateAllArgumentsResult`, not `SuggestPromptArgumentsResponse` (protects the decoupling).

`TestSuggestPromptArgumentFields` (singular):
- `test_refine_name_only_generates_name` — `target_fields=["name"]`, description only → single suggestion with new name + preserved description.
- `test_refine_description_only_generates_description` — symmetric.
- `test_refine_name_only_when_both_populated_overwrites_name` — `target_fields=["name"]`, both populated → LLM called, suggestion has new name + original description. **Explicit-opt-in regression test.**
- `test_refine_description_only_when_both_populated_overwrites_description` — symmetric.
- `test_refine_both_fields_empty_row_with_template` — `target_fields=["name","description"]`, row blank, template has 2 unclaimed placeholders → LLM called, returns new name+description aligned to one placeholder.
- `test_refine_both_fields_overwrites_populated_row` — `target_fields=["name","description"]`, row has both fields populated, template provided → LLM called, suggestion replaces both fields. **Explicit-opt-in regression test** for the documented server contract (programmatic callers may invoke this even though UX will not).
- `test_refine_both_fields_filters_claimed_placeholders_before_llm` — existing arguments list contains `topic`; template has `{{ topic }}` + `{{ audience }}`; `target_fields=["name","description"]`. Assert the LLM prompt passed to `llm_service.complete` communicates `audience` as the only unclaimed placeholder (never sees `topic`). Deterministic service-side filter.
- `test_refine_both_fields_rejects_claimed_name_from_llm_response` — mock LLM to return a name that collides with an existing argument (ignoring the pre-filter). Service returns `([], cost)` as defensive backstop; quota charged.
- `test_refine_both_fields_all_placeholders_claimed_short_circuits` — every template placeholder is already declared in `arguments`. Service returns `([], None)` without calling the LLM.
- `test_refine_both_fields_required_inferred_from_conditional` — template has `{{ topic }}` (unconditional) and `{% if context %}{{ context }}{% endif %}`; empty row, `target_fields=["name","description"]`. Mock LLM to return `required=True` or `required=False`; assert the value is propagated onto the returned `ArgumentSuggestion`.
- `test_refine_both_fields_invalid_name_returns_empty_with_cost` — both-field LLM response has invalid name → `([], cost)`.
- `test_refine_name_only_with_empty_target_but_template_context_calls_llm` — row blank, template populated, `target_fields=["name"]` → LLM called (template is grounding).
- `test_invalid_name_generated_returns_empty_with_cost` (single-field version) — `target_fields=["name"]`, LLM returns invalid identifier → `([], cost)`.
- `test_target_index_out_of_range_raises_value_error` — LLM not called.
- `test_parse_error_raises_with_cost` — bad JSON → `LLMResponseParseError` with cost.

Schema-level tests in `backend/tests/schemas/test_ai_schemas.py`:

- `SuggestPromptArgumentFieldsRequest` rejects empty `arguments` list.
- Rejects unknown element in `target_fields` (e.g. `["foo"]`).
- Rejects missing `target_fields` / `target_index` / `arguments`.
- Rejects `target_fields=[]` (empty list).
- Rejects `target_fields=["name","name"]` (duplicates).
- Rejects `target_fields=["name","description","foo"]` (invalid element) and any list with >2 elements.
- Rejects `target_index < 0`.
- Rejects `prompt_content=""` (via `min_length=1`).
- Rejects `target_fields=["name"]` + target.description empty + `prompt_content=None` (no grounding).
- Rejects `target_fields=["description"]` + target.name empty + `prompt_content=None` (no grounding).
- Rejects `target_fields=["name","description"]` + `prompt_content=None` (no grounding for both-field path).
- Rejects `target_fields=["name"]` when `target.description` is empty and `prompt_content` is empty (even if `target.name` is populated — opposite-field rule).
- Rejects `target_fields=["description"]` when `target.name` is empty and `prompt_content` is empty (symmetric).
- Accepts `target_fields=["name","description"]` + non-empty `prompt_content`.
- Accepts `target_fields=["name"]` + empty target + non-empty `prompt_content` (template-only grounding).
- Accepts `target_index >= len(arguments)` at the schema layer (model_validator short-circuits; service-layer handles it as 400).
- `test_target_fields_canonicalized` — input `["description","name"]` returns `["name","description"]` after validation.
- **Whitespace normalization (new):**
  - `ArgumentInput(name="  foo  ", description="  bar  ")` stores as `ArgumentInput(name="foo", description="bar")`.
  - `ArgumentInput(name="   ", description="bar")` stores with `name=None`, `description="bar"` (whitespace-only → `None`).
  - `ArgumentInput(name="", description="")` stores with both fields `None`.
  - `ArgumentInput(name="a" * 200 + "   ")` accepted (stripped to 200 chars, passes `max_length=200`).
  - `SuggestPromptArgumentsRequest(prompt_content="   ")` → 422 (stripped to `""`, fails `min_length=1`).
  - `SuggestPromptArgumentsRequest(prompt_content="  template  ")` accepted; stored value is `"template"` (leading/trailing whitespace stripped).
  - `SuggestPromptArgumentFieldsRequest(prompt_content="   ")` → normalized to `None`; whether request succeeds overall depends on other grounding (covered by grounding tests above).
  - `SuggestPromptArgumentFieldsRequest(prompt_content=None, target_fields=["name"], arguments=[{name:"  ", description:"   "}], target_index=0)` → both `name` and `description` normalize to `None`; grounding check fires 422 ("no grounding signal"). Confirms the whitespace → `None` conversion flows through to the model_validator correctly.
- **Preserve `test_ai_schemas.py`'s drift guard coverage.** The `schemas_with_examples` list at `backend/tests/schemas/test_ai_schemas.py:92-98` currently includes `SuggestArgumentsRequest` (line 96) and imports it (line 9). **Replace** the entry with both `SuggestPromptArgumentsRequest` and `SuggestPromptArgumentFieldsRequest`; update the import accordingly. Do not merely remove — the drift guard catches stale model IDs in Swagger examples at CI time, and silently losing coverage means a future example-model change could leak an unsupported value.
- `SuggestPromptArgumentsRequest` requires `prompt_content`.
- `SuggestPromptArgumentsRequest` rejects `prompt_content=""`.
- Remove any tests that referenced `SuggestArgumentsRequest`.

---

### Milestone 2 — Router wiring + endpoint-level error handling

**Goal & outcome**

- `POST /ai/suggest-prompt-arguments` and `POST /ai/suggest-prompt-argument-fields` live.
- `POST /ai/suggest-arguments` removed (404 on any residual caller).
- Swagger shows both endpoints with accurate request tables, response tables, example payloads, and error-response panels. No leaked `target_index_out_of_range` example on endpoints that lack `target_index`.

**Implementation outline**

1. **`backend/src/api/routers/ai.py`**:

   - Delete the `@router.post("/suggest-arguments", ...)` handler and its docstring.
   - Add two new handlers — one per endpoint — using the existing suggestion-endpoint style (rate-limit dependency, cost tracking, parse-error handling via `_handle_parse_error`).
   - Each handler calls the corresponding service function from Milestone 1.
   - Docstrings: one intent per endpoint. Request/response tables specific to that endpoint. Preserve the "See the `ai` tag description" footer.
   - **Refactor `_LLM_CALL_ERROR_RESPONSES[400]`** to remove the `target_index_out_of_range` example — that example currently appears on every endpoint that shares `AI_SUGGESTION_RESPONSES` (tags, metadata, relationships, old arguments), misleading Swagger readers. Pre-existing Swagger hygiene bug; this split is the right moment to fix.
     - Update the 400 prose to drop the `suggest-arguments service validation failures` language.
     - Define an endpoint-specific override for the singular endpoint:

       ```python
       _SUGGEST_PROMPT_ARGUMENT_FIELDS_400 = {
           400: {
               "model": AIErrorResponse,
               "description": "... standard 400 prose + target_index out-of-range note ...",
               "content": {"application/json": {"examples": {
                   "unsupported_model": {...},
                   "llm_bad_request": {...},
                   "target_index_out_of_range": {
                       "summary": "suggest-prompt-argument-fields service validation",
                       "value": {
                           "detail": "target_index 5 is out of range (arguments has 2 items)",
                       },
                   },
               }}},
           },
       }
       SUGGEST_PROMPT_ARGUMENT_FIELDS_RESPONSES = {
           **AI_SUGGESTION_RESPONSES,
           **_SUGGEST_PROMPT_ARGUMENT_FIELDS_400,
       }
       ```

     - Plural endpoint and the other four suggestion endpoints keep using `AI_SUGGESTION_RESPONSES` (now cleaner).
     - Singular endpoint decorator: `responses=SUGGEST_PROMPT_ARGUMENT_FIELDS_RESPONSES`.

2. **`backend/src/api/main.py`**:

   - Update the AI tag description at line 164 — the sentence referencing `/ai/suggest-arguments` in the "both-fields-empty individual-mode case." With the split, there's no empty-response-with-quota-charged case on either new endpoint (schema 422's it). Rewrite: remove the arguments-specific example, or replace with one of the remaining no-LLM-call cases (e.g. plural returning empty when all placeholders are already declared).

**Testing strategy** (`backend/tests/api/test_ai_suggestions.py`)

Replace `TestSuggestArguments` with two classes.

`TestSuggestPromptArguments` (plural):
- `test_generate_all_from_template`
- `test_generate_all_excludes_existing`
- `test_tracks_cost`
- `test_filters_invalid_argument_names`
- `test_required_field_included_in_response`
- `test_returns_empty_when_all_placeholders_exist`
- `test_missing_prompt_content_returns_422`
- `test_empty_prompt_content_returns_422` (`min_length=1`)

`TestSuggestPromptArgumentFields` (singular):
- `test_suggest_name_only` — `target_fields=["name"]`, description populated → 200 with generated name.
- `test_suggest_description_only` — symmetric.
- `test_suggest_both_fields_empty_row_with_template` — `target_fields=["name","description"]`, row blank, template populated → 200 with generated name + description.
- `test_refine_description_overwrites_populated_field` — both fields populated + `target_fields=["description"]` → LLM called, description replaced. **Behavior-change regression test.**
- `test_refine_both_overwrites_populated_row` — both fields populated + `target_fields=["name","description"]` + template → LLM called, both fields replaced in the response. **Documented-contract regression test.**
- `test_works_with_no_template_when_target_has_context` — `prompt_content` omitted but target has a name/description (for the opposite-field requested) → 200, LLM called.
- `test_tracks_cost`
- `test_target_index_out_of_range_returns_400`
- `test_negative_target_index_returns_422`
- `test_missing_target_fields_returns_422`
- `test_empty_target_fields_returns_422`
- `test_invalid_target_fields_element_returns_422`
- `test_duplicate_target_fields_returns_422`
- `test_too_many_target_fields_returns_422`
- `test_empty_arguments_returns_422`
- `test_empty_prompt_content_returns_422`
- `test_both_fields_empty_target_no_template_returns_422` (the grounding 422 for `target_fields=["name","description"]`).
- `test_suggest_name_with_empty_target_no_template_returns_422` (grounding 422 for single-field with only the target field itself populated or no template).
- `test_suggest_name_with_empty_row_but_template_calls_llm`.

`backend/tests/api/test_ai.py`:
- Rename `test_suggest_arguments_unsupported_model` and update URL to hit the plural endpoint (exercises full generate path).

---

### Milestone 3 — Frontend: types, API client, hook, component UX redesign, integration

**Goal & outcome**

- Types and API client match the new backend.
- `ArgumentsBuilder` component rendered with **one per-row sparkle** to the right of the "Required" checkbox — no more per-field sparkles.
- Sparkle button enablement follows the "grounding signal" rule: enabled iff (any row field is blank) AND (some row field populated OR `prompt_content` populated).
- Click fires `/ai/suggest-prompt-argument-fields` with `target_fields` derived from which fields are blank. Response patches the row's blank fields.
- Per-row sparkles serialize: while one is in flight, all other per-row sparkles (on the same prompt) are disabled.
- Generate-all button continues to work, calling the plural endpoint.

**Implementation outline**

1. **`frontend/src/types.ts`** — in the `/ai/suggest-arguments` section:
   - Delete `SuggestArgumentsRequest`.
   - Rename `SuggestArgumentsResponse` → `SuggestPromptArgumentsResponse`.
   - Add:

     ```ts
     export interface SuggestPromptArgumentsRequest {
       model?: string | null
       prompt_content: string
       arguments?: ArgumentInput[]
     }

     export interface SuggestPromptArgumentFieldsRequest {
       model?: string | null
       prompt_content?: string | null
       arguments: ArgumentInput[]
       target_index: number
       target_fields: Array<'name' | 'description'>  // non-empty, 1 or 2 unique elements
     }
     ```

2. **`frontend/src/services/aiApi.ts`** — replace `suggestArguments` with two functions:

   ```ts
   export async function suggestPromptArguments(
     data: SuggestPromptArgumentsRequest,
   ): Promise<SuggestPromptArgumentsResponse> { /* POST /ai/suggest-prompt-arguments */ }

   export async function suggestPromptArgumentFields(
     data: SuggestPromptArgumentFieldsRequest,
   ): Promise<SuggestPromptArgumentsResponse> { /* POST /ai/suggest-prompt-argument-fields */ }
   ```

3. **`frontend/src/hooks/useArgumentSuggestions.ts`**:

   - Update the JSDoc header at lines 1-17: remove the "three modes" framing; describe the two-endpoint routing (`suggestAll` → plural; new `suggestRowFields` → singular with `target_fields` computed from blank fields).
   - **Preserve the existing shared `requestIdRef` pattern at `useArgumentSuggestions.ts:62`.** A single ref, bumped on every call (all modes: generate-all and per-row), checked against `thisRequestId` on every resolution. This gives last-write-wins across all modes — don't split it into per-method refs during the refactor. This is the defense-in-depth layer that backs up the hard-gating added to `ArgumentsBuilder`; the two together eliminate cross-mode response races.
   - Replace `suggestName` and `suggestDescription` with a single `suggestRowFields(index, promptContent, existingArgs, onUpdate)` method. **The hook does not merge against state — it just fetches.** On success, it calls `onUpdate(index, suggestion, targetFields)` where `suggestion` is the full `ArgumentSuggestion` the backend returned. Merge semantics ("patch only blank fields at resolution time") live in the integration layer (step 4) where live `prev` state is available via `setCurrent(prev => ...)`. The hook:
     - Computes `target_fields` from the snapshot of the row at call time: `["name"]` if only name is blank, `["description"]` if only description is blank, `["name", "description"]` if both are blank. If neither is blank, early-return (defense-in-depth — the button should already be disabled).
     - Calls `suggestPromptArgumentFields({ target_index, target_fields, arguments, prompt_content })`.
     - Bumps `requestIdRef` before firing; on resolution, checks `requestIdRef.current === thisRequestId` before calling `onUpdate` (existing stale-response guard).
     - Passes the full `suggestion` and the computed `targetFields` up via `onUpdate` — no state-reading, no merging.
   - `onUpdate` signature: `(index: number, suggestion: ArgumentSuggestion, targetFields: Array<'name' | 'description'>) => void`.
   - Keep `suggestAll` unchanged except it now calls `suggestPromptArguments`. It still bumps the same shared `requestIdRef`.
   - Expose a boolean `suggestingAnyRow` (true while any per-row call is in flight). Used by the integration layer and component to disable (a) all other per-row sparkles AND (b) the generate-all sparkle during serialization.

4. **`frontend/src/hooks/useAIArgumentIntegration.ts`**:
   - Replace the separate `suggestName` / `suggestDescription` handlers with one `handleSuggestRow(index)` that calls the hook's `suggestRowFields`. The `onUpdate` callback it supplies uses `setCurrent(prev => ...)` so merge decisions are made against **live state at resolution time**, not snapshot state at call time:

     ```ts
     const handleSuggestRow = (index: number) => {
       suggestRowFields(index, current.content, current.arguments, (idx, suggestion, targetFields) => {
         setCurrent(prev => {
           const args = [...prev.arguments]
           const row = args[idx]
           if (!row) return prev  // row removed mid-flight — discard suggestion silently
           const patched = { ...row }
           // Patch only fields that are (a) in targetFields and (b) still blank in live state.
           if (targetFields.includes('name') && !row.name) patched.name = suggestion.name
           if (targetFields.includes('description') && !row.description) patched.description = suggestion.description
           // `required` only applies for the two-field regenerate-whole-row case.
           // AND only if the live row is still observably blank — otherwise the suggestion
           // is landing on a row the user has since edited (index-shift or direct edit),
           // and `required` inference is no longer meaningful. Single-field refine never
           // touches `required` (preserves user's manual checkbox choice).
           if (targetFields.length === 2 && !row.name && !row.description) {
             patched.required = suggestion.required
           }
           args[idx] = patched
           return { ...prev, arguments: args }
         })
       })
     }
     ```

   - Compute a `rowSuggestDisabled(index)` boolean: `true` iff the row has no blank fields, OR (all row fields blank AND `prompt_content` blank).
   - Compute a `rowSuggestTooltip(index)` string that reflects the disable reason (see tooltip copy below).
   - Pass `suggestingAnyRow` and `isSuggestingAll` to the component so it can disable per-row sparkles AND the generate-all sparkle appropriately.

5. **`frontend/src/components/ArgumentsBuilder.tsx`** — UX redesign:
   - **Remove** the sparkle icons from inside the name and description inputs, including the `group/suggest-name` and `group/suggest-desc` wrappers (lines ~62-111 and ~116-149). The inputs return to their plain `input` styling.
   - **Add** a per-row sparkle button to the right of the "Required" checkbox and to the left of the remove (×) button. Styled like the existing `btn-icon` pattern used by the generate-all button in the header.
   - Wire it to `onSuggestRow(index)`, `isSuggestingRow`, `rowSuggestDisabled`, `rowSuggestTooltip` props (new).
   - **Remove** the old `onSuggestName`, `onSuggestDescription`, `isSuggestingName`, `isSuggestingDescription`, `suggestingIndex`, `suggestingField` props. If removal surfaces an unexpected caller need, stop and ask — do not repurpose silently.
   - Per-row sparkle disable condition: `rowSuggestDisabled(index) || isSuggestingRow(index) || suggestingAnyRow || isSuggestingAll || disabled`. The `suggestingAnyRow` term is the serialization gate (one per-row call at a time); `isSuggestingAll` prevents per-row fires during generate-all (existing behavior).
   - **Generate-all button disable condition also updates:** add `suggestingAnyRow` to the existing `suggestAllDisabled || isSuggestingAll || disabled`. This closes the cross-mode race where firing generate-all while a per-row is in flight can shift indices and leave the per-row's `target_index` pointing at a different row at resolution time. Symmetric with how per-row already gates on `isSuggestingAll` today.
   - **Tooltip copy and priority** (options listed below; **stop and ask the project owner to pick the enabled/disabled wording before implementing** — per the "don't decide UX on user's behalf" rule). Pair the enabled option with the three disabled variants so messaging is consistent:
     - Enabled: `"Suggest empty fields"` or `"Generate suggestions for empty fields"`.
     - Disabled because row is fully populated: `"Row is complete. Clear a field to request a suggestion."`
     - Disabled because no grounding: `"Add a name, description, or prompt template to enable suggestions."`
     - Disabled because another row's suggestion is in flight: match whatever pattern the existing `isSuggestingAll` disabled state uses today (typically no custom tooltip — the user sees the button greyed and the spinner on the active row).
   - **Priority ordering** when multiple disable reasons apply — check in this order, first match wins. Principle: show the most actionable reason (user can do something about it), suppress transient reasons (will resolve on their own):
     1. **Globally disabled** (`disabled` prop from parent) — no custom tooltip; inherited parent state.
     2. **In flight** (`isSuggestingRow(index) || suggestingAnyRow || isSuggestingAll`) — no custom tooltip; the spinner on the active operation communicates state.
     3. **Row is complete** (both name and description populated) — use the row-complete tooltip.
     4. **No grounding** (no field populated AND no `prompt_content`) — use the no-grounding tooltip.

     **Stop and confirm this priority ordering with the project owner along with the tooltip wording** — the ordering is a UX decision in the same category as the copy.

6. **`frontend/src/hooks/useArgumentSuggestions.test.ts`**:
   - Update mock imports to `suggestPromptArguments` + `suggestPromptArgumentFields`.
   - Test `suggestRowFields` with each of: only-name-blank → `target_fields=["name"]`; only-description-blank → `target_fields=["description"]`; both-blank → `target_fields=["name","description"]`; neither-blank → no-op (API function not called).
   - Test `suggestRowFields` no-ops when row is empty AND template is empty.
   - Test `suggestRowFields` fires when row is empty but template is populated (with `target_fields=["name","description"]`).
   - Test `suggestingAnyRow` flips true during in-flight, false after resolution.
   - Test `suggestRowFields` passes the full `suggestion` and `targetFields` to `onUpdate` without reading or merging state.
   - Test stale-response discard: fire row request (request A), then fire generate-all (request B) before A resolves, then resolve A → A's `onUpdate` NOT called (because `requestIdRef.current !== thisRequestIdA`). Symmetric: fire generate-all, then fire row, resolve generate-all late → ignored.
   - Test `suggestAll` bumps the same shared `requestIdRef` as `suggestRowFields` (prevents accidental per-method ref during refactor).

7. **`frontend/src/hooks/useAIArgumentIntegration.test.ts`**:
   - Replace name/description handler tests with `handleSuggestRow` tests.
   - Test `rowSuggestDisabled` / `rowSuggestTooltip` across all combinations (both-populated, both-blank-no-template, both-blank-with-template, name-populated-only, description-populated-only).
   - Test `handleSuggestRow` preserves a mid-flight edit: fire row sparkle (description blank), edit description while in flight, resolve → description edit preserved (the `setCurrent(prev => ...)` merge sees the edit and skips patching).
   - Test `handleSuggestRow` discards silently when the targeted row is removed mid-flight.
   - Test `handleSuggestRow` applies `required` only for the two-field case; single-field does not touch the row's `required` flag.
   - Test `handleSuggestRow` two-field discards `required` if the row is no longer observably blank at resolution time: fire two-field sparkle on a blank row, user types a name mid-flight, resolve → name not overwritten (existing behavior), description patched (still blank), `required` NOT touched (since the row has content now and is no longer the regenerate-from-blank case the call was for).
   - Combined-state tooltip/priority tests covering the priority rule: row populated AND another row in flight → in-flight wins (no custom tooltip); row blank + no template AND globally disabled → globally disabled wins (no custom tooltip).

8. **`frontend/src/components/ArgumentsBuilder.test.tsx`** (if it exists — agent should check):
   - Update to exercise the new per-row sparkle.
   - Confirm the inputs no longer contain sparkle children.

**Verify**: `make frontend-verify`. Do not run backend tests.

---

### Milestone 4 — Evals split

**Goal & outcome**

Each endpoint has its own eval suite and YAML config. Judge scoring preserves the grading criteria of the old combined config.

**Implementation outline**

1. Create `evals/ai_suggestions/config_suggest_prompt_arguments.yaml`:
   - Copy the three `generate-all-*` test cases.
   - Drop `mode`, `suggest_field`, `target_index` from `input`.
   - **Judge-prompt guidance**: preserve all grading criteria from the current config — only remove mode-dispatch framing. Keep "descriptions should be specific and helpful," `lowercase_with_underscores` naming, required-field inference. Remove "three modes" and "individual mode returns only one argument" (irrelevant here).

2. Create `evals/ai_suggestions/config_suggest_prompt_argument_fields.yaml`:
   - Copy the `suggest-name` and `suggest-description` cases.
   - Add one new case: `refine-both-from-template` — `target_fields=["name","description"]`, empty arguments row, template with multiple placeholders; asserts the returned name matches one of the unclaimed placeholders and description is specific.
   - Replace the old `suggest_field` key with `target_fields: list`.
   - **Judge-prompt guidance**: preserve all grading criteria. Replace "three modes" explainer with a `target_fields`-aware framing ("this endpoint returns exactly one refined argument; `target_fields` tells the judge which fields were being generated"). Keep the "if description clearly maps to a placeholder, suggest that placeholder's name" criterion for `target_fields=["name"]` cases; extend it for the two-field case ("the returned name should match an unclaimed placeholder in the template").

3. Create `evals/ai_suggestions/test_suggest_prompt_arguments.py`:
   - Calls `suggest_prompt_arguments()` with only plural parameters.

4. Create `evals/ai_suggestions/test_suggest_prompt_argument_fields.py`:
   - Calls `suggest_prompt_argument_fields()` passing `target_fields` (list).

5. Delete `evals/ai_suggestions/test_suggest_arguments.py` and `config_suggest_arguments.yaml`.

6. **`Makefile`** — replace `evals-ai-suggestions-arguments` with:

   ```makefile
   evals-ai-suggestions-prompt-arguments:  ## Run prompt-argument generate-all evaluations
       PYTHONPATH=$(PYTHONPATH) uv run pytest evals/ai_suggestions/test_suggest_prompt_arguments.py -vs --timeout=300

   evals-ai-suggestions-prompt-argument-fields:  ## Run prompt-argument-fields refine evaluations
       PYTHONPATH=$(PYTHONPATH) uv run pytest evals/ai_suggestions/test_suggest_prompt_argument_fields.py -vs --timeout=300
   ```

**Testing strategy**

`pytest --collect-only evals/ai_suggestions/` to verify the files parse and collect.

**Judge-drift sanity check — REQUIRED before retiring old `evals/ai_suggestions/results/2026-04-13*.json` baselines.** Run both new configs once against the same model set as the last old-config run. Do not delete old `results/` files until the comparison below clears.

**Specific stop criteria** (any one triggers a halt):

1. **Like-for-like comparison required.** Post-split suite means are NOT directly comparable to the old combined-suite mean (the case mix changed). Compare subsets:
   - Old `generate-all-basic`, `generate-all-conditional`, `generate-all-complex` cases vs the corresponding cases in the new plural suite (`config_suggest_prompt_arguments.yaml`) — same case IDs, same model set, same sample count.
   - Old `suggest-name` and `suggest-description` cases vs the corresponding cases in the new singular suite (`config_suggest_prompt_argument_fields.yaml`).
   - The new `refine-both-from-template` case has no old counterpart — track it independently, don't factor it into the drift comparison.
2. **Aggregate threshold.** Any subset/model pair dropping more than **10 percentage points** in pass rate halts the split. (10pp chosen as the noise floor with 10 samples per case — `samples: 10` in the existing eval config; tighter thresholds risk flagging noise as drift.)
3. **Zero tolerance on previously-passing rubric criteria.** If any rubric criterion that passed in the old run fails in the new run on the same case + model, halt regardless of aggregate numbers. "Previously passing" is defined by the most recent `evals/ai_suggestions/results/2026-04-13*.json` files.
4. **If either criterion fires:** re-examine the judge prompt for a lost load-bearing criterion before continuing. Restore the criterion and re-run. Do not adjust the thresholds to make the halt go away.

The cost is one eval run against the model set; the downside of silent drift is permanent.

---

### Milestone 5 — Docs and discoverability

**Goal & outcome**

External-facing references to the old endpoint URL are updated. Architecture doc reflects the split.

**Implementation outline**

1. `docs/architecture.md` line 284 (`AI use-case wiring status` table): update `SUGGESTIONS` row's "Wired up" list: replace `suggest-arguments` with `suggest-prompt-arguments, suggest-prompt-argument-fields`.
2. `frontend/public/llms.txt`: grep for `suggest-arguments`. If present, replace with both new URLs.
3. `frontend/src/pages/docs/DocsAPI.tsx`, `DocsAIFeatures.tsx`: grep for `suggest-arguments`. `DocsAPI.tsx:124` reads "argument suggestions" (generic) — probably fine. Only update references that name the old URL.
4. `AGENTS.md`: grep to be sure. No known references.
5. `docs/implementation_plans/2026-03-18-llm-integration.md` and `2026-04-08-llm-suggestion-evals.md`: historical; **do not edit**.

**Testing**: grep-verify no stale `/ai/suggest-arguments` URL outside `docs/implementation_plans/` and this plan file.

Final verification: `make backend-verify && make frontend-verify`.

---

### Milestone 6 — AI sparkle icon color consistency (cross-cutting)

**Goal & outcome**

All AI sparkle icons across the app use the same color-treatment as the rest of the app's icons (not the faded light-gray they use today). Disabled state remains light-gray (the "needs grounding" signal). After this milestone, AI suggest buttons are visible at a glance in the default state.

**Implementation outline**

1. **Audit all sparkle-icon usages.** Start with the known sites:
   - `ArgumentsBuilder.tsx` (per-row sparkle — already being added in Milestone 3; include in audit for color alignment).
   - The generate-all sparkle in the `ArgumentsBuilder` header.
   - `useAIMetadataIntegration` consumer sites: title and description sparkle icons on prompt/note/bookmark editors.
   - Relationship-suggest sparkle (wherever it's rendered).
   - Tag-suggest sparkle (wherever it's rendered).
   - Any other `SparklesIcon` import in `frontend/src/components/`.
   - Grep: `SparklesIcon` to enumerate all usages.
2. **Identify the target enabled-state color.** Match whatever color standard the rest of the app's icons use — look at how non-AI `btn-icon` elements render in enabled state (likely `text-gray-600` or similar, not `text-gray-300`). Pick a single token and apply it consistently. Keep the hover-state transition.
3. **Preserve disabled-state styling.** Disabled sparkles stay the current faded light-gray so the affordance for "something's missing" remains visible.
4. **Apply the change.** Replace `text-gray-300` (or whatever the current enabled color is) with the standard color on every identified sparkle usage. Keep the `opacity-40` / `disabled:` modifiers where they exist.
5. **Visual check.** Start `frontend/` dev server (per CLAUDE.md UI-change rule) and verify each sparkle renders visibly in each state:
   - Enabled, default: clearly visible.
   - Enabled, hover: existing hover styling still works.
   - Disabled: light-gray, visibly different.
   - In-flight (spinner): existing spinner styling still works.

**Testing strategy**

- No new unit tests — this is visual styling.
- Existing component tests that assert on presence of the sparkle button should still pass (color isn't in test assertions).
- Agent must explicitly report what they tested in the browser. The project memory requires it ("for UI or frontend changes, start the dev server and use the feature in a browser before reporting the task as complete").

**Scope note**

This milestone is cross-cutting by design — the user flagged that the issue applies to *all* AI sparkle icons, not just the prompt argument ones. Don't narrow scope during implementation. If the sparkle-icon audit reveals inconsistencies beyond color (e.g. differing sizes, differing hover styles, differing disabled treatments), **ask** before expanding scope further — color-only was the explicit ask.

---

## Out of scope

- **Rate-limit bucket changes.** Both endpoints stay on `AIUseCase.SUGGESTIONS` / `AI_PLATFORM` (+ `AI_BYOK`). No bucket split.
- **Prompt-builder refactoring beyond what's described.** System/user prompt *text* follows the existing style. Only the dispatch structure changes.
- **Other UX changes to `ArgumentsBuilder`** beyond the per-row sparkle redesign and the icon color fix (e.g. row reordering, inline validation rework). Keep scope tight.

---

## Decisions locked in

1. **Single shared response model.** `SuggestPromptArgumentsResponse` is used by both endpoints. N-vs-1 semantic lives in router docstrings.
2. **Empty `arguments` on singular endpoint → 422** via `field_validator`, matching `SuggestMetadataRequest.fields`. Service-level 400 remains only for in-bounds-index-exceeds-length.
3. **`prompt_content` required and non-empty on plural endpoint** (`min_length=1, max_length=50_000`).
4. **`prompt_content` on singular: `Field(None, min_length=1, ...)`.** `None` valid; `""` rejected.
5. **Grounding-signal rules enforced at schema** via `model_validator`, `target_fields`-aware (opposite-field OR template for each requested field; both-fields case requires template).
6. **Naming: `/ai/suggest-prompt-argument-fields`** (plural `-fields` at the end). Body's `target_fields` list matches the URL; disambiguates from `/ai/suggest-prompt-arguments` by the final word, not a trailing `s`.
7. **Rename + semantic split + UX redesign land together** in one deploy. Pre-GA, no external callers; bundled per project owner direction.
8. **Schema-boundary 422s bypass `apply_ai_rate_limit`.** Consistent with FastAPI dependency ordering and with every other 422 on every AI endpoint. Malformed requests not consuming quota is considered correct — quota represents LLM-call budget, and no LLM call happens for a 422.
9. **Bounds-check asymmetry is intentional.** `target_index < 0` → 422 (Pydantic `ge=0`); `target_index >= len(arguments)` → 400 (service-level `ValueError` preserving the convention for semantic validation the shape can't detect). Do not unify during this split.
10. **`target_fields` supports 1 or 2 elements** (list, unique, from `{"name", "description"}`). Two-element form is required for the per-row-sparkle UX (both-blank-with-template click). We explicitly deferred this earlier; the UX redesign produced the concrete caller.
11. **Per-row sparkle, not per-field.** `ArgumentsBuilder` renders exactly one sparkle per row, placed to the right of "Required." Old per-field sparkles (inside the name and description inputs) are removed.
12. **Serialization: one per-row call at a time.** While a per-row sparkle request is in flight, all other per-row sparkles on the same prompt are disabled. Prevents in-flight races where two parallel requests both pick the same unclaimed placeholder. Generate-all's existing in-flight gate follows the same pattern.
13. **No regenerate-one-field-without-clearing affordance.** Under the per-row sparkle UX, "suggest" only fills blank fields. To regenerate a populated field, the user clears it first and clicks the sparkle. The discoverability loss is acceptable — the previous per-field sparkles accomplished this, but the new mental model ("click to fill blanks") is cleaner overall. The `target_fields`-driven overwrite capability still exists server-side (explicit-opt-in regression test remains) for programmatic callers.
14. **AI sparkle icon color fix is cross-cutting** (Milestone 6). Not narrowed to prompt arguments. All AI sparkles across the app get the same treatment in this plan.
15. **Generate-all and per-row suggestions are mutually exclusive while in flight.** Per-row sparkles are disabled while generate-all is in flight (existing behavior); generate-all is disabled while any per-row suggestion is in flight (new). Implemented via the existing shared `requestIdRef` pattern (last-write-wins stale-response discard) **plus** hard button-disable gating on both directions. Two-layer defense: hard gating prevents the race from occurring in normal use; `requestIdRef` protects corner cases (fast double-clicks, cancellation, future methods) where the gate could in theory be bypassed.
16. **`target_fields` is canonicalized to `["name", "description"]` order at the schema layer.** Input accepted in any order; stored and echoed back in canonical order. Reduces incidental noise in logs, test fixtures, and eval results. Single-element lists are unaffected.
17. **Whitespace-only string inputs are normalized at the schema boundary.** `mode="before"` field validators strip `ArgumentInput.name`, `ArgumentInput.description`, and both endpoints' `prompt_content`. Whitespace-only becomes `None` (or triggers `min_length=1` rejection on the plural endpoint where `prompt_content` is required). Downstream consumers (prompt builder, LLM call, logs, tests, evals) never see leading/trailing whitespace or whitespace-only strings — single canonicalization point. Frontend's `.trim()` in `ArgumentsBuilder` stays as a UX nicety for instant button-enable feedback, but the backend is the source of truth and the frontend does NOT need to pre-strip before sending.
18. **Per-row identity guard via stable row IDs is deferred.** The blank-check in the integration patch logic (name/description only patched if still blank at resolution time; `required` only applied in the two-field case if the row is still observably blank) protects against all index-shift scenarios that produce user-visible wrong behavior. The remaining theoretical scenario — response lands on a different but observably identical blank row after a reorder — is indistinguishable from the correct outcome in the resulting UI state. Adding stable row IDs for a stricter identity guard is meaningful plumbing creep (ID generation, threading through every arguments mutation, maintenance across reorder/add/remove). If stable row IDs become needed for other reasons (undo/redo, per-row history, collaborative editing), adopt them comprehensively at that point.

Common thread: validate aggressively at the schema, keep the service focused on real LLM logic, make caller intent explicit everywhere, and don't land a contract change without fixing the corresponding UX.
