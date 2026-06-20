# Implementation Plan: Sandbox Jinja2 Prompt-Template Rendering

**Branch:** `security/sandbox-template-rendering`
**Severity:** Critical — authenticated server-side template injection (SSTI) leading to arbitrary code execution.

## Background

Prompt `content` is a **user-authored Jinja2 template** that the backend renders server-side. Today that rendering uses a plain `jinja2.Environment`, which does **not** restrict attribute access. Because Jinja2 exposes the underlying Python object graph through attribute traversal, a plain environment lets a template author walk from an ordinary value to arbitrary Python objects — the classic SSTI escape. A plain environment is **not** a security boundary for untrusted template input; only `jinja2.sandbox.SandboxedEnvironment` is.

The only gate before rendering is `validate_template` (`backend/src/services/prompt_service.py`), which checks (a) Jinja2 **syntax** and (b) that every undeclared variable name used in the template is also declared in the prompt's `arguments`. It performs **no** restriction on attribute access, so it is not a mitigation for this issue. (See "Correct the misleading validation docstrings" below — its docstrings currently overstate what it does, which is part of why this gap persisted.)

This is reachable by any authenticated user (including Personal Access Tokens), operating only on **their own** prompt, via:

- `POST /prompts/{prompt_id}/render` — `backend/src/api/routers/prompts.py` (`render_prompt`)
- the Prompt MCP server render path — `backend/src/prompt_mcp_server/server.py` (`render_template` call)

Both call the same `render_template(...)` in `backend/src/services/template_renderer.py`, so fixing the renderer fixes both surfaces.

## Approach: render in a `SandboxedEnvironment`

Replace the plain `jinja2.Environment` used for **rendering** with `jinja2.sandbox.SandboxedEnvironment`. The sandbox overrides attribute/item access and raises `jinja2.exceptions.SecurityError` when a template tries to reach unsafe attributes (the dunder/private attribute traversal that SSTI relies on). This is the **load-bearing fix** — validation tweaks and AST checks are not a substitute for it.

Keep `undefined=StrictUndefined` exactly as today; the sandbox is orthogonal to undefined-variable handling and the existing argument-defaulting behavior must not change.

### Which environments change

There are two `Environment()` instances in play; they are **not** equivalent and the plan treats them differently:

