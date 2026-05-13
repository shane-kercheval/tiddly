"""
Endpoint-level concurrency tests for the str-replace PATCH endpoints.

Parametrized over all four str-replace routes:
  - PATCH /bookmarks/{id}/str-replace
  - PATCH /notes/{id}/str-replace
  - PATCH /prompts/{id}/str-replace
  - PATCH /prompts/name/{name}/str-replace

The endpoints are content-addressable: the operation succeeds as long as
`old_str` is still uniquely findable in the current content. To prevent lost
updates from concurrent calls against the same entity, each handler fetches
the row with `SELECT ... FOR UPDATE`. These tests prove that lock is
end-to-end effective: N parallel calls all succeed and the final content
reflects every edit; overlapping calls return the expected `no_match`
conflict; history records form a coherent chain.

The tests are run against a custom client (`concurrent_client`, see
backend/tests/conftest.py) that wires `get_async_session` to the
`concurrent_session_factory` — each HTTP request gets its own DB session, so
the requests actually contend at the database level. The standard `client`
fixture cannot exercise this because it pins every request to a single
shared session.
"""
import asyncio
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from models.bookmark import Bookmark
from models.content_history import ActionType, ContentHistory, EntityType
from models.note import Note
from models.prompt import Prompt
from models.user import User


# Number of parallel str-replace calls for the "N concurrent non-overlapping
# edits" test. More than two (proves true parallel contention, not pairwise),
# comfortably under PRO-tier write rate limits.
N_CONCURRENT = 5

# Five distinct non-overlapping markers. Each parallel task targets one
# marker and replaces it with `EDITED-<i>`. After all N succeed the final
# content must contain every EDITED-<i>.
NON_OVERLAPPING_MARKERS = [f"marker-{i}" for i in range(N_CONCURRENT)]
NON_OVERLAPPING_CONTENT = "\n".join(NON_OVERLAPPING_MARKERS)


# ---------------------------------------------------------------------------
# Per-endpoint configuration table
# ---------------------------------------------------------------------------
#
# Each `EndpointCase` describes one of the four str-replace routes. Tests are
# parametrized over `CASES`; the table form keeps endpoint-specific quirks
# (URL shape, model class, extra create kwargs, history entity_type) in one
# place rather than scattered through test bodies.


@dataclass(frozen=True)
class EndpointCase:
    """One str-replace endpoint under test: seed shape, URL, and history entity_type."""

    label: str
    model: type
    entity_type_enum: EntityType
    # Build SQLAlchemy model constructor kwargs given (user_id, content).
    make_kwargs: Callable[[UUID, str], dict[str, Any]]
    # Build the URL path given a seeded entity.
    url: Callable[[Any], str]


def _bookmark_kwargs(user_id: UUID, content: str) -> dict[str, Any]:
    return {
        "user_id": user_id,
        "url": f"https://example.com/{uuid4().hex}",
        "title": "concurrency-test",
        "content": content,
    }


def _note_kwargs(user_id: UUID, content: str) -> dict[str, Any]:
    return {
        "user_id": user_id,
        "title": "concurrency-test",
        "content": content,
    }


def _prompt_kwargs(user_id: UUID, content: str) -> dict[str, Any]:
    return {
        "user_id": user_id,
        "name": f"concurrency-test-{uuid4().hex[:8]}",
        "title": "concurrency-test",
        "content": content,
        "arguments": [],
    }


