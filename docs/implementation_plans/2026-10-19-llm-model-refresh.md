# LLM model refresh: LiteLLM 1.106.0, current-generation models, per-model request settings

One pull request refreshes the backend's LLM layer: it upgrades LiteLLM (the Python library the backend calls LLM providers through) from 1.83.0 to 1.106.0, moves every model the product uses or offers to the current generation, teaches the backend to send each model only the request settings that model accepts, fixes two gaps found along the way (provider outages shown as plain 500s, and users stranded on a retired model), and re-runs the AI suggestion evals.

Why now: the platform default for AI suggestions, `openai/gpt-5.4-nano`, shuts down on 2027-04-01 ([OpenAI deprecations](https://developers.openai.com/api/docs/deprecations)). Its replacement, and every other current OpenAI and Claude model, rejects the request the backend sends today: all of them refuse a temperature other than 1, and the GPT-6 models need a reasoning-effort setting. On LiteLLM 1.83.0 the providers return 400; on 1.106.0 LiteLLM refuses the call before it leaves the server. Either way, swapping the model ID alone breaks suggestions.

## How to read this plan

Each milestone has three parts. "Goal and outcome" is for the approver, who knows the product but not the code: confirm the outcomes are the right ones. "Implementation outline" and "Definition of done" are for the implementer, a coding agent that reads the code but was not in the discussion. The outline states only the decisions the code cannot recover; naming, local structure, and style follow the surrounding code.

Terms used throughout:

- **BYOK** (bring your own key): a user pastes their own OpenAI, Anthropic, or Google API key on the Settings AI page and may then pick any model from the allowlist. Without a key, the user is on the platform path and gets the platform default model.
- **The allowlist**: `_SUPPORTED_MODEL_DEFS` in `backend/src/services/llm_service.py`, the seven models a BYOK user may choose. It exists to stop a caller from routing the server's request to an arbitrary endpoint (LiteLLM treats the model string as a routing directive).
- **The settings table**: the new per-model table of request settings this plan adds (milestone 2).
- **The price list**: the JSON file LiteLLM uses for per-token prices and model capabilities. LiteLLM ships a copy inside the package and, by default, downloads a newer copy from GitHub every time it is imported.

## Decided

A decision by the user or the briefer is not changed without asking. New evidence against one is reported in the PR, not acted on.

### By the user

1. **One pull request.** Milestones are review and commit units inside it.
2. **Adopt LiteLLM 1.106.0 now**, with no cooldown wait. (The release is one day old and, like every release since 1.84.0, has no PyPI provenance record. The user accepted this.)
3. **Platform default for suggestions: `openai/gpt-6-luna` with reasoning effort `none`.** Tag suggestions run while the user waits, so speed matters and reasoning is not needed.
4. **BYOK OpenAI models: `openai/gpt-6-luna`, `openai/gpt-6.1-sol`, `openai/gpt-6-astra`**, replacing `gpt-5.4-nano`, `gpt-5.4-mini`, `gpt-5.4`.
5. **BYOK Anthropic models: `anthropic/claude-haiku-5-5`, `anthropic/claude-sonnet-5-5`, `anthropic/claude-opus-5-5`**, replacing `claude-haiku-4-5`, `claude-sonnet-4-6`, `claude-opus-4-6`.
6. **A BYOK user whose stored model is no longer offered keeps working, by a plain dict lookup: every retired OpenAI ID maps to `openai/gpt-6-luna`; each retired Anthropic ID maps to the matching Claude 5.5 model; `gemini/gemini-flash-lite-latest` maps to `gemini/gemini-3.5-flash-lite`.** The user's instruction, after reviewer-opus showed that a same-tier mapping would have raised cost per token 2 to 4× for users who had picked `gpt-5.4-mini` or `gpt-5.4`: "I don't care. I don't want any logic for this that misses edge cases etc, just simple." So: no tier logic, nothing beyond the dict and its drift tests. The Google line is the briefer's extension, kept because a Google key sent to the OpenAI default fails.
7. **Provider 5xx errors become the 503 `llm_unavailable` response the docs promise**, not a plain 500.
8. **Run the suggestion evals as part of this work.**
9. **LiteLLM's runtime downloads from GitHub stay on, as today** (the price list at import, the Anthropic beta-header file at the first Claude request). Decided on the briefer's recommendation. Reasons: LiteLLM's docs present `LITELLM_LOCAL_MODEL_COST_MAP` as an option for firewalled setups ("you will need to upgrade to get updated pricing, and newer models"), not as production advice ([LiteLLM token usage](https://docs.litellm.ai/docs/completion/token_usage)); the download has been on since the project adopted LiteLLM, with no known incident; the demonstrated risk needs a bad change in LiteLLM's repository that affects our exact models; and guarding against it would add an import-order rule, guard tests, and a LiteLLM upgrade (or a `litellm.register_model` entry) for every new model. The risk and its switch are recorded under known limitations.
10. **Settings AI page provider confusion is out of scope**: a user with an Anthropic or Google key who leaves the model on the OpenAI default gets "API key rejected by provider". Decided on the briefer's recommendation; recorded under known limitations with the one-line fix.
11. **Fixing the Settings AI page after a remap is out of scope.** Decided on the briefer's recommendation; recorded under known limitations, where the fix is "show the replacement", never "clear".
12. **The MCP tool evals stay on `gpt-4o-mini` and `claude-haiku-4-5` in this PR; moving them is a separate PR off `main` after this refresh merges.** The user's words, following investigate-mcp-evals' recommendation: "option 2, keep sik_llms for the MCP connection, run all four models once, no pass bar, own PR after the refresh merges." The follow-up is recorded under known limitations. The deadline is OpenAI's 2027-01-14 shutdown of `gpt-4o-mini`.

### By the briefer

1. **Pin `litellm==1.106.0`** in both places in `pyproject.toml` (`dependencies` and the `dev` group) and drop the `!=1.82.7,!=1.82.8` exclusions, which an exact pin makes redundant. Reason: an application upgrades deliberately. Evidence: `uv.lock` records a sha256 per wheel and sdist, and `Dockerfile.api` installs with `uv sync --locked`, so production gets exactly the locked files.
2. **Per-model request settings live in a table keyed by model ID in `llm_service.py`**, applied by both `complete()` and `stream()`, replacing `_TEMPERATURE_1_ONLY_MODELS`. Chosen over LiteLLM's `drop_params` option, which can only remove parameters: in testing it silently turned reasoning on for Luna (55 to 59 reasoning tokens per call) and Haiku 5.5 (183 to 375), and it takes its decisions from the price list's flags rather than from reviewed code. Every table entry is one verified on 1.106.0 (appendix). The rationale goes into a code comment on the table.
3. **Claude Haiku 5.5 runs with thinking disabled**, for the same reason as the user's item 3. Evidence: 0.85 to 1.57 s and $0.00013 per call with thinking disabled, against 2.0 to 2.8 s and up to $0.00023 with its default thinking (157 to 205 reasoning tokens).
4. **Gemini: pin `gemini/gemini-3.5-flash-lite` wherever `gemini-flash-lite-latest` is used**, and stop sending it a temperature. The alias serves 3.5 Flash-Lite today (investigate-models read `modelVersion` from a live reply) but Google may move it with two weeks' notice. Google ignores temperature on 3.5 Flash-Lite, and LiteLLM 1.106.0 logs a WARNING per call when one is sent (observed). Gemini Flash and Pro stay out of the allowlist: status quo, the 503 history in `evals/LEARNINGS.md`, and no stable Pro model exists.
5. **Transform and auto-complete defaults move to `gemini/gemini-3.5-flash-lite`; the chat default moves from `openai/gpt-5.4-mini` to its tier successor `openai/gpt-6.1-sol`.** None of the three use cases is wired to a feature yet. The chat choice is minor and is flagged to the user here.
6. **How the fallback map is applied: in the backend, before the allowlist check, never crossing providers.** The values are the user's (user's item 6). Applying it in `resolve_config` covers old browser tabs and API callers. Every replacement is itself on the allowlist, which keeps the allowlist's routing protection. Crossing providers would send the user's key to the wrong provider, and the stored model's prefix is the only record of which provider issued the key, which is why the Google line exists.
7. **Suggestion eval models: `gpt-5.4-nano` and `claude-haiku-4-5` as baselines, plus `gpt-6-luna` (effort none), `gemini-3.5-flash-lite`, and `claude-haiku-5-5` (thinking disabled). The judge stays `openai/gpt-5.4-mini`** so score changes come from the models. Run the five per-suite make targets separately (the Makefile comment at line 125 explains: one pytest process with this many calls exhausts file descriptors on macOS). Expected spend about $3 per full run (investigate-models' estimate from the April and May result files, repriced at current list prices).
8. **The eval models get the same request settings as production.** The eval path must go through the settings table.
9. **Eval gate: per suite, pool every sample across test cases; if `gpt-6-luna`'s pooled pass rate trails `gpt-5.4-nano`'s by more than 5 percentage points on any suite, the implementer stops and reports the numbers to the user before changing the platform default.** It does not tune prompts or pick another model on its own. The briefer set the 5-point margin after reviewer-opus showed that a per-test-case comparison is too noisy: the suites have 6 to 11 test cases, a case passes only at 8 of 10 samples, so two equally good models would differ on at least one suite about 73% of the time (binomial estimate). Pooling gives 60 to 110 samples per suite. The per-case table stays in the report.
10. MCP tool evals: out of scope for this PR (user's item 12).
11. **The LLM smoke test (`backend/tests/integration/test_llm_smoke.py`) must pass for every model in the new allowlist.** It calls each at temperature 0, so it also proves the settings table.
12. **Rewrite, don't delete, the two tests of the `o4-mini` temperature rule** so they test the settings table. Change the tests asserting seven allowlisted models only if the count changes (it does not: seven out, seven in).
13. **Docs to update** are listed in milestone 5. The privacy policy needs no change because the default provider stays OpenAI.

Settled by the briefer after the two plan reviews:

14. **The `LLM_MODEL_*` variables: the user looked in Railway and does not see `LLM_MODEL_SUGGESTIONS` on the api service.** That is the user's observation, recorded as such. `README_DEPLOY.md` states the rule (the code defaults apply unless these are set), not a current state. After deploy, a read-only check confirms the Settings AI page shows `openai/gpt-6-luna` as the Suggestions default with no key entered (see "After deploy").
15. **An offline test that every allowlist ID and every `llm_model_*` code default has a settings-table entry, and that every default is on the allowlist.** An empty entry `{}` means "verified to accept the caller's temperature". Reason: CI skips the live smoke test (no provider keys), so without this the next model added without settings passes CI and fails in production.
16. **Log lines carry their IDs inline in the message** (`"byok_model_remapped from=%s to=%s use_case=%s"`), checked in the API's stdout. The API's log format prints only `%(message)s` (`core/logging_config.py:68`), so `extra={...}` fields never reach Railway.
17. **In the evals, cost per call is the signal that the settings table was applied, and the judge's cost is computed separately from its tokens.** `suggest_*` returns only the result and the cost, so a recorded `request_settings` can only be derived by calling the helper again and cannot fail if `complete()` bypassed the table.
18. **A key-check-shaped smoke case for all seven allowlisted models** (`max_tokens=5`, temperature 0, no response format), because the Settings page's "Test connection" makes exactly that call and the appendix ran it only for Luna and Haiku 5.5.
19. **The 503 mapping is not visible to web users.** The frontend handles no `llm_unavailable` code: its AI error toast special-cases only `llm_timeout` (`frontend/src/hooks/aiErrorToast.ts:33`), and its request layer only `llm_rate_limited`, with a "provider is busy" toast (`frontend/src/services/api.tsx:264`). The change matters for API callers, the documented contract, and logs.
20. **Provider errors that carry an HTTP status are mapped by one handler on `openai.APIStatusError`, by status band, including the 4xx bands: 5xx → 503 `llm_unavailable`; 401 and 403 → 422 `llm_auth_failed`; every other 4xx → 400 `llm_bad_request`.** The user asked the briefer to decide between this (reviewer-fable's proposal, the plan writer's pick) and handlers on the three concrete 5xx classes (reviewer-opus's preference); the briefer accepted the band handler with the 4xx bands. The reasoning is under the plan writer's item 2. Item 21 replaces the registration on `openai.APIStatusError`.

Settled by the briefer after the milestone 1 review:

21. **Every provider error is mapped by its HTTP status, whatever class LiteLLM raised, by one handler on `openai.APIError`: 401 and 403 → 422 `llm_auth_failed`; 429 → 429 `llm_rate_limited`; 408 or 504 → 504 `llm_timeout`; any other 4xx → 400 `llm_bad_request`; any other 5xx or no status → 503 `llm_unavailable`.** The class-based rate-limit, timeout, and connection handlers stay; the authentication, bad-request, and LiteLLM `APIError` handlers are removed. `POST /ai/validate-key` treats any 401 or 403 as a rejected key, read from one shared constant. Reason: the review found that LiteLLM 1.106.0 picks the class from the provider's error body as well as its status. An OpenAI 403 arrives as `APIError`, `BadRequestError`, or `NotFoundError` depending on the body, so the class-based handlers answered one refusal with 503, 400, or 422, and the key check reported a rejected key for none of them (verified by faking OpenAI's replies and letting LiteLLM translate them). This departs from milestone 1's first instruction to keep every existing handler. The 504 in the timeout branch was added after the second milestone 1 review round, on the reviewers' finding that a provider 504 under any class other than `Timeout` answered 503; the briefer accepted it. One exception to "by its HTTP status", found by the whole-milestone review and recorded under known limitations: LiteLLM turns any provider error whose text mentions rate limiting into a 429 before the status can be read.
22. **When the server's own key is refused (platform path, no `X-LLM-Api-Key` header), the API keeps answering 422 `llm_auth_failed` in this PR.** The handler's log line records whether the caller sent a key (never the key itself), so operators can tell an outage of the server's key from a user's bad key. Answering 503 instead is recorded under known limitations.
23. **On `POST /ai/validate-key`, a provider 404 stays 400 ("Connection failed" on the Settings page), not a rejected key**, because a 404 can mean the provider doesn't recognize the model while the key is fine.

### By the plan writer

1. **Milestone order: the evals (milestone 3) run before the model swap (milestone 4).** The gate must run before the default changes, and the evals need only the settings table, not the allowlist.
2. **Why the band handler (decided by the briefer, item 20).** Item 21 replaced this design after the milestone 1 review: one handler on `openai.APIError` maps by status alone, and only the rate-limit, timeout, and connection handlers remain. What follows is the reasoning for the first design, kept as the record. reviewer-fable proposed it; reviewer-opus preferred handlers on the three concrete 5xx classes, because a handler on `APIStatusError` also catches the 403, 404, and 422 classes. The band handler catches them on purpose and maps them: it makes the documented "other → 503" true for every 5xx class LiteLLM has or adds (it added `PaymentRequiredError` this cycle), it closes the three 4xx gaps that would otherwise stay a known limitation, and it is the same size as three class handlers. Starlette walks the exception's MRO, so the existing specific handlers (401, 429, 400, timeout, connection) still win. The cost is that `api/main.py` imports `openai`, today only LiteLLM's dependency, so `pyproject.toml` declares it (`openai>=2.20.0,<3`, LiteLLM's own constraint; the locked 2.21.0 does not move).
3. **The retired-model map lives next to the allowlist in `llm_service.py` and logs each remap at INFO** with the IDs inline in the message (from, to, use case; never the key), so operators can see when an entry can be dropped.
4. **Eval results record the request settings the helper produces for the model**, not the YAML's informational `temperature: 0.7`. The eval viewer tolerates a null temperature (`evals/viewer/server/routes/runs.ts:83`, `RunDetail.tsx:61`). The record is derived (briefer's item 17); cost per call is the check.
5. **The settings table has no `o4-mini` entry.** The model shuts down 2026-10-23 and was never on the allowlist.
6. **Two drift tests**: every settings-table key and every retired-map key carries a known provider prefix, and every retired-map value is on the allowlist with the same prefix as its key.
7. **A changelog entry and one line in `AGENTS.md`**, per the "Files to keep in sync" section of `AGENTS.md`.

## Read before starting

The implementer reads these before writing code:

- [OpenAI deprecations](https://developers.openai.com/api/docs/deprecations) and [OpenAI models](https://developers.openai.com/api/docs/models): shutdown dates, and which models accept temperature and which reasoning efforts.
- [Anthropic model deprecations](https://platform.claude.com/docs/en/about-claude/model-deprecations): retirement notices for the 4.x models.
- [Gemini models](https://ai.google.dev/gemini-api/docs/models): alias policy and the temperature deprecation on 3.5.
- [LiteLLM release notes](https://docs.litellm.ai/release_notes), especially v1.94.0 (Claude native structured output), v1.98.0 (Haiku 4.5 flagged native), v1.100.0 (`default_reasoning_effort` gates temperature), v1.102.0 (price-list fetch), v1.106.0rc1 (`PaymentRequiredError`).
- [LiteLLM token usage](https://docs.litellm.ai/docs/completion/token_usage): how the price list is fetched, and what `LITELLM_LOCAL_MODEL_COST_MAP` does (the opt-out the user decided not to use, user's item 9).
- [LiteLLM security update, March 2026](https://docs.litellm.ai/blog/security-update-march-2026): why `1.82.7` and `1.82.8` were excluded (malicious releases) and what changed in LiteLLM's release process.
- In the repo: `docs/architecture.md` §7, `evals/LEARNINGS.md`, `evals/README.md`, `backend/src/services/llm_service.py`, `backend/src/services/suggestion_service.py`, `backend/src/api/main.py` (exception handlers), `backend/src/api/routers/ai.py`.

## What is true today

Each claim says how it was checked. "Ran" means a command was run on 2026-10-19 in this worktree; "read" means source was read.

- **LiteLLM 1.106.0 passes everything with today's seven models.** Ran `make backend-verify` with 1.106.0 installed: `3463 passed, 1 warning` (the warning is a pydantic `UserWarning` from LiteLLM's own types, harmless). Ran the smoke test: `7 passed`. The lock change is nine packages: litellm, aiohttp, pydantic-settings, python-dotenv, yarl upgraded; boto3, botocore, jmespath, s3transfer added.
- **Today's code refuses every new model before sending anything.** Ran the real tag-suggestion path (`suggest_tags` → `LLMService.complete`, 15 s timeout, no retries, temperature 0.7) on 1.106.0: `openai/gpt-6-luna`, `anthropic/claude-haiku-5-5`, `claude-sonnet-5-5`, and `claude-opus-5-5` all raised `litellm.UnsupportedParamsError` locally. Our API maps that to 400 `llm_bad_request`. The BYOK key check (`POST /ai/validate-key`, which calls `complete()` with temperature 0 and `max_tokens=5`) fails the same way, so a user cannot even validate a key for these models.
- **With the right settings, every target model works through the real path and records a nonzero cost.** (The test forced the bundled price list; the downloaded list has the same prices for these models.) Appendix A has the settings, latencies, and costs. Every OpenAI call went to Chat Completions, none to the Responses API (captured request URLs). Claude 5.5 calls use Anthropic's native structured output.
- **The bundled 1.106.0 price list contains every target model** (`gpt-6-luna`, `gpt-6.1-sol`, `gpt-6-astra`, `claude-haiku-5-5`, `claude-sonnet-5-5`, `claude-opus-5-5`, `gemini/gemini-3.5-flash-lite`) with prices and capability flags, and for these models it matches today's downloaded list field for field. Ran a lookup against `litellm.model_cost` with the download turned off for the check, then compared against the live download. With the download on, as decided, production uses the downloaded list and the bundled copy is the fallback when the fetch fails. The 1.83.0 bundled copy lacks all seven, so on 1.83.0 a failed fetch drops their prices; on 1.106.0 it does not.
- **The downloaded price list changes request behavior, not only prices.** Ran 1.106.0 against a locally served copy with three flags edited: every `gpt-5.4-nano` and `claude-haiku-5-5` call was refused before sending. The flags LiteLLM 1.106.0 reads: `default_reasoning_effort` (GPT-5/6 temperature), `supports_native_structured_output` and `supports_forced_tool_use` (Claude's structured-output mode), `supports_sampling_params` (Claude temperature), `mode` (Responses API routing).
- **Startup timing under price-list failure** (ran `import litellm` against local servers, same on both versions): GitHub reachable 1.0 s; host unreachable 6.0 s then the bundled copy; HTTP 503 1.0 s then the bundled copy; a host sending one byte every 4 s still blocked after 75 s. httpx's 5 s timeout is per read, not per download.
- **Provider 5xx errors reach API callers as a plain 500.** LiteLLM's `ServiceUnavailableError`, `InternalServerError`, and `BadGatewayError` subclass `openai.APIStatusError`, not LiteLLM's `APIError`, so none of the six handlers in `api/main.py` catches them (ran an `issubclass` check; ran a fake provider returning 503 and observed `ServiceUnavailableError` raised). The same is true of `NotFoundError`, `PermissionDeniedError`, and `UnprocessableEntityError`. `docs/architecture.md:370` promises "other → 503". During testing, `gpt-6-astra` returned two real OpenAI 500s in one run and succeeded minutes later.
- **The web UI does not distinguish `llm_unavailable` from any other failure.** `grep` of `frontend/src` finds no handling of that code; the error toast special-cases only `llm_timeout` (`hooks/aiErrorToast.ts:33`), the request layer special-cases only `llm_rate_limited` (`services/api.tsx:264`), and a failed tag suggestion is logged to the console (`hooks/useTagSuggestions.ts:112`, reviewer-opus). So the 503 mapping changes what API callers and logs see, not what web users see.
- **The API's log format prints only the message.** `core/logging_config.py:68` formats `%(asctime)s - %(name)s - %(levelname)s - %(message)s`; fields passed as `extra={...}` (the pattern `llm_service.py:118` and the existing LLM handlers use) never reach stdout. Pytest's log capture does see them, so a unit test cannot catch the gap.
- **LiteLLM downloads a second file from GitHub `main` at the first Claude request in each process**: `anthropic_beta_headers_config.json`, with a 5-second timeout. Every Claude call that uses native structured output adds the header `anthropic-beta: structured-outputs-2025-11-13`, and LiteLLM filters that header through the downloaded file; a null entry strips it (reviewer-opus, from the 1.106.0 source: `llms/anthropic/chat/transformation.py:1932-1936`, `llms/anthropic/chat/handler.py:378`, `anthropic_beta_headers_manager.py:137,178`; the code is the same on 1.83.0). `LITELLM_LOCAL_ANTHROPIC_BETA_HEADERS=True` is the only off switch (variable name confirmed in the installed copy, line 142).
- **A failed price-list fetch at startup is retried in a background thread**, which swaps the downloaded list into the running process on success (`get_model_cost_map.py`, `_retry_remote_fetch_in_background` → `adopt_model_cost_map`, read in the 1.106.0 source). So the list can change mid-process, not only at a restart.
- **Eval result files carry per-case sample counts.** Each file's `metadata._test_results.per_test_case` is a list of `{id, passed, failed, total, rate}`, one per test case (read from the latest file in `evals/ai_suggestions/results/`). The pooled pass rate for a suite is the sum of `passed` over the sum of `total`.
- **The user's observation:** the Railway api service shows no `LLM_MODEL_SUGGESTIONS` variable, so the code default applies in production. The other three `LLM_MODEL_*` names were not reported either way.
- **Retries and timeouts are unchanged by the upgrade.** Fake-provider runs on both versions: `timeout=2` raised `Timeout` at 2.0 s; `num_retries=1` made two attempts for OpenAI and one for Anthropic (a LiteLLM quirk, not changed here).
- **Nothing in production code hardcodes model IDs outside the backend.** `grep` for the current IDs across `docs/*.md`, `README.md`, `frontend/src/content`, and `frontend/public` matches only `docs/architecture.md`. The frontend reads models from `/ai/models`. Frontend tests use fixture IDs.
- **The BYOK model choice lives only in the browser** (`frontend/src/stores/aiStore.ts`, local storage key `ai-config`), and picking the default stores `null`, so only users who picked a non-default model hold an ID that can go stale (read by investigate-models).
- **`sik_llms` 0.3.33 rejects the new model names before any request.** Ran `create_client(...)` offline for `gpt-6-luna` and `claude-haiku-5-5`: `ValueError: Model '...' is not supported.` Its OpenAI tool client drops temperature for models its table marks `supports_temperature=False` (`gpt-5.1`) and sends it otherwise (`gpt-4o-mini`); its Anthropic tool client sends the temperature regardless of that flag (investigate-mcp-evals patched a Haiku 5.5 entry marked `supports_temperature=False` into 0.3.33 offline, and the client still sent `temperature: 0.5`). PyPI's latest release is 0.3.33 (2026-02-23).
- **`sik_llms` clients never see the settings table.** The MCP evals build their own clients in `evals/utils.py`, so nothing in this plan changes what they send (relevant to the MCP evals, user's item 12).

## Conventions every milestone follows

**Settings table contract** (milestone 2 establishes it, every later milestone reuses it). One module-level dict in `llm_service.py`, keyed by provider-prefixed model ID. The key `omit_temperature: True` means the caller's temperature is not sent. Every other key is passed to `acompletion` unchanged. A model with no entry gets the caller's temperature and nothing else. Every allowlisted model and every `llm_model_*` code default must have an entry; `{}` means "verified by the smoke test to accept the caller's temperature", and an offline test enforces this so CI (which has no provider keys) catches a model added without settings. One helper turns `(model, temperature)` into the kwargs to send, and `complete()` and `stream()` both call it. Nothing else decides per-model parameters.

**New log lines put what an operator needs in the message itself** (`"byok_model_remapped from=%s to=%s use_case=%s"`, the pattern at `core/auth.py:251`), not in `extra=`, because only `%(message)s` reaches Railway. The rule covers lines added in this PR; existing `extra=` lines stay as they are (known limitation).

**Retired-model map** (milestone 4). One module-level dict in `llm_service.py` from retired ID to current ID, applied inside `resolve_config` before the allowlist check, BYOK path only.

**Tests** go where the existing ones for the same code live: `backend/tests/services/test_llm_service.py` for the service, `backend/tests/api/test_ai.py` for the router and the exception handlers, `backend/tests/integration/test_llm_smoke.py` for live calls.

**Rationale survives into code.** The table, the map, and the new handler each carry a comment or docstring that says why, in the form the file already uses (the file's existing section comments are the model).

**Prove it works.** Before calling a milestone done, check the real result, not a proxy:

- Run the feature the way a user would and look at what it does: a real suggestion request, a real `/ai/models` response, a real log line.
- Check side effects too (the cost written to Redis, the log line emitted), not only the response.
- Read the actual value, not a cached or derived copy.
- A new test counts only after it has been seen to fail on a known-bad input. Each milestone names the known-bad input.
- A check of new behavior says what wrong result it would catch, and its expected value comes from the spec or a known input, not from the output under test. For behavior that must stay the same (the seven current models on 1.106.0), the earlier output is the expected value.
- Keep the command and the lines that show its result in the PR description so a reviewer can see them. The smoke test and the evals need provider keys from the repo-root `.env`, which CI does not have; CI skips the smoke test, so the implementer runs it locally and pastes the result lines.
- Spend is real: the smoke test costs well under a cent per run; a full eval run is about $3. Report the actual totals from the result files.

## Milestone 1: upgrade LiteLLM, map provider status errors by band

### Goal and outcome

Move the backend onto LiteLLM 1.106.0 with today's seven models still working, and close one gap that exists independently of the model refresh. After this milestone:

- Production runs LiteLLM 1.106.0, pinned exactly, with no change to the LLM service's behavior (it gains only the shared constant `LLM_KEY_REJECTED_STATUSES`) and all 3,463 backend tests and the 7-model smoke test passing.
- The 14 published advisories against LiteLLM 1.83.0 (all in its proxy server, which we don't run) and 27 against the aiohttp version it pinned are gone from `pip-audit`.
- A provider outage (an OpenAI 500, an Anthropic 503) reaches API callers as 503 with `error_code: llm_unavailable`, and a provider 403, 404, or 422 as a typed 4xx, instead of an untyped 500. The web UI's message does not change (it has no handling for these codes); the change is visible to callers of `/ai/*` outside the web app, in the documented contract, and in logs, where the failure is a WARNING line with the code instead of an unhandled-exception traceback.
- A key the provider rejects with 403 (for example, a key without permission for the chosen model) makes the Settings page's key check report "API key rejected by provider" (200 `{"valid": false}`), as its docs say, instead of a generic failure.

### Implementation outline

**Upgrade.** In `pyproject.toml`, both `litellm` lines become `litellm==1.106.0`. Run `uv lock` then `uv sync`. Expect the nine-package lock diff listed under "What is true today"; anything else needs a look. `litellm` now depends on `boto3`, `pydantic-settings>=2.14.1`, `aiohttp>=3.14.2`; none of these needs our code to change. Behavior changes that matter and need no code (verified in "What is true today"): Claude Haiku 4.5 switches from tool-call emulation to Anthropic's native structured output (Sonnet and Opus 4.6 already used it); a provider 402 now raises `PaymentRequiredError`, a `BadRequestError` subclass, so it becomes our 400; importing LiteLLM attaches credential-redaction filters to the `httpx`, `uvicorn.access`, and `uvicorn.error` loggers (turn off with `LITELLM_DISABLE_REDACT_SECRETS=true` if it ever masks something it shouldn't). The pytest `filterwarnings` entry for `Logging.async_success_handler` stays.

**Runtime downloads stay on** (user's item 9). LiteLLM keeps fetching the price list from GitHub at import and the Anthropic beta-header file at the first Claude request, as today; there is nothing to configure. One thing improves with the upgrade: when the price-list fetch fails, LiteLLM falls back to the copy bundled in the package, and the 1.106.0 copy contains every model in this plan, so a failed fetch no longer drops their prices as it would on 1.83.0.

**Provider status mapping** (briefer's item 21). In `api/main.py`, register one handler on `openai.APIError`, the base class of every LiteLLM provider error, that reads the exception's status and returns: 401 and 403 → 422 `llm_auth_failed`; 429 → 429 `llm_rate_limited`; 408 or 504 → 504 `llm_timeout`; any other 4xx → 400 `llm_bad_request`; any other 5xx or no status → 503 `llm_unavailable`. Keep the class-based handlers for `RateLimitError`, `Timeout`, and `APIConnectionError`: Starlette walks the exception's MRO, so they still win for their classes. Remove the `AuthenticationError`, `BadRequestError`, and LiteLLM `APIError` handlers; the status gives the same answer for every error they handled correctly (`AuthenticationError` is 401; the locally raised `UnsupportedParamsError` and `ContextWindowExceededError` are 400; `PaymentRequiredError` is 402). This departs from the first version of this milestone, which kept every existing handler and registered the new one on `openai.APIStatusError`. The review found that LiteLLM picks the class from the provider's error body as well as its status (an OpenAI 403 arrives as `APIError`, `BadRequestError`, or `NotFoundError`), so class-based handlers gave one refusal three different answers. Declare `openai>=2.20.0,<3` in `pyproject.toml` `dependencies` (LiteLLM's own constraint; `uv lock` keeps 2.21.0), because the module imports it directly. The handler logs one WARNING with its fields in the message: `"llm_provider_status code=%s status=%s class=%s model=%s byok=%s"`. `code` is the error code returned, so Railway searches for `llm_auth_failed` and the other codes keep working. `byok` is whether the request carried an `X-LLM-Api-Key` header, never its value. The line never includes the provider's error text, which can echo part of the key. The handler's docstring says why it maps by status.

**Key-check endpoint.** `POST /ai/validate-key` turns a refused key into 200 `{"valid": false, "error": "API key rejected by provider"}`; its docs say a provider auth failure there is a 200, and that its 422 means request validation only. It catches `openai.APIError`, treats any status in `LLM_KEY_REJECTED_STATUSES` (401 and 403, in `services/llm_service.py`, shared with the status handler) as a rejected key, and re-raises everything else to the app's handlers. Catching by class (`AuthenticationError`, `PermissionDeniedError`) missed every OpenAI 403.

### Definition of done

Tests to write:

- `test_ai.py::TestLLMExceptionHandlers::test_maps_by_status_not_class`: the status handler called directly, one row per status and class, including LiteLLM's `APIError` carrying 403, 409, 429, 408, and 504, a `BadRequestError` carrying 401, a `NotFoundError` carrying 403, and a plain `openai.APIError` with no status. On 1.106.0, `PermissionDeniedError` and `UnprocessableEntityError` require a real response that has a request (`httpx.Response(403, request=httpx.Request("POST", "https://example"))`).
- `test_ai.py::TestProviderErrorsThroughLiteLLM`: fakes the provider's HTTP reply with `respx` and lets LiteLLM's own error translation pick the class, through `POST /ai/suggest-tags` and `POST /ai/validate-key`: OpenAI 403 in four body shapes, 401 in two, 404, 409, 500, and 503; Anthropic 403 and 529; Gemini bad key, 403, and 503. The Gemini bad-key row uses Google's real reply (HTTP 400, "API key not valid"), captured with a made-up key: LiteLLM turns it into `AuthenticationError`, whose own default status (401) is what makes it a rejected key, so the row catches a LiteLLM upgrade that copies Google's 400 instead. Tests that build LiteLLM exceptions by hand encode an assumption about which class LiteLLM raises; these don't. The fixture switches LiteLLM to its httpx transport (respx cannot see the default aiohttp transport), flushes LiteLLM's client cache, and loads the bundled Anthropic beta-header file, restoring LiteLLM's module-level cache of it afterwards so the live smoke test later in the session still loads the downloaded copy. Every test asserts that its fake route was called. Known-bad input: against the first version of the handler, the OpenAI 403 rows return 503 or 400 on suggestions, and 503, 400, or 422 on the key check.
- Precedence proof: with a 429 branch in the status handler, `test_rate_limit_propagates_to_global_handler` no longer distinguishes the two handlers. `test_class_handlers_still_win` (a real 429 and a real 504 through LiteLLM's translation, asserting the response and that the class handler, not the status handler, logged it) and `test_connection_error_through_app_returns_502` (hand-built, because LiteLLM 1.106.0 translates a refused connection into `InternalServerError`) are the proof. Known-bad input: with the three class handlers unregistered, the connection error comes back as 503, and the 429 and the 504 are logged by the status handler (whose responses for those two statuses are the same).
- No-leak: a plain marker word in the provider's error text (not a key-shaped string, which LiteLLM masks on some loggers) must not appear in the response body or in any record from `FIRST_PARTY_LOGGERS`, formatted message or `extra=` fields. Known-bad input: appending `str(exc)` to the handler's log call.
- `test_ai.py`: `POST /ai/validate-key` with a key and `services.llm_service.acompletion` patched to raise `PermissionDeniedError` (constructed as above) returns 200 with `valid` false and the "rejected" error text. Known-bad input: before the `except` change, the same request returns 422.
- `test_ai.py`: an integration test that patches `services.llm_service.acompletion` to raise `ServiceUnavailableError` and POSTs a suggestion endpoint, asserting 503 and `error_code == "llm_unavailable"`. Known-bad input: run it before registering the handler; it must not pass (the exception escapes or a 500 comes back).

Checks on the real thing:

- `make backend-verify`: lint clean and `3463 passed` (plus any tests added here). Paste the summary line.
- `PYTHONPATH=backend/src uv run --env-file .env pytest backend/tests/integration/test_llm_smoke.py -v`: `7 passed`, one line per model. Paste them.
- `uv run pip-audit | grep -E "^(litellm|aiohttp) "`: no rows. The overall audit stays red for other packages (known limitation).
- Status mapping: with the API running, point one request at a fake provider that returns 503 (the `api_base` can only be set through code, so a two-line temporary patch or a test is acceptable), and see the 503 `llm_unavailable` response and, in the API's stdout, the WARNING line carrying `status=503`.

Docs in this milestone: none beyond code comments. Milestone 5 updates `architecture.md`.

Known limitations recorded: `make dependency-audit` stays red; the runtime downloads from GitHub stay on (see "Known limitations"); the three remaining class-based LLM handlers (rate limit, timeout, connection) log the provider error in `extra=`, so their error text does not reach Railway (pre-existing, out of scope; the fix is to log the status and error type in the message, never the provider's error text, which can echo part of the key); a server-key refusal answers 422 (briefer's item 22); an unreachable OpenAI or Anthropic answers 503, not 502 (see "Known limitations").

## Milestone 2: per-model request settings table

### Goal and outcome

Give the backend one place that says, per model, what request settings to send, so that current-generation models work and adding a model later means adding one line. After this milestone:

- `LLMService.complete()` and `stream()` send `gpt-6-luna` a reasoning effort of `none` with the caller's temperature; send `gpt-6.1-sol` and `gpt-6-astra` reasoning effort `low` and no temperature; send the three Claude 5.5 models no temperature and tell Haiku 5.5 not to think; send Gemini 3.5 Flash-Lite no temperature.
- Models not in the table behave exactly as today (the caller's temperature is sent).
- The BYOK key check (`POST /ai/validate-key`, `max_tokens=5`, temperature 0, no response format) goes through `complete()`, so it gets the same settings with no code change of its own. Verified live for Luna and Haiku 5.5; the other five are proven by the key-check smoke case in milestone 4.
- The two `o4-mini` tests now test the table.

Nothing visible to users changes in this milestone, because the new models are not yet on the allowlist or in the defaults.

### Implementation outline

Replace `_TEMPERATURE_1_ONLY_MODELS` and `_normalize_temperature` with the table and a helper. The entries are the contract; the names are the implementer's:

```python
_MODEL_REQUEST_SETTINGS: dict[str, dict] = {
    # Temperature is accepted only when reasoning effort is "none".
    "openai/gpt-6-luna": {"reasoning_effort": "none"},
    # No "none" effort level exists, so temperature must be omitted.
    "openai/gpt-6.1-sol": {"omit_temperature": True, "reasoning_effort": "low"},
    "openai/gpt-6-astra": {"omit_temperature": True, "reasoning_effort": "low"},
    # Claude 5.5 rejects any temperature other than 1. Haiku thinks by default.
    "anthropic/claude-haiku-5-5": {"omit_temperature": True, "thinking": {"type": "disabled"}},
    "anthropic/claude-sonnet-5-5": {"omit_temperature": True},
    "anthropic/claude-opus-5-5": {"omit_temperature": True},
    # Google ignores temperature on 3.5 and LiteLLM warns on every call that sends one.
    "gemini/gemini-3.5-flash-lite": {"omit_temperature": True},
}
```

At this milestone the allowlist and the `llm_model_*` defaults still name today's seven models, so each of those gets a `{}` entry (verified by the 1.106.0 smoke run to accept the caller's temperature); milestone 4 removes them with the swap. The table's comment states the rationale from the briefer's item 2 (why a table and not `drop_params`), the meaning of `{}`, and the rule that every entry is verified by the smoke test. The helper is public (no leading underscore) because the evals import it in milestone 3 to record what the table says for a model. `complete()` replaces its `"temperature": _normalize_temperature(...)` entry with the helper's kwargs; `stream()` does the same (today it sends the caller's temperature with no adjustment at all, and the chat feature, when it ships, would fail on every model in this table).

One combination in the table was not run in testing: Luna with temperature 0 and effort `none` (the smoke test's and key check's settings). OpenAI's rule allows it, and the smoke test in milestone 4 proves it. Every other entry's exact combination was run (appendix A).

### Definition of done

Tests to write, in `test_llm_service.py`:

- Helper: an unlisted model keeps the caller's temperature and gets no other keys; each table entry produces the kwargs above (Luna keeps the temperature; Sol omits it and adds `reasoning_effort="low"`; Haiku 5.5 omits it and adds `thinking={"type": "disabled"}`; Gemini omits it). Expected values come from this plan's table, not from the code.
- `complete()` and `stream()` each apply the helper: mock `acompletion` and assert the kwargs for one table model and one unlisted model. The `stream()` test is the known-bad proof for the existing gap: write it before touching `stream()` and watch it fail.
- Drift: every table key starts with one of the prefixes in `_PROVIDER_KEY_MAP`. Known-bad input: a key without a prefix fails it.
- Coverage (briefer's item 15): every ID in `_SUPPORTED_MODEL_DEFS` and every `llm_model_*` code default is a key in the table, and every default is on the allowlist. Read the defaults from `Settings.model_fields[...].default`, not from a `Settings()` instance, so a developer's `.env` override cannot change the result. Known-bad input: temporarily remove one allowlisted model's entry; the test must name the missing ID.
- Rewrite `test_o_series_temperature_normalized` and `TestNormalizeTemperature` as tests of the helper (briefer's item 12).

Checks on the real thing:

- `make backend-verify` green.
- Run one real call per table entry through `LLMService.complete()` with the tag-suggestion prompt (the appendix's harness did exactly this; reproducing it costs about two cents) and confirm each returns parsed tags and a nonzero cost. This is the only direct proof before milestone 4's smoke test that the table matches what the providers accept.
- Update the comment at `test_llm_smoke.py:77-81` to name the table.

## Milestone 3: suggestion evals with the new models

### Goal and outcome

Measure whether the new budget models suggest as well as the ones they replace, before the platform default changes. After this milestone:

- Each of the five suggestion suites (tags, metadata, relationships, prompt arguments, prompt argument fields) has result files for five models: the two baselines `gpt-5.4-nano` and `claude-haiku-4-5`, and the candidates `gpt-6-luna`, `gemini-3.5-flash-lite`, `claude-haiku-5-5`.
- Each result file shows the request settings that were sent, so a reader can tell Luna ran at effort `none` and Haiku 5.5 with thinking off.
- The gate has a verdict: either Luna's pooled pass rate is within 5 points of nano's on every suite, or the implementer has stopped and reported the numbers.

### Implementation outline

**Configs.** In each `evals/ai_suggestions/config_suggest_*.yaml`, the `models:` list becomes the five models above. `gemini/gemini-flash-lite-latest` is replaced by the pinned ID (same model today). `judge_model` stays `openai/gpt-5.4-mini`. The judge in `helpers.py` calls `acompletion` directly at temperature 0; that is fine for `gpt-5.4-mini` (its default effort is `none`). If the judge ever moves to a GPT-6 model it must go through the settings-table helper; add that sentence to the helper's docstring.

**Settings pass-through.** The five suites call the service functions (`suggest_tags` and friends), which call `complete()`, so the table applies with no wiring. What needs changing is the recorded output: each suite's test returns `"temperature": temperature` taken from the YAML. Replace it with what the settings helper produces for the model: keep the `temperature` key (the number, or `null` when omitted; the viewer tolerates null) and add a `request_settings` dict with the full kwargs. This record is derived by calling the helper from the test, because `suggest_*` returns only the result and the cost; it documents the run but cannot detect a bypassed table. The check that can is cost per call (next paragraph). The YAML `temperature` field becomes the requested value only.

**Bypass check.** From appendix A, Luna costs about $0.000071 per tag-suggestion call at effort `none` and about $0.0001 when it reasons; Haiku 5.5 costs about $0.00013 with thinking off and $0.00021 to $0.00023 with it on. After the first suite, compute each model's mean cost per call from the result file. A Luna mean near $0.0001 or a Haiku 5.5 mean near $0.0002 means reasoning was on and the table was bypassed; stop and find out why before running the other suites. (The tag prompt is the appendix's reference; other suites have different prompt sizes, so compare each model's mean against the pattern, not the exact number.)

**Running.** The suites need only the keys in the repo-root `.env`; no servers. Run the tags suite first and open its result file to confirm `model_name`, `request_settings`, and a nonzero `total_cost` for each model before starting the other four. Then run `make evals-ai-suggestions-metadata`, `-relationships`, `-prompt-arguments`, `-prompt-argument-fields`, one at a time, never the combined `evals-ai-suggestions` target.

**Gate** (briefer's item 9). Per suite and model, the pooled pass rate is the sum of `passed` over the sum of `total` across `metadata._test_results.per_test_case` in the result file (60 to 110 samples per suite). If Luna's pooled pass rate is more than 5 percentage points below nano's on any suite, stop, and report to the user, before touching `llm_model_suggestions` in milestone 4, a table with, per suite and model: pooled pass rate, test cases passing the 0.8 threshold out of total, p95 latency, and mean cost per call (all from the result files). Do not tune prompts, change samples, or substitute a model. Report the same table in the PR whichever way the gate goes, and include Haiku 5.5 against Haiku 4.5 and the pinned Gemini against the May 2026 Flash-Lite results from `evals/ai_suggestions/results/` for information.

### Definition of done

- The five config files list the five models and the judge is unchanged.
- One result file per suite per run under `evals/ai_suggestions/results/`, each with `request_settings` present and `temperature` consistent with it (`null` for Haiku 5.5, Gemini; `0.7` for nano, Haiku 4.5, Luna).
- The bypass check above passed for Luna and Haiku 5.5 on every suite, with the means in the report.
- Spend, two totals: the suggestion calls, summed from `usage.total_cost` across the run's result files; and the judge, computed from the judge token counts in each result (`judge_metadata.usage`, which has tokens but no cost) at `gpt-5.4-mini`'s $0.75 / $4.50 per million tokens (LiteLLM's price list). Expect about $3 combined.
- The gate verdict and the comparison table are in the PR description and appended to this plan under a "Results" heading, following the repo's pattern of plans that record verification results (see `2026-10-02-cimd.md`).
- `make evals-*` targets lint `evals/` through `make evals`; run `uv run ruff check evals` by hand since the per-suite targets do not.

## Milestone 4: swap the models

### Goal and outcome

Put the current generation in front of users. After this milestone:

- Suggestions for platform users come from `openai/gpt-6-luna` at effort `none` (unless the gate stopped the work; then this one line waits for the user's answer, and the rest of the milestone proceeds).
- The Settings AI page's model dropdown (fed by `/ai/models`) offers `gemini/gemini-3.5-flash-lite`, `openai/gpt-6-luna`, `openai/gpt-6.1-sol`, `openai/gpt-6-astra`, `anthropic/claude-haiku-5-5`, `anthropic/claude-sonnet-5-5`, `anthropic/claude-opus-5-5`, with prices from the price list.
- A BYOK user whose browser still sends a retired ID gets the same-provider replacement and their request succeeds; a user who sends an ID that was never offered still gets 400 `Unsupported model`.
- The transform, auto-complete, and chat defaults (not yet wired to any feature) are `gemini/gemini-3.5-flash-lite`, `gemini/gemini-3.5-flash-lite`, `openai/gpt-6.1-sol`.
- The smoke test passes for all seven new models, at temperature 0, which proves the settings table against the live providers.

### Implementation outline

**Defaults** in `core/config.py:71-86`: the four `LLM_MODEL_*` defaults as listed above.

**Allowlist** in `llm_service.py:65-80`: the seven new entries, same tiers (Gemini budget; Luna, Sol, Astra as budget, balanced, flagship; Haiku, Sonnet, Opus 5.5 likewise). Keep the comment explaining why Gemini Flash and Pro are absent; the commented-out alias IDs can stay as history or be updated to what the aliases serve today (`gemini-3.8-flash`; no stable Pro), implementer's choice. The count stays seven, so `test_llm_service.py:107,138` and `test_ai.py:300` stand.

**Retired-model map**, next to the allowlist:

```python
_RETIRED_MODEL_REPLACEMENTS: dict[str, str] = {
    "openai/gpt-5.4-nano": "openai/gpt-6-luna",
    "openai/gpt-5.4-mini": "openai/gpt-6-luna",
    "openai/gpt-5.4": "openai/gpt-6-luna",
    "anthropic/claude-haiku-4-5": "anthropic/claude-haiku-5-5",
    "anthropic/claude-sonnet-4-6": "anthropic/claude-sonnet-5-5",
    "anthropic/claude-opus-4-6": "anthropic/claude-opus-5-5",
    "gemini/gemini-flash-lite-latest": "gemini/gemini-3.5-flash-lite",
}
```

The values are the user's decision (user's item 6): every retired OpenAI ID goes to Luna, with no tier logic; the map is a plain dict lookup and nothing more. `resolve_config` applies the map when `user_api_key` is present and `user_model` is a key, before the `_SUPPORTED_MODEL_IDS` check, and logs at INFO with the IDs inline in the message, `"byok_model_remapped from=%s to=%s use_case=%s"` (never the key). Not `extra={...}`: the API's format prints only the message (briefer's item 16). INFO lines reach stdout via `core/logging_config.py`. The platform path ignores `user_model` today and keeps doing so. The comment on the map carries the user's instruction (simple, all OpenAI to Luna) and the briefer's item 6: same provider, never cross providers, every value on the allowlist, and why (the prefix is the only record of the key's provider).

**OpenAPI examples** in `schemas/ai.py` at lines 192, 243, 251-254, 310-311, 345, 360, 435, 443, 563, 717, 778: nano → Luna, mini → Sol, `claude-haiku-4-5` → `claude-haiku-5-5`, `gemini-flash-lite-latest` → `gemini-3.5-flash-lite`. The `AIModelEntry` example's prices (0.05 / 0.40) match no model; use Luna's (0.10 / 0.50). The `model` field description near line 360 and the router's 400 docs near `routers/ai.py:137,399` gain one sentence: a retired ID from a previous allowlist is accepted and replaced by its current same-provider model.

**Tests that name old IDs as allowed:** `test_ai.py:218` uses `anthropic/claude-haiku-4-5` as a supported model and asserts `acompletion` received it; after the map, it would receive `claude-haiku-5-5`. Change that test to a current ID and add the remap test below. Grep the test tree for all seven retired IDs (every key of `_RETIRED_MODEL_REPLACEMENTS`, including `gemini/gemini-flash-lite-latest`) and treat each hit the same way (fixture-only uses in cost-tracking and flush tests can stay). The `TestProviderErrorsThroughLiteLLM` rows in `test_ai.py` send retired IDs and assert `model=<ID>` in the handler's log line, so after the remap they fail until they use current IDs.

### Definition of done

Tests to write:

- `test_llm_service.py`: every map key is absent from the allowlist; every map value is present; key and value share a provider prefix (known-bad input: a cross-provider pair fails it). `resolve_config(use_case, user_api_key="k", user_model="openai/gpt-5.4-nano")` returns `openai/gpt-6-luna` and emits the `byok_model_remapped` log; `user_model="evil/attacker-model"` still raises `UnsupportedModelError`; the platform path with a retired `user_model` and no key still returns the platform model.
- `test_ai.py`: `POST /ai/validate-key` with `{"model": "anthropic/claude-haiku-4-5"}` and a key returns 200 and `acompletion` was called with `anthropic/claude-haiku-5-5` and no `temperature` kwarg (this one assertion also proves the key check goes through the table).
- `test_ai.py::TestAIModels::test_defaults_match_use_cases` and `test_config.py` pass with the new defaults; if either hardcodes an old ID, update the expected value from this plan.

Checks on the real thing:

- Add a second parametrized case to `test_llm_smoke.py` that makes exactly the key check's call for every allowlisted model: `complete()` with `max_tokens=5`, temperature 0, no `response_format`, asserting only that no exception is raised (the endpoint treats anything but an authentication error as a valid key, and an empty 5-token reply is fine). reviewer-opus guesses that a 5-token cap with reasoning on (Sol, Astra at effort `low`) returns empty content; the case records what came back. Cost: well under a cent for all seven.
- `PYTHONPATH=backend/src uv run --env-file .env pytest backend/tests/integration/test_llm_smoke.py -v`: fourteen PASSED lines, seven structured-output and seven key-check, naming the seven new IDs. Paste them. This is the proof for briefer's items 11 and 18 and for the one untested Luna combination.
- `make backend-verify` green.
- With the API running in dev mode: `GET /ai/models` lists the seven IDs with nonzero prices and the four new defaults. Then one real `POST /ai/suggest-tags` on the platform path: parsed tags back, a `cost_tracking` log line, and a new `ai_stats:*` hash in Redis (`redis-cli KEYS 'ai_stats:*'`).
- One real BYOK request with a retired ID and a real key (`X-LLM-Api-Key` plus `{"model": "openai/gpt-5.4-nano"}`): a 200, and in the API's stdout (not pytest's capture) the line `byok_model_remapped from=openai/gpt-5.4-nano to=openai/gpt-6-luna use_case=suggestions` with both IDs present.

Known limitation recorded (user's item 11): after a remap, the Settings AI page still shows the retired ID in the row header, and the dropdown's `value` matches no option (what a browser renders then is unverified: reviewer-opus expects the first option, reviewer-fable expects an empty control). The fix, for a later PR, is to show the replacement: a retired → current `replacements` map in the `/ai/models` response that the page applies to the stored model on load. Never clear the stored model: clearing sends an Anthropic or Google key to the OpenAI default.

## Milestone 5: docs, env example, deploy README, changelog

### Goal and outcome

Every document that states a model, a default, the price-list behavior, or the error mapping says what the code now does. The approver can read `docs/architecture.md` §7 and see the new table of defaults, the seven models, and the exact HTTP mapping.

### Implementation outline

Rewrite each section as if fresh (current state, not history):

- `docs/architecture.md`: §2 line 172 and §3 line 189 (the suggestions default); §7 defaults table and the "7 GA models" sentence (lines 338-345); "Cost tracking" item 1 (prices come from the list LiteLLM downloads from GitHub `main` at import, with the copy bundled in the installed LiteLLM as the fallback when the fetch fails); "Errors" line 370: replace "other → 503" with the real mapping (three handlers by class: rate limit → 429 `llm_rate_limited`, timeout → 504 `llm_timeout`, connection → 502 `llm_connection_error`; then every other provider error by its HTTP status, whatever class LiteLLM raised: 401 and 403 → 422 `llm_auth_failed`, 429 → 429, 408 or 504 → 504, other 4xx → 400 `llm_bad_request`, any other 5xx or no status → 503 `llm_unavailable`; `llm_parse_failed` → 502), and say why it is by status (LiteLLM picks the class from the provider's error body too). Include the per-provider table of what an unreachable provider returns (under "Known limitations": on LiteLLM 1.106.0, OpenAI and Anthropic → 503 `llm_unavailable`, Gemini → 502 `llm_connection_error`), so nobody reads `llm_connection_error` as the answer for every unreachable provider. Also record the one exception to mapping by status: a provider error whose text mentions rate limiting answers 429 `llm_rate_limited` whatever its status (see "Known limitations"). Add to §16 "Things that are easy to miss": every allowlisted model and every `llm_model_*` default needs a settings-table entry (`{}` when the model accepts the caller's temperature), an offline test enforces it, and the smoke test at temperature 0 is what proves an entry; retired allowlist IDs go in the map, same provider only; LiteLLM downloads the price list and the Anthropic beta-header file from its GitHub `main` at runtime by decision (user's item 9), so prices and request behavior can change at a restart or mid-process without a deploy, and `LITELLM_LOCAL_MODEL_COST_MAP=True` plus `LITELLM_LOCAL_ANTHROPIC_BETA_HEADERS=True` is the switch if that ever bites; `test_all_models_have_pricing` passes for a model newer than the pinned LiteLLM only while the download works, because the bundled fallback has no price for it. Extend the §17 "Hardcoded model IDs in `schemas/ai.py`" entry to name the settings table, the map, and the eval configs as places that change with the allowlist.
- `README_DEPLOY.md:271` (the default) and the `LLM_MODEL_*` block at 287-290: state the rule, "the code defaults in `core/config.py` apply unless these are set", list the new values as the overrides available, and do not describe what is or isn't set in Railway today (briefer's item 14).
- `.env.example:87`: the comment says the suggestions default is Gemini; it is OpenAI.
- `llm_service.py:104`: "Pricing auto-updates with LiteLLM version bumps" is wrong with the download on: prices come from the list LiteLLM downloads from GitHub at import (the bundled copy is the fallback), so they can change at any restart without a version bump. Reword it to say that.
- `evals/README.md`: the model-configuration example still shows a valid model; add a short section naming the five suggestion-eval models, the judge, the per-suite targets, and the gate rule.
- `frontend/src/content/data/changelog.json`: a new month at the top (`"month": "October 2026"`, a theme, an "Improved" category) with one entry for BYOK users (the new model list; retired OpenAI picks now use GPT-6 Luna, Claude picks move to their 5.5 versions, and users can pick again in Settings) and one for the platform default. `tag: "ai"` is a valid tag (`changelog.ts` validates `web | api | cli | extension | site | performance | ai`); set `pr` once the PR number exists. `npx vitest run src/content/data/changelog.test.ts` must pass.
- `AGENTS.md`, under "Don't": one line, "Don't add a model to `_SUPPORTED_MODEL_DEFS` without checking whether it needs a `_MODEL_REQUEST_SETTINGS` entry; run the LLM smoke test."
- Privacy: no change. The "AI Features" section and the provider list name providers and data categories, not models, and the default provider stays OpenAI (`privacy.md:88-90`). State in the PR that this was checked.
- This plan: append the "Results" section from milestone 3.

### Definition of done

- `make frontend-verify` green (the changelog test).
- Each updated document reread cold once: no "no longer", "changed from", or "instead of".
- The PR description follows the four headings in the technical-writing skill (Summary, Changes, Impact) and pastes the smoke-test lines, the verify summary, the eval table, and the total spend.

## After deploy

One read-only check in production, because every other check in this plan runs locally and the PR's main goal (platform suggestions off `gpt-5.4-nano`) would fail silently if a Railway variable overrode the new default: open Settings AI with no key entered and confirm the Suggestions row shows `openai/gpt-6-luna` as the default (the page shows `defaults.suggestions` from the live `/ai/models` response). Then make one real tag suggestion and confirm it returns. Paste both observations in the PR after the deploy. If the row shows another model, an `LLM_MODEL_SUGGESTIONS` variable is set on the api service; report it, don't change it.

## Known limitations

Recorded, not fixed, in this PR:

- `make dependency-audit` stays red. After the upgrade `pip-audit` reports 266 known vulnerabilities in 31 packages (down from 344 in 35), none in `litellm` or `aiohttp`; the rest are in pypdf, pyjwt, starlette, cryptography, and others.
- Unverified suspicion: `Dockerfile.api`'s `CMD uv run uvicorn ...` may sync the `dev` dependency group at container boot. Not checked against Railway's boot logs.
- Settings AI page: the provider of a model is not shown, and an Anthropic or Google key left on the OpenAI default model fails with "API key rejected by provider" (out of scope, user's item 10). The backend picks the provider from the model prefix and never looks at the key, so the key is sent to the wrong provider. One-line fix: on the Settings page, pick the model list's first entry for the key's provider, or show a hint next to the key field.
- Settings AI page after a remap (out of scope, user's item 11): shows the retired ID until the user re-picks. The fix is to show the replacement (a retired → current map in the `/ai/models` response, applied by the page to the stored model on load), never to clear the stored model, because clearing sends an Anthropic or Google key to the OpenAI default (milestone 4).
- The web UI shows the same generic message for every provider failure; the typed codes (`llm_unavailable`, `llm_auth_failed`, `llm_bad_request`) are visible only in logs and to callers of `/ai/*` outside the web app. Those are few: neither MCP server calls `/ai/*`, and `/ai/*` refuses personal access tokens (`core/auth.py`, `get_current_user_ai`), so only someone calling it directly with a Clerk session or OAuth token sees them. One-line fix per code in `frontend/src/hooks/aiErrorToast.ts`, where `llm_timeout` is already special-cased (the request layer in `services/api.tsx` also special-cases `llm_rate_limited`).
- The API's `extra={...}` log fields never reach Railway (format prints only the message). The rate-limit, timeout, connection, and parse-failed handlers and the `llm_service.py` logs use `extra=`. The remap log and the status handler added in this PR put their fields in the message; the existing lines are out of scope. The fix for each handler is to log the status and error type in the message, never the provider's error text: providers can echo part of the key in it, and the Settings page promises the key is never logged.
- When the server's own key is refused (platform path, no `X-LLM-Api-Key` header), callers get 422 `llm_auth_failed`, "LLM authentication failed. Check your API key.", though they sent no key (briefer's item 22). Web users see the same generic failure message either way; callers of `/ai/*` outside the web app see a misleading message (few exist: no MCP server calls `/ai/*`, and it refuses personal access tokens), and the outage counts as a 4xx, not a 5xx. The handler's log line shows `byok=False` for it. Fix: in `api/main.py`'s status handler, answer 503 `llm_unavailable` for 401 and 403 when the request has no `X-LLM-Api-Key` header.
- An unreachable provider gets 503 `llm_unavailable` for OpenAI and Anthropic, and 502 `llm_connection_error` only for Gemini. LiteLLM 1.106.0 reports a connection failure to OpenAI or Anthropic as `InternalServerError` (status 500), and to Gemini as `APIConnectionError`:

  | Provider unreachable | LiteLLM 1.106.0 raises | API answers | How it was checked |
  |---|---|---|---|
  | OpenAI | `InternalServerError` (500) | 503 `llm_unavailable` | Refused connection on both the aiohttp and httpx transports (implementer); dropped connection and DNS failure (reviewer-opus) |
  | Anthropic | `InternalServerError` (500) | 503 `llm_unavailable` | Same as OpenAI |
  | Gemini | `APIConnectionError` | 502 `llm_connection_error` | Refused connection on both transports (implementer) and on the default transport (reviewer-opus); dropped connection and DNS failure not checked |

  Under the handlers before milestone 1, an `InternalServerError` was an unhandled 500 (what LiteLLM 1.83.0 raised for a connection failure was not checked). Both 502 and 503 are documented as retryable, and the API docs say some providers' connection failures arrive as 503, so callers lose nothing actionable. The connection handler stays for Gemini. Recovering 502 for the other two would mean reading LiteLLM's internal error chain.
- A provider error whose text mentions rate limiting ("rate limit", "rate-limit", or "rate_limit") answers 429 `llm_rate_limited` whatever the provider's real status, so the status mapping (briefer's item 21) does not apply to it. LiteLLM checks the error text before the status and raises `RateLimitError` with status 429, discarding the real one; it does this on purpose (its code comment cites its issue #11455), and 1.83.0 does the same, so this predates the branch. Verified offline on 1.106.0 with faked OpenAI replies: a 403 "Your organization's rate limit tier does not include this model" and a 400 "Invalid prompt: contains 'API rate-limiting best practices'" both arrive as `RateLimitError` (429). A web user then sees "The AI provider is busy right now. Please try again in a moment." for a request that will never succeed, and "Test connection" answers 429 for such a 403 instead of "API key rejected by provider". The rate-limit handler logs its fields in `extra=`, so the Railway line shows `llm_rate_limited` with no status. How often a provider's 4xx text mentions rate limiting (for example by echoing prompt content back) is unverified. No code fix: the real status is discarded, so recovering it would mean reading LiteLLM's internal exception chain.
- An expired Gemini key makes "Test connection" say "Connection failed", not "API key rejected by provider", and suggestions answer 400 `llm_bad_request`. Google answers an expired key with HTTP 400 ("API key expired", wording from memory), and LiteLLM 1.106.0 raises a plain `BadRequestError` (400) for it (verified with a faked reply), unlike an invalid key, which it recognizes by Google's message wording. The same was true before this PR. A fix would mean matching Google's message text, the coupling this PR's status mapping removed.
- When a provider refuses our server rather than the key (for example, a region block, which OpenAI answers with 403, from memory), every user sees "check your API key" at once: suggestions answer 422 `llm_auth_failed` and "Test connection" says "API key rejected by provider". The log line shows `code=llm_auth_failed status=403` for every request but cannot say why, because the provider's error text is deliberately kept out of logs (it can echo part of the key). An operator seeing this for every user at once should suspect the provider refusing the server, not a wave of bad keys.
- LiteLLM retries: `num_retries=1` makes two attempts for OpenAI and one for Anthropic on both 1.83.0 and 1.106.0. The UI paths use zero retries, so nothing changes for users.
- `gpt-6-astra` returned two OpenAI 500s in one test run (6.5 and 5.7 s) and succeeded minutes later. After milestone 1 the API returns 503 `llm_unavailable` for these and logs a WARNING; a web user still sees the generic failure message.
- `README_DEPLOY.md` states the `LLM_MODEL_*` rule, not Railway's current state. The user saw no `LLM_MODEL_SUGGESTIONS` on the api service; the other three names were not reported, and none of the three is wired to a feature yet. The "After deploy" check covers the one that matters.
- LiteLLM 1.106.0 is adopted one day after release, and releases since 1.84.0 carry no PyPI provenance record (1.83.x did). The user accepted this.
- LiteLLM downloads two files from its GitHub `main` branch at runtime, by the user's decision (item 9): the price list at import (and again in a background thread if the first fetch fails with a retryable error, swapping the list into the running process on success), and the Anthropic beta-header file at the first Claude request. Both can change request behavior, not only prices: whether a temperature is sent, which structured-output mode Claude gets, and which `anthropic-beta` header goes out. So a change merged to LiteLLM's repository can change what production sends at the next restart or mid-process, with no deploy on our side (demonstrated with a locally edited copy of the price list, see "What is true today"). Startup can also stall on a slow GitHub response: in testing, a host answering one byte every 4 seconds blocked `import litellm` past 75 seconds, and an unreachable host cost 6 seconds. The fix, if it ever bites: set `LITELLM_LOCAL_MODEL_COST_MAP=True` and `LITELLM_LOCAL_ANTHROPIC_BETA_HEADERS=True` (then prices freeze at the pinned LiteLLM, and a model newer than the pin needs a LiteLLM bump or a `litellm.register_model` entry).
- The MCP tool evals (`evals/content_mcp`, `evals/prompt_mcp`) stay on `gpt-4o-mini` and `claude-haiku-4-5` in this PR (user's item 12). They call models through the `sik_llms` library, version 0.3.33 (installed, and the latest on PyPI, 2026-02-23), whose hardcoded model tables end at `gpt-5.2`/`o4-mini` and `claude-opus-4-6`/`claude-haiku-4-5`: its tool-calling clients raise `ValueError: Model '...' is not supported.` for `gpt-6-luna` and `claude-haiku-5-5` before any request, and its Anthropic tool client sends the YAML temperature regardless of its table's flag, which Haiku 5.5 rejects (appendix B). **Decided follow-up (the user):** a separate PR off `main`, after this refresh merges and before 2027-01-14. `get_tool_predictions` in `evals/utils.py` calls LiteLLM, using this plan's settings helper and keeping the same return shape; `MCPClientManager` from `sik_llms` stays for the MCP connection and tool list; the four YAML configs get provider-prefixed IDs. The first run covers four models, `gpt-4o-mini` and `claude-haiku-4-5` through the new path plus `gpt-6-luna` and `claude-haiku-5-5`, so the measuring-code change is separated from the model change; then the old two come out of the configs. No pass bar: report the pooled pass rate per suite and model beside the April 2026 baseline. Facts it depends on: it needs LiteLLM 1.106.0 and the settings table (1.83.0 refuses `reasoning_effort` for Luna and `thinking` for Haiku 5.5, and has no price for either); Luna needs reasoning effort `none` for tool calls through Chat Completions (OpenAI's gpt-6-luna page), which the table supplies; GPT-6 Sol and Astra are not in the follow-up's model list, and whether they support Chat Completions tool calls is unverified (OpenAI's model pages say no; LiteLLM 1.106.0's bundled price list marks both `supports_function_calling: true` and `supports_tool_choice: true` with `/v1/chat/completions` supported); the evals need the API on port 8000 and the MCP servers on 8001 and 8002; a four-model run costs about $1.60 (investigate-mcp-evals' estimate).

## Appendix A: verified request settings, LiteLLM 1.106.0, bundled price list

Each row is two calls through `suggest_tags` → `LLMService.complete()` with the production settings (structured output, 15 s timeout, no retries), the first tag-eval case, and `LITELLM_LOCAL_MODEL_COST_MAP=True` (the bundled list was forced for the test; the downloaded list carries the same prices and flags for these models), run on 2026-10-19. "Refused" means LiteLLM raised `UnsupportedParamsError` locally. Every OK row returned parsed tags and recorded the cost shown from the bundled price list. Total spend for all runs: $0.051.

| Model | Settings sent | Result | Cost per call | Latency (two calls) |
|---|---|---|---|---|
| gpt-5.4-nano (control) | temp 0.7 | OK | $0.00015 | 1.47 s, 0.71 s |
| gpt-6-luna | temp 0.7 (today) | refused | | |
| gpt-6-luna | effort none, temp 0.7 (table entry) | OK, 0 reasoning tokens, Chat Completions | $0.000071 | 1.74 s, 0.96 s |
| gpt-6-luna | effort none, no temp | OK | $0.000071 | 1.35 s, 1.21 s |
| gpt-6-luna | no temp, default effort | OK, 67 and 36 reasoning tokens | $0.00011, $0.000092 | 1.61 s, 2.07 s |
| gpt-6-luna | temp 0.7 with `drop_params` | OK, temperature silently dropped, 59 and 55 reasoning tokens | $0.00010 | 1.95 s, 2.11 s |
| gpt-6.1-sol | no temp, effort low (table entry) | OK, 0 reasoning tokens | $0.0014 | 1.85 s, 1.75 s |
| gpt-6-astra | no temp, effort low (table entry) | first run: OpenAI 500 twice; rerun: OK | $0.0071 | 7.62 s, 1.74 s |
| claude-haiku-5-5 | temp 0.7 (today) | refused | | |
| claude-haiku-5-5 | no temp | OK, native structured output, thinks by default (157 and 205 reasoning tokens) | $0.00021, $0.00023 | 2.82 s, 2.01 s |
| claude-haiku-5-5 | no temp, thinking disabled (table entry) | OK, 0 reasoning tokens | $0.00013 | 1.57 s, 0.85 s |
| claude-haiku-5-5 | no temp, effort low | OK, 0 reasoning tokens | $0.00013 | 2.03 s, 0.94 s |
| claude-sonnet-5-5 | no temp (table entry) | OK, native structured output | $0.0026 | 1.23 s, 1.12 s |
| claude-opus-5-5 | no temp (table entry) | OK, native structured output | $0.0051 | 1.06 s, 1.07 s |
| gemini-3.5-flash-lite | temp 0.7 | OK, one LiteLLM WARNING per call | $0.00028 | 0.82 s, 0.73 s |
| gemini-3.5-flash-lite | no temp (table entry) | OK, no WARNING (LiteLLM sends temperature 1.0 itself) | $0.00028 | 1.01 s, 0.87 s |
| Key check, luna | temp 0, max_tokens 5 (today) | refused | | |
| Key check, luna | effort none, no temp, max_tokens 5 | OK, reply `ok` | under $0.00001 | 1.03 s |
| Key check, haiku-5-5 | no temp, max_tokens 5 | OK, reply `ok` | under $0.00001 | 0.60 s |

Two calls per row is a rough latency signal, not a benchmark. The eval result files in milestone 3 give p95 over 440 samples per model.

## Appendix B: `sik_llms` 0.3.33 offline check (MCP tool evals, user's item 12)

Constructed tool-calling clients with `temperature=0.5` and one dummy tool, no network:

```
OPENAI_TOOLS     gpt-4o-mini        -> client built; request params sent: {'temperature': 0.5}
OPENAI_TOOLS     gpt-5.1            -> client built; request params sent: {}
OPENAI_TOOLS     gpt-6-luna         -> ValueError: Model 'gpt-6-luna' is not supported.
ANTHROPIC_TOOLS  claude-haiku-4-5   -> client built; request params sent: {'temperature': 0.5}
ANTHROPIC_TOOLS  claude-haiku-5-5   -> ValueError: Model 'claude-haiku-5-5' is not supported.
```

The OpenAI rows show the table's `supports_temperature` flag at work (`gpt-5.1` drops the temperature). The Anthropic tool client does not consult that flag: with a Haiku 5.5 entry marked `supports_temperature=False` patched into 0.3.33, it still sent `{'temperature': 0.5, 'max_tokens': 8000, 'tool_choice': {'type': 'any'}}` (investigate-mcp-evals, offline). So for Anthropic the unknown name is not the only blocker; the temperature would be rejected as well. The follow-up under known limitations replaces this call path with LiteLLM and keeps `sik_llms` only for the MCP connection.