1. **`backend/src/services/template_renderer.py` — the render environment.** This is the one that calls `.render(...)`. **This is the security-critical change.** Switch it to `SandboxedEnvironment(undefined=StrictUndefined)`.
2. **`backend/src/services/prompt_service.py` — the validation environment.** This instance is used only for `.parse()` + `meta.find_undeclared_variables()`. It **never renders**, so it is not itself an execution vector. Switch it to `SandboxedEnvironment` too **for consistency and to prevent future misuse** (so nobody later calls `.render()` on the "validation" env assuming it's safe), but record in the PR description that this one is hardening-for-consistency, not the load-bearing change. Parsing/meta-analysis behavior is unaffected by the sandbox.

### `SandboxedEnvironment` vs `ImmutableSandboxedEnvironment`

`SandboxedEnvironment` blocks unsafe attribute access (the escape). `ImmutableSandboxedEnvironment` additionally forbids calling mutating methods (`list.append`, `dict.update`, etc.). For prompt templates — which are overwhelmingly `{{ variable }}` substitution plus simple `{% if %}`/`{% for %}` — `ImmutableSandboxedEnvironment` is the stricter, defensible default and is unlikely to break legitimate prompts. **Recommendation:** start with `SandboxedEnvironment` (the minimal change that closes the vulnerability), and raise `ImmutableSandboxedEnvironment` as a follow-up question in review. Decide explicitly; don't pick silently.

### Error handling (do not skip — this affects API behavior)

`render_template` today catches `TemplateSyntaxError` and `UndefinedError` and re-raises them as `TemplateError` (which the router maps to **HTTP 400**). A sandbox violation raises `jinja2.exceptions.SecurityError`, which is **not** currently caught — so without a change it would surface as an uncaught **500**. Add `SecurityError` to the caught set and re-raise as `TemplateError`, so a malicious/blocked template is reported as a client error (400 / MCP invalid-params), consistent with the other template failures. Use a clear, non-leaky message (e.g. "Template uses a disallowed operation.") — do not echo the offending expression back.

## Reference Documentation

The implementing agent **must** read these before writing code:

- [Jinja2 Sandbox docs](https://jinja.palletsprojects.com/en/stable/sandbox/) — `SandboxedEnvironment`, `ImmutableSandboxedEnvironment`, `is_safe_attribute`/`is_safe_callable`, and `SecurityError`.
- [Jinja2 API — `StrictUndefined`](https://jinja.palletsprojects.com/en/stable/api/#undefined-types) — confirm sandbox composes with the existing undefined handling.
- In-repo, study first:
  - `backend/src/services/template_renderer.py` — the render path (`render_template`, the module-level env, the existing `try/except`).
  - `backend/src/services/prompt_service.py` — the validation env + `validate_template` and its docstrings.
  - `backend/src/api/routers/prompts.py` (`render_prompt`) and `backend/src/prompt_mcp_server/server.py` (render call) — the two reachable surfaces; confirm both route through `render_template`.
  - `backend/tests/services/test_template_renderer.py` — existing behavior tests (incl. `{% if %}`/`{% else %}` control flow) that must continue to pass unchanged.

## Agent Behavior Rules

- **Complete each milestone fully (implementation + tests) before moving on.** Stop for human review at each milestone boundary.
- **Ask, don't guess** — especially on the `SandboxedEnvironment` vs `ImmutableSandboxedEnvironment` decision and on the exact user-facing error message.
- **Never weaken, skip, or delete a test to make the suite pass.** If an existing prompt-rendering test breaks under the sandbox, that is a signal about legitimate template behavior — investigate and surface it, do not delete it.
- **Use scoped verify commands:** `make backend-verify`. Do not run the full `make tests`.
- **No commits or pushes without explicit human approval.** Stage and show diffs.

---

## Milestone 1 — Sandbox the render path

- In `template_renderer.py`, replace the module-level `Environment(undefined=StrictUndefined)` with `SandboxedEnvironment(undefined=StrictUndefined)`.
- Catch `jinja2.exceptions.SecurityError` in `render_template` and re-raise as `TemplateError` with a generic, non-leaky message (→ 400 / MCP invalid-params).
- **Log the block server-side** (the client message stays generic). In the new `except SecurityError` branch, before raising, emit `logger.warning("Blocked sandboxed template render: %s", e, exc_info=True)` (add a module-level `logger = logging.getLogger(__name__)` if absent). Log the **exception only**, not the prompt content — Jinja's `SecurityError` message already names the offending access (e.g. *"access to attribute '\_\_class\_\_' of 'str' object is unsafe"*), and the content is by definition attacker-or-mistake input (PII/noise risk). This mirrors the codebase's existing pattern in `decode_jwt` (`core/auth.py:124-125`): full detail server-side, generic message to the client.
- **Per-caller `prompt_id`/`user_id` logging is deliberately deferred** (not merely optional). Because the step above collapses `SecurityError` into the generic `TemplateError`, the callers (`render_prompt`, MCP handler) can no longer distinguish a *security block* from a *benign* template error (missing arg, syntax typo) — so adding IDs in their catch-blocks would WARNING-log every benign user typo with identifiers, which is noise. The WARNING at the `render_template` locus already provides a distinct "security block" signal in logs; only user/prompt *correlation* is given up. If false-positive triage later needs that correlation, the clean upgrade is a dedicated `TemplateSecurityError(TemplateError)` subclass so callers can catch it specifically and attach IDs (it still maps to 400 via the existing `except TemplateError`). **File that as a follow-up; do not fold it in now.**
- In `prompt_service.py`, switch the validation env to `SandboxedEnvironment` for consistency (mark as non-load-bearing in the PR notes).
- Confirm both reachable surfaces (`render_prompt`, MCP render) flow through the updated `render_template` — no separate env anywhere else. Grep for `Environment(` and `from_string(` / `.render(` across `backend/src` to be sure there is no third rendering site.

**Verify:** `make backend-verify`. All existing `test_template_renderer.py` and prompt tests pass unchanged (substitution, multi-var, control-flow, defaults, unknown/missing-arg errors).

## Milestone 2 — Regression tests (security)

Add tests that lock in the fix so it cannot silently regress:

- In `backend/tests/services/test_template_renderer.py` (and/or a focused test under `backend/tests/security/`): assert that rendering a template which performs **attribute traversal to escape the template context** (the standard SSTI gadget shape — reaching `__class__` / `__subclasses__` / `__globals__` off a normal value) **raises** (surfaces as `TemplateError`, not a 500, and not a rendered result). The test asserts the sandbox blocks the escape; it does **not** need to demonstrate any payload that performs a real side effect.
- Assert the block is **logged**: using `caplog`, verify a blocked render emits a WARNING (covers the server-side observability added in M1). Keep it behavioral — assert a warning is logged on block, not its exact text.
- Cover **both reachable surfaces**, not just REST:
  - REST: `POST /prompts/{id}/render` returns **400** (not 500, not a rendered escape) for such a template (`backend/tests/api/test_prompts.py`).
  - MCP: the prompt MCP render handler surfaces an `McpError` with `INVALID_PARAMS` (not an unhandled exception) for such a template — mock the prompt fetch via the existing `respx` harness (`backend/tests/prompt_mcp_server/`, pattern as in `test_mcp_protocol.py`). *Note: the MCP layer catches `TemplateError` generically, so this guards an adjacent, already-tested, unchanged translation path rather than genuinely-new behavior — it's near-free insurance because the harness exists, not risk-driven.*
- Add a "benign templates still work" assertion covering plain substitution, `{% if %}`, and `{% for %}`, to prove the sandbox didn't break legitimate prompt usage.

**Verify:** `make backend-verify`.

## Milestone 3 — Correct the misleading validation docstrings + docs sync

- **Fix the validation docstrings in `prompt_service.py`.** `validate_template`'s docstring/comments currently assert that `meta.find_undeclared_variables()` flags Jinja2 builtin globals (e.g. `range`, `cycler`, `namespace`) as undefined. In the installed Jinja2 version that is **not** true — those globals are not flagged — so the comment describes behavior the code does not have. Correct (or remove) the claim so the next reader isn't misled about what validation does or does not protect against. Validation is an argument-coverage/ergonomics check, **not** a security control — say so plainly.
- **Files-to-keep-in-sync review per AGENTS.md:** check whether the security-tests section, `docs/architecture.md` (it mentions template rendering / "Things that are easy to miss"), or any LLM-facing artifact needs a note that prompt rendering is sandboxed. Update only what genuinely changed.
- **Deployed security tests:** per AGENTS.md, after this change remind the human to run `backend/tests/security/deployed/test_live_penetration.py` against production once deployed, and consider adding an SSTI case there.

**Verify:** `make backend-verify`.

---

## Dependency assumption (conscious, worth watching)

The correctness of this fix rests on Jinja2's `SandboxedEnvironment` being a sound boundary — including against the historically-patched bypasses (`str.format`, `|attr()`, which the regression tests confirm our env blocks). That is Jinja2's maintained contract and the idiomatic choice (vs. a brittle hand-rolled AST denylist). The trade-off: if a future Jinja2 sandbox-escape CVE lands, **this is the dependency to watch**. Keep Jinja2 current so security patches flow in — do **not** pin it back.

## Out of scope

- Any change to outbound HTTP / URL handling — tracked separately, not part of this branch.
- Broader template-feature changes (custom filters, allowlists, AST-level rejection of private-attribute access). An AST check is at best secondary defense-in-depth and is brittle (filters, `|attr()`); the sandbox is the correct boundary. If raised in review, file as a follow-up rather than expanding this PR.

## Done criteria

- Render path uses a sandboxed environment; SSTI escape attempts raise and map to a 400 (and MCP invalid-params), not a 500 or a successful render.
- Blocked renders are logged server-side at WARNING (exception only, generic client message); per-caller ID logging consciously deferred to a `TemplateSecurityError` follow-up.
- All pre-existing prompt/template tests pass unchanged; new regression tests added and green (renderer-level block of dotted-access, `|attr()`, and `str.format` escapes + WARNING-logged + REST 400 + MCP `INVALID_PARAMS` + benign-templates-still-render).
- Misleading validation docstrings corrected.
- Deployed SSTI case added to `test_live_penetration.py` (inert locally; runs only against a configured prod target).
- `make backend-verify` green; human reminded to **run** the deployed pen tests against prod post-deploy.