CASES: list[EndpointCase] = [
    EndpointCase(
        label="bookmark",
        model=Bookmark,
        entity_type_enum=EntityType.BOOKMARK,
        make_kwargs=_bookmark_kwargs,
        url=lambda e: f"/bookmarks/{e.id}/str-replace",
    ),
    EndpointCase(
        label="note",
        model=Note,
        entity_type_enum=EntityType.NOTE,
        make_kwargs=_note_kwargs,
        url=lambda e: f"/notes/{e.id}/str-replace",
    ),
    EndpointCase(
        label="prompt-by-id",
        model=Prompt,
        entity_type_enum=EntityType.PROMPT,
        make_kwargs=_prompt_kwargs,
        url=lambda e: f"/prompts/{e.id}/str-replace",
    ),
    EndpointCase(
        label="prompt-by-name",
        model=Prompt,
        entity_type_enum=EntityType.PROMPT,
        make_kwargs=_prompt_kwargs,
        url=lambda e: f"/prompts/name/{e.name}/str-replace",
    ),
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _seed_entity(
    factory: async_sessionmaker,
    case: EndpointCase,
    user_id: UUID,
    content: str,
) -> Any:
    """
    Insert one entity directly via SQLAlchemy and return it.

    Direct DB insert (not POST /<entity>) is deliberate — these tests should
    fail when str-replace breaks, not when the create endpoint regresses.
    """
    async with factory() as session:
        entity = case.model(**case.make_kwargs(user_id, content))
        session.add(entity)
        await session.commit()
        await session.refresh(entity)
        return entity


async def _fetch_current_content(
    factory: async_sessionmaker,
    case: EndpointCase,
    entity_id: UUID,
) -> str | None:
    async with factory() as session:
        entity = await session.get(case.model, entity_id)
        return entity.content if entity is not None else None


async def _fetch_history_rows(
    factory: async_sessionmaker,
    case: EndpointCase,
    entity_id: UUID,
) -> list[ContentHistory]:
    async with factory() as session:
        result = await session.execute(
            select(ContentHistory)
            .where(
                ContentHistory.entity_type == case.entity_type_enum.value,
                ContentHistory.entity_id == entity_id,
            )
            .order_by(ContentHistory.version.asc().nullslast()),
        )
        return list(result.scalars().all())


def _case_ids(cases: list[EndpointCase]) -> list[str]:
    return [c.label for c in cases]


# ---------------------------------------------------------------------------
# Concurrent non-overlapping edits — load-bearing test
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("case", CASES, ids=_case_ids(CASES))
async def test_concurrent_non_overlapping_edits_all_succeed_and_compose(
    case: EndpointCase,
    concurrent_client: AsyncClient,
    concurrent_session_factory: async_sessionmaker,
    concurrent_test_user: User,
) -> None:
    """
    N parallel str-replace calls with disjoint targets all succeed and compose.

    The load-bearing assertion is that the final content contains every edit.
    "All 5 returned 200" alone would not catch a silent-overwrite bug — the
    losing writes would also return 200. Only checking final content proves
    the row lock serialized the writes correctly.
    """
    entity = await _seed_entity(
        concurrent_session_factory, case, concurrent_test_user.id,
        NON_OVERLAPPING_CONTENT,
    )

    url = case.url(entity)
    responses = await asyncio.gather(*[
        concurrent_client.patch(url, json={"old_str": marker, "new_str": f"EDITED-{i}"})
        for i, marker in enumerate(NON_OVERLAPPING_MARKERS)
    ])

    statuses = [r.status_code for r in responses]
    assert all(s == 200 for s in statuses), (
        f"Expected all 200, got {statuses}. Bodies: {[r.json() for r in responses]}"
    )

    final = await _fetch_current_content(concurrent_session_factory, case, entity.id)
    assert final is not None
    for i in range(N_CONCURRENT):
        assert f"EDITED-{i}" in final, (
            f"Missing EDITED-{i} in final content — silent overwrite. Final: {final!r}"
        )
    for marker in NON_OVERLAPPING_MARKERS:
        assert marker not in final, (
            f"Original marker {marker!r} still present — at least one edit was lost. "
            f"Final: {final!r}"
        )


# ---------------------------------------------------------------------------
# Concurrent overlapping edits — conflict surfaces as no_match
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("case", CASES, ids=_case_ids(CASES))
async def test_concurrent_overlapping_edits_return_no_match_for_loser(
    case: EndpointCase,
    concurrent_client: AsyncClient,
    concurrent_session_factory: async_sessionmaker,
    concurrent_test_user: User,
) -> None:
    """
    When two parallel str-replaces both target the same unique substring,
    one wins (200) and the other gets a 400 no_match — never a silent overwrite.
    """
    entity = await _seed_entity(
        concurrent_session_factory, case, concurrent_test_user.id, "shared-target",
    )
    url = case.url(entity)

    responses = await asyncio.gather(
        concurrent_client.patch(url, json={"old_str": "shared-target", "new_str": "by-A"}),
        concurrent_client.patch(url, json={"old_str": "shared-target", "new_str": "by-B"}),
    )

    statuses = sorted(r.status_code for r in responses)
    assert statuses == [200, 400], f"Expected [200, 400], got {statuses}"

    loser = next(r for r in responses if r.status_code == 400)
    assert loser.json()["detail"]["error"] == "no_match"

    final = await _fetch_current_content(concurrent_session_factory, case, entity.id)
    assert final in {"by-A", "by-B"}

    # Only the winning request should record a history row. A regression that
    # logged history for the no_match path would show up as an extra UPDATE.
    rows = await _fetch_history_rows(concurrent_session_factory, case, entity.id)
    updates = [
        r for r in rows
        if r.action == ActionType.UPDATE.value and r.version is not None
    ]
    assert len(updates) == 1, (
        f"Expected exactly 1 UPDATE row (the winner's), got {len(updates)}."
    )


# ---------------------------------------------------------------------------
# History version allocation under contention
# ---------------------------------------------------------------------------
#
# NOTE: This is NOT a content-chain coherence test. The load-bearing proof
# that the row lock fixed the lost-update bug on entity content lives in
# `test_concurrent_non_overlapping_edits_all_succeed_and_compose` above — if
# the lock failed, missing markers would surface there. The test below is a
# secondary check that history_service's version allocation also survives
# contention (unique, dense version numbers).
#
# A real diff-chain coherence test belongs in `test_history_service.py`,
# exercising the history service directly. KAN-148's scope is the lost-update
# bug on entity content; this PR doesn't attempt to also test history-layer
# content reconstruction.


@pytest.mark.parametrize("case", CASES, ids=_case_ids(CASES))
async def test_concurrent_edits_assign_unique_dense_history_versions(
    case: EndpointCase,
    concurrent_client: AsyncClient,
    concurrent_session_factory: async_sessionmaker,
    concurrent_test_user: User,
) -> None:
    """
    Under N concurrent str-replaces, `history_service.record_action` produces
    exactly N UPDATE rows with unique, dense version numbers.

    history_service uses `db.begin_nested()` + a unique constraint on
    `(entity_type, entity_id, version)` to retry version assignment on
    contention. If that retry loop were broken, the sequence would show a
    duplicate or a gap. This test is the regression catcher for that
    history-layer property only — see module note above for what is and
    isn't proven here.
    """
    entity = await _seed_entity(
        concurrent_session_factory, case, concurrent_test_user.id,
        NON_OVERLAPPING_CONTENT,
    )

    responses = await asyncio.gather(*[
        concurrent_client.patch(
            case.url(entity),
            json={"old_str": marker, "new_str": f"EDITED-{i}"},
        )
        for i, marker in enumerate(NON_OVERLAPPING_MARKERS)
    ])
    assert all(r.status_code == 200 for r in responses)

    rows = await _fetch_history_rows(concurrent_session_factory, case, entity.id)
    updates = [
        r for r in rows
        if r.action == ActionType.UPDATE.value and r.version is not None
    ]
    assert len(updates) == N_CONCURRENT, (
        f"Expected {N_CONCURRENT} UPDATEs, got {len(updates)}. "
        f"Missing rows indicate a lost update at the history layer."
    )

    versions = [r.version for r in updates]
    assert len(set(versions)) == N_CONCURRENT, (
        f"Duplicate version numbers under contention: {sorted(versions)}."
    )
    assert max(versions) - min(versions) + 1 == N_CONCURRENT, (
        f"Gap in version sequence: {sorted(versions)}."
    )

    # Each str-replace UPDATE row should record what changed. str-replace only
    # touches content (the prompt atomic-arguments path is exercised
    # separately in test_prompts.py).
    assert all(r.changed_fields == ["content"] for r in updates), (
        f"Expected changed_fields=['content'] on every str-replace UPDATE row. "
        f"Got: {[r.changed_fields for r in updates]}"
    )
