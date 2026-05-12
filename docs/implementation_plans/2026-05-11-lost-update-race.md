# Implementation Plan: Lost-Update Race on str-replace Endpoints (KAN-148)

**Branch:** `fix/lost-update-race`
**Ticket:** [KAN-148](https://tiddly.atlassian.net/browse/KAN-148)
**Sibling ticket closed without action:** [KAN-149](https://tiddly.atlassian.net/browse/KAN-149) — see "Scope decision" below.

## Background

This PR fixes the **lost-update race** on the three MCP str-replace endpoints (bookmarks, notes, prompts). Under Postgres's default `READ COMMITTED` isolation, the current str-replace handlers do an unprotected read-modify-write: two concurrent calls against the same entity can each read the same content, each compute a new version locally, and each write — second commit silently overwrites the first.

In practice, this rarely manifests today because end-to-end serialization (single uvicorn worker, HTTP client behavior, fast hot path) hides it. But AI agents firing parallel str-replace calls against the same entity are the realistic scenario that would surface it. The fix removes the latent risk before that becomes routine.

## Approach: server-side row locking (`SELECT … FOR UPDATE`)

str-replace is semantically **content-addressable**: the operation says "find `old_str`, replace with `new_str`." If `old_str` is still uniquely findable in the current content, the operation is safe regardless of what else changed. There's no client-side assertion about overall document state that needs validating; the existing `no_match` 400 is already the correct error signal when the operation's premise no longer holds.

That semantic points to row locking, not optimistic locking:

- **Row locking** (`SELECT … FOR UPDATE`) serializes the read-modify-write inside the database. N parallel str-replace calls against the same entity each acquire the row lock in turn, each read the **current** content, each apply their str-replace against fresh state, each commit. All N succeed on the first try (assuming their patterns still match). No round-trip retries. No agent-side timestamp tracking.
- **Optimistic locking** (`expected_updated_at` + 409) would do the opposite: all N calls start with the same timestamp, one wins, the other N-1 get 409 and have to refetch+retry serially. That breaks the parallel-edit workflow agents rely on for efficiency.

KAN-148's ticket description originally proposed optimistic locking ("Option A"). The pivot to row locking ("Option B") is documented in the [ticket's most recent comment](https://tiddly.atlassian.net/browse/KAN-148?focusedCommentId=10399).

## Scope decision: KAN-149 closed without action

KAN-149 covered the same bug class on three declarative-update endpoints (`PATCH /relationships/{id}`, `PATCH /content-filters/{id}`, `PUT /settings/sidebar`). After working through it, we closed it without action. Rationale:

- **Frequency is effectively zero at current scale.** Each of those collisions requires user-driven concurrency on a single-user product: two of the same user's devices reordering the sidebar within the same second; two browser tabs editing the same filter at the same moment; two clients editing the same relationship description simultaneously. None of these workflows are common, and sidebar/filter/relationship-description edits in particular are setup-and-forget operations.
- **Blast radius is small and recoverable.** Worst case is one device's reorder or one tab's edit doesn't stick. No data corruption, no downstream breakage; the user re-does a small action.
- **Fix surface is meaningful.** Three backend schema + handler changes, three frontend store/hook + UI changes (including a response-schema reshape for sidebar's singleton shape), plus conflict UX design for surfaces that don't currently have one. Significant work for events that may happen zero times in a year.

If product evolution introduces real multi-user collaboration on any of these surfaces (shared filters, team sidebars, etc.), the fix is straightforward to land at that point. Closed today as "won't fix at current scale" rather than left to drift in the backlog.

This plan therefore covers only the KAN-148 surface.

## Reference Documentation

The agent **must** read these before implementing:

- [PostgreSQL `SELECT ... FOR UPDATE` (locking clauses)](https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE) — row-level locking semantics.
- [PostgreSQL explicit locking — row-level locks](https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-ROWS) — interaction with READ COMMITTED, savepoint behavior.
- [SQLAlchemy 2.0 `Select.with_for_update()`](https://docs.sqlalchemy.org/en/20/core/selectable.html#sqlalchemy.sql.expression.Select.with_for_update) — how to issue `FOR UPDATE` in this codebase.
- In-repo references to study first:
  - `backend/src/api/helpers/conflict_check.py` — existing `check_optimistic_lock` / `check_optimistic_lock_by_name` helpers (kept in place; this PR is additive, not a swap).
  - `backend/src/services/base_entity_service.py:254` (`get`) — the shape the new `get_for_update(...)` method should mirror.
  - The three str-replace handlers in `backend/src/api/routers/{bookmarks,notes,prompts}.py` — the integration points.

## Agent Behavior Rules

- **Complete one milestone fully (implementation + tests + docs) before moving on.** Stop and wait for human review at each milestone boundary.
- **Ask clarifying questions** rather than guessing. Especially: prompt by-name vs. by-id str-replace endpoints, the existence of a concurrent-async-session test fixture, and the savepoint-interaction question raised in M3.
- **No backwards-compatibility shims required.** Clean design wins. Breaking internal call sites is acceptable if a cleaner interface emerges.
- **Use scoped verify commands:** `make backend-verify` for each milestone. Do not run `make tests` (full suite).
- **Never skip or weaken tests to make them pass.** If a test fails, investigate the root cause.
- **No commits without explicit human approval.** Stage and show diffs; wait for sign-off.

---

## Milestone 1 — Pre-flight Audit (Backend, Read-Only) — COMPLETE

### Goal & Outcome

Confirm the scope before changing code. Surface anything the ticket or this plan may have missed, and de-risk M2/M3 by verifying assumptions about transaction scope and test fixtures.

### Findings (recorded inline)

**1. Four str-replace endpoints, not three.** Confirmed inventory:

| Endpoint | File:Line | Lookup | Service call to swap in M3 |
|---|---|---|---|
| `PATCH /bookmarks/{id}/str-replace` | `backend/src/api/routers/bookmarks.py:457` | by id | `bookmark_service.get(..., include_archived=True)` → `get_for_update(...)` |
| `PATCH /notes/{id}/str-replace` | `backend/src/api/routers/notes.py:380` | by id | `note_service.get(..., include_archived=True)` → `get_for_update(...)` |
| `PATCH /prompts/{id}/str-replace` | `backend/src/api/routers/prompts.py:888` | by id | `prompt_service.get(..., include_archived=True)` → `get_for_update(...)` |
| `PATCH /prompts/name/{name}/str-replace` | `backend/src/api/routers/prompts.py:502` | by name | `prompt_service.get_by_name(...)` → `get_by_name_for_update(...)` |

The by-name path is the path the Prompt MCP `edit_prompt_content` tool actually hits — must be in scope.

**2. No per-entity `get(...)` overrides.** `bookmark_service.py`, `note_service.py`, `prompt_service.py` all use `BaseEntityService.get(...)` unmodified. Safe to mirror with `get_for_update(...)` on the base.

**3. Single transaction per request — confirmed.** `backend/src/db/session.py:32` wraps each request in `async with async_session_factory()` with one commit at the end. Row locks acquired in the handler are released at request commit/rollback.

**4. `expected_updated_at` callers to str-replace endpoints: zero.** Verified across frontend, CLI, Chrome extension, Content MCP, and Prompt MCP. The `check_optimistic_lock*` calls at the top of all 4 str-replace handlers are dead code today; the `expected_updated_at` field on `StrReplaceRequest` / `PromptStrReplaceRequest` is never set. Per M3.3's rule, this means **remove**. See M3 for the full cleanup.

**5. `check_optimistic_lock*` helper definitions stay.** Verified the two helpers in `backend/src/api/helpers/conflict_check.py` are also called by the regular (non-str-replace) PATCH handlers: `notes.py:364`, `bookmarks.py:431`, `prompts.py:861` use `check_optimistic_lock`; `prompts.py:470` uses `check_optimistic_lock_by_name`. M3 removes only the str-replace call sites, not the helpers.

**6. Concurrent-session test fixture does NOT exist, and the current setup actively blocks adding the obvious version.** `backend/tests/conftest.py:247` defines `db_session_factory` bound to a single `db_connection` with `join_transaction_mode="create_savepoint"`. All "concurrent" sessions share one physical connection and one outer transaction, so they cannot contend for a Postgres row lock. Adding a true concurrent fixture is scoped into M2 (see M2 implementation outline).

**7. Broader audit (declarative-replacement PATCH calls without `expected_updated_at`): no new gaps.** Frontend Prompt/Note/Bookmark editors pass `expected_updated_at` on the standard PATCH path. MCP `update_item` / `update_prompt` tools accept and forward it. No follow-up tickets needed.

### Stopping rule

No new findings to file. Audit complete.

---

## Milestone 2 — `get_for_update(...)` on `BaseEntityService` + Concurrent-Session Test Fixture (Backend)

### Goal & Outcome

Add a dedicated `get_for_update(...)` method on `BaseEntityService` and `get_by_name_for_update(...)` on `PromptService` (M1 confirmed the by-name path is in scope), so str-replace handlers can request a row lock with explicit, self-documenting intent at the call site. Also add the concurrent-session test fixture needed to exercise real Postgres lock contention.

- After this milestone, locking-intent is visible at every call site. A future read-only handler cannot accidentally hold a row lock by typo'ing a kwarg.
- After this milestone, the test suite has a reusable concurrent-session fixture that can prove cross-transaction row-lock behavior.

### Implementation Outline

#### 2a. New concurrent-session test fixture

The existing `db_session_factory` in `backend/tests/conftest.py:247` is bound to a single `db_connection` with `join_transaction_mode="create_savepoint"` — all sessions from it share one physical connection and one outer transaction, so they cannot contend for row locks. We need a separate fixture with independent connections.

Design:

- **Separate engine.** Module-scoped (or session-scoped) `create_async_engine(database_url, ...)` instance, distinct from the test-isolation engine. `pool_size` ≥ 4 (covers the max concurrent sessions any test uses, plus headroom).
- **Distinct name.** Call it `concurrent_session_factory` (and `concurrent_engine`) so its non-default semantics are obvious at the test definition site.
- **No outer-transaction wrapper.** Each session opens its own transaction; tests commit/rollback explicitly.
- **Per-test isolation via unique `user_id`.** Each concurrency test creates its own user (or uses an autouse fixture that yields a fresh UUID), seeds the entities it needs under that user_id, and runs `DELETE WHERE user_id=...` in a `finally` block. Fast, deterministic, no bleed between tests.
- **Location.** Put the fixture in a new `backend/tests/conftest_concurrent.py` or scoped under `backend/tests/services/conftest.py` — whichever fits existing conventions. Do not pollute the root `conftest.py` with a fixture only a small subset of tests uses.

#### 2b. `get_for_update(...)` on `BaseEntityService`

A separate method beats a `for_update=True` kwarg on `get(...)`: the name forces the caller to think about transaction context, matches how SQLAlchemy/Django patterns typically separate locking from plain reads, and removes the footgun of a one-character typo silently holding row locks for the request lifetime.

```python
async def get_for_update(
    self,
    db: AsyncSession,
    user_id: UUID,
    entity_id: UUID,
    *,
    include_archived: bool = False,
) -> T | None:
    """
    Fetch an entity and acquire a SELECT ... FOR UPDATE row lock.

    MUST be called inside a transaction. The lock is held until the
    transaction commits or rolls back. Use only when the same request
    will issue an UPDATE on the returned entity.
    """
    query = (
        select(self.model)
        .options(selectinload(self.model.tag_objects))
        .where(self.model.id == entity_id, self.model.user_id == user_id)
        .where(self.model.deleted_at.is_(None))
        .with_for_update()
    )
    if not include_archived:
        query = query.where(~self.model.is_archived)
    ...
```

Note the dropped `include_deleted` parameter — str-replace never operates on soft-deleted entities, so the locking path doesn't need it. Keep the API minimal; add the kwarg back only if a real caller emerges.

#### 2c. `PromptService.get_by_name_for_update(...)`

Mirror `PromptService.get_by_name(...)` (`backend/src/services/prompt_service.py:513`), but append `.with_for_update()`. Returns active prompts only (excludes deleted and archived) — same semantics as the existing `get_by_name`.

### Testing Strategy

In the appropriate per-service or `BaseEntityService` test file (match existing convention), using the new `concurrent_session_factory`:

- **Lock-blocks-write test:** Session A calls `get_for_update(...)` on a row. Session B issues an `UPDATE` on the same row. Assert B blocks until A commits/rolls back. (Use `asyncio.wait_for(..., timeout=2)` to verify B does not return immediately.)
- **Lock-blocks-lock test:** Session A calls `get_for_update(...)`. Session B calls `get_for_update(...)` on the same row. Assert B blocks until A releases.
- **Plain-get-doesn't-block test:** Session A calls `get_for_update(...)`. Session B calls plain `get(...)`. Assert B returns immediately (Postgres `FOR UPDATE` does not block plain `SELECT`).
- **Lock-released-on-commit test:** After A commits, B's blocked call unblocks and reads the post-commit state.
- **Lock-released-on-rollback test:** After A rolls back, B's blocked call unblocks and reads the pre-A state.
- **By-name lock test:** One test per the above shape (or a single parametrized test) covering `get_by_name_for_update(...)` on `PromptService`.

Avoid testing things that are Postgres's responsibility (deadlock detection, lock fairness). Test only that the wrapper correctly issues `FOR UPDATE`.

### Stop here for review.

---

## Milestone 3 — Apply Row Locking to str-replace Endpoints (Backend)

### Goal & Outcome

Close the lost-update race on the str-replace endpoints by switching their entity fetch from `service.get(...)` to `service.get_for_update(...)`. No changes to MCP tools, request schemas, or any external caller.

- After this milestone, N parallel str-replace calls to the same entity all succeed (assuming their `old_str` patterns still match in the evolving content), with no lost updates and a coherent history trail.

### Implementation Outline

For each of the 4 str-replace endpoints confirmed in M1 (`notes.py:380`, `bookmarks.py:457`, `prompts.py:888` by id, `prompts.py:502` by name):

1. Replace the entity fetch with the locking variant. Example for notes:
   ```python
   note = await note_service.get(db, current_user.id, note_id, include_archived=True)
   ```
   becomes:
   ```python
   note = await note_service.get_for_update(db, current_user.id, note_id, include_archived=True)
   ```
   For the by-name path: `prompt_service.get_by_name(...)` → `prompt_service.get_by_name_for_update(...)`.
2. Confirm the entire read-modify-write-history sequence executes inside a single transaction (the FastAPI `get_async_session` dependency ensures this — M1 confirmed).
3. **Remove the dead optimistic-lock plumbing.** M1 confirmed zero callers pass `expected_updated_at` to any str-replace endpoint. Cleanup:
   - Remove the `check_optimistic_lock(...)` call from `bookmarks.py:500`, `notes.py:423`, `prompts.py:954`.
   - Remove the `check_optimistic_lock_by_name(...)` call from `prompts.py:535`.
   - Remove the `expected_updated_at` field from `StrReplaceRequest` (used by bookmarks + notes) and `PromptStrReplaceRequest` (used by both prompt str-replace endpoints).
   - **Keep** the `check_optimistic_lock` / `check_optimistic_lock_by_name` helper definitions in `backend/src/api/helpers/conflict_check.py` — they are still used by the regular PATCH handlers (`notes.py:364`, `bookmarks.py:431`, `prompts.py:861`, `prompts.py:470`).
   - Update or remove any tests that asserted str-replace honored `expected_updated_at`. Cover the new behavior with the M3 concurrency tests below.

### Testing Strategy

Per str-replace endpoint, add a concurrency integration test:

- **Concurrent non-overlapping str-replace test:** Spawn N (e.g., 5) concurrent str-replace tasks against the same entity with distinct, non-overlapping `old_str` patterns that all exist in the original content. Await all. Assert all N return success **and** the final content reflects all N edits.
- **Concurrent overlapping str-replace test:** Two concurrent str-replace calls where one removes the substring the other is trying to match. Assert the second returns the existing `no_match` 400 (the correct conflict signal for content-addressable operations), not a silent overwrite.
- **History version-allocation test:** After concurrent edits, verify `history_service.record_action` produces exactly N UPDATE rows with unique, dense version numbers (no duplicates, no gaps). This proves the history-layer savepoint-retry loop survives contention. **Not a content-chain coherence test** — the load-bearing proof that the row lock fixed the lost-update bug on entity content is the non-overlapping test above (final content reflects all N edits). A real chain-coherence test belongs in `test_history_service.py` exercising the history service directly; out of scope for KAN-148.
- **Savepoint × row-lock primitive test (one assertion is enough):** Direct primitive test using `concurrent_session_factory`. Session A acquires `FOR UPDATE` on a seeded row, opens `db.begin_nested()`, raises inside the nested block to force a savepoint rollback, catches the error. From a *second* session, issue `SELECT ... FOR UPDATE NOWAIT` on the same row — assert it raises `DBAPIError` for `LockNotAvailableError`, proving A still holds the lock after the savepoint rollback. NOWAIT is unambiguous (it answers exactly "is the row locked right now?") and avoids the conflated implicit write lock that an "A mutates + B reads sentinel" pattern would introduce — A's `UPDATE` would itself acquire a write lock and block B regardless of whether the `FOR UPDATE` survived.

Use real Postgres (not mocks). Follow existing async test fixtures.

### Documentation Updates

- `docs/architecture.md` — add a short subsection (~10 lines) under whatever section covers the API layer or data integrity, explaining the row-locking vs. optimistic-locking choice by operation semantics. Include one note: "If FK-insert contention against locked rows ever becomes measurable, `FOR NO KEY UPDATE` (`.with_for_update(key_share=False)` in SQLAlchemy — verify the exact spelling against current docs) is a less-restrictive alternative. Not needed at current scale." Also note that Postgres savepoints do not release row locks held by the outer transaction (cite the explicit-locking docs).
- No changes to `AGENTS.md`, `README.md`, or user-facing docs — this is internal correctness.

### Stop here for review.

---

## Milestone 4 — Final Docs Pass and PR Description

### Goal & Outcome

Catch any documentation drift caused by M2/M3 and prepare the PR description.

- After this milestone, the PR is ready for human review and (after approval) commit.

### Implementation Outline

1. Re-read `AGENTS.md`'s "Files to Keep in Sync" section. Update any listed file whose content is now stale (likely only `docs/architecture.md`, already covered in M3).
2. Verify nothing else in `docs/` references the old behavior.
3. Draft the PR description with:
   - One-paragraph framing: what the bug class is, why row locking is the right defense for content-addressable operations.
   - Per-milestone summary of what shipped.
   - Verification matrix: every endpoint touched, its concurrency test.
   - **Schema change callout:** `expected_updated_at` removed from `StrReplaceRequest` and `PromptStrReplaceRequest`. M1 confirmed zero current callers, but flag it explicitly in the PR description so reviewers and downstream integrators don't miss it.
   - **Manual verification** — short checklist for the reviewer to run by hand before merging. The automated tests already cover the lock semantics, so this section is just smoke checks for things that are hard to test automatically:
     - **MCP str-replace tools (the real production callers):**
       - `edit_content` (Content MCP) against a bookmark and a note — verify the operation succeeds and content updated as expected.
       - `edit_prompt_content` (Prompt MCP) — verify success.
       - Attempt a `no_match` (target a substring that does not exist) — verify the structured 400 error still surfaces cleanly to the MCP client.
     - **Regular PATCH endpoints — no collateral damage from the schema/handler changes:**
       - Edit a bookmark, note, and prompt via the web UI; save; reload; confirm changes persisted.
       - Confirm `expected_updated_at` still triggers 409 on the *regular* PATCH (this PR removed it only from str-replace): open the same entity in two browser tabs, edit and save in one, then save in the other — second save should show the conflict UI.
     - **API self-check:** send a str-replace request that includes `expected_updated_at` in the body. The field is **silently ignored** — the Pydantic v2 request models in `schemas/errors.py` don't set `extra="forbid"`, and the v2 default is `extra="ignore"`. So existing MCP/CLI payloads that still include the field won't error; the PR description's schema-change callout is what tells integrators to drop it.
   - Note on KAN-149's closure decision (link to the ticket comment) — for the reviewer's context.
   - Any follow-up tickets filed from M1's broader audit (none expected per M1's findings).

### Testing Strategy

Final pass: `make backend-verify` green on the full set of changes.

### Stop here for final review. **Do not commit or push without explicit human approval.**

---

## Risks and Non-Goals

**Risks:**

- `with_for_update()` on a row with no other contenders is essentially free. Under heavy same-entity contention it serializes — but the str-replace path is microseconds, so serialization is invisible in practice. Noted in the architecture doc.
- If any service `get(...)` is overridden per-entity in a way that diverges from the base, the new `get_for_update(...)` could behave inconsistently. M1's audit verifies the call paths.

**Non-goals (explicitly out of scope, file separate tickets if found):**

- Changing the MCP tool signatures for str-replace. The original KAN-148 "Option A" is intentionally rejected — see the ticket comment.
- Adding `expected_updated_at` back to str-replace requests. M1 confirmed it has no callers and is removed in M3. The optimistic-lock mechanism still applies (and stays) on the regular PATCH endpoints.
- Fixing the declarative-update endpoints covered by KAN-149 (relationships, content-filters, sidebar). KAN-149 was closed without action — see "Scope decision" above.
- Any change to the history-recording layer. KAN-148 confirms the existing retry/savepoint logic is correct.
- Using `FOR NO KEY UPDATE` instead of `FOR UPDATE`. Noted as a possible future optimization in the architecture doc; not justified at current scale.
