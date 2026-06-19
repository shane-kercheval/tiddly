"""Tests for the unauthenticated public share read endpoints (/public/*)."""
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from core.tier_limits import Tier
from models.bookmark import Bookmark
from models.note import Note
from models.prompt import Prompt
from models.user import User


async def _make_user(db: AsyncSession, suffix: str) -> User:
    """Create and flush a user to own published items."""
    user = User(
        auth0_id=f"auth0|public-{suffix}",
        email=f"public-{suffix}@test.local",
        tier=Tier.FREE.value,
    )
    db.add(user)
    await db.flush()
    return user


async def _publish_bookmark(db: AsyncSession, user_id: object, token: str, **kwargs: object) -> Bookmark:
    item = Bookmark(
        user_id=user_id,
        url=kwargs.get("url", "https://example.com/article"),
        title=kwargs.get("title", "Public Bookmark"),
        description=kwargs.get("description", "A shared bookmark"),
        content=kwargs.get("content", "Scraped page content\nsecond line"),
        is_public=kwargs.get("is_public", True),
        public_token=token,
        archived_at=kwargs.get("archived_at"),
        deleted_at=kwargs.get("deleted_at"),
    )
    db.add(item)
    await db.flush()
    return item


async def _publish_note(db: AsyncSession, user_id: object, token: str, **kwargs: object) -> Note:
    item = Note(
        user_id=user_id,
        title=kwargs.get("title", "Public Note"),
        description=kwargs.get("description", "A shared note"),
        content=kwargs.get("content", "# Heading\n\nNote body"),
        is_public=kwargs.get("is_public", True),
        public_token=token,
        archived_at=kwargs.get("archived_at"),
        deleted_at=kwargs.get("deleted_at"),
    )
    db.add(item)
    await db.flush()
    return item


async def _publish_prompt(db: AsyncSession, user_id: object, token: str, **kwargs: object) -> Prompt:
    item = Prompt(
        user_id=user_id,
        name=kwargs.get("name", "public-prompt"),
        title=kwargs.get("title", "Public Prompt"),
        description=kwargs.get("description", "A shared prompt"),
        content=kwargs.get("content", "Summarize {{ topic }}"),
        arguments=kwargs.get("arguments", [{"name": "topic", "description": "the topic", "required": True}]),
        is_public=kwargs.get("is_public", True),
        public_token=token,
        archived_at=kwargs.get("archived_at"),
        deleted_at=kwargs.get("deleted_at"),
    )
    db.add(item)
    await db.flush()
    return item


# (type label, publish helper, url path segment, identifying field name + expected value)
_TYPES: list[tuple[str, Callable[..., Awaitable[object]], str]] = [
    ("bookmark", _publish_bookmark, "bookmarks"),
    ("note", _publish_note, "notes"),
    ("prompt", _publish_prompt, "prompts"),
]


@pytest.mark.parametrize(("label", "publish", "segment"), _TYPES)
async def test_get_published_item_returns_content(
    client: AsyncClient,
    db_session: AsyncSession,
    label: str,
    publish: Callable[..., Awaitable[object]],
    segment: str,
) -> None:
    """A published, active item is returned with its content and is_archived=false."""
    user = await _make_user(db_session, f"{label}-active")
    token = f"tok-active-{label}"
    await publish(db_session, user.id, token)

    resp = await client.get(f"/public/{segment}/{token}")

    assert resp.status_code == 200
    data = resp.json()
    assert data["content"] is not None
    assert data["is_archived"] is False
    assert "created_at" in data
    assert "updated_at" in data


async def test_get_public_bookmark_includes_url(
    client: AsyncClient, db_session: AsyncSession,
) -> None:
    """The public bookmark response includes url (core content of a bookmark)."""
    user = await _make_user(db_session, "bm-url")
    await _publish_bookmark(db_session, user.id, "tok-url", url="https://example.com/page")

    resp = await client.get("/public/bookmarks/tok-url")

    assert resp.status_code == 200
    assert resp.json()["url"] == "https://example.com/page"


async def test_get_public_prompt_includes_name_and_arguments(
    client: AsyncClient, db_session: AsyncSession,
) -> None:
    """The public prompt response includes name and arguments (functional content)."""
    user = await _make_user(db_session, "pr-args")
    await _publish_prompt(db_session, user.id, "tok-pr-args")

    resp = await client.get("/public/prompts/tok-pr-args")

    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "public-prompt"
    assert data["arguments"][0]["name"] == "topic"


@pytest.mark.parametrize(("label", "publish", "segment"), _TYPES)
async def test_archived_item_returns_is_archived_true(
    client: AsyncClient,
    db_session: AsyncSession,
    label: str,
    publish: Callable[..., Awaitable[object]],
    segment: str,
) -> None:
    """A published but archived item is still served, flagged is_archived=true."""
    user = await _make_user(db_session, f"{label}-archived")
    token = f"tok-archived-{label}"
    await publish(db_session, user.id, token, archived_at=datetime.now(UTC) - timedelta(days=1))

    resp = await client.get(f"/public/{segment}/{token}")

    assert resp.status_code == 200
    assert resp.json()["is_archived"] is True


async def test_future_archive_reports_not_archived(
    client: AsyncClient, db_session: AsyncSession,
) -> None:
    """A future-dated archived_at (scheduled archive) is reported is_archived=false."""
    user = await _make_user(db_session, "future-archive")
    await _publish_note(
        db_session, user.id, "tok-future", archived_at=datetime.now(UTC) + timedelta(days=7),
    )

    resp = await client.get("/public/notes/tok-future")

    assert resp.status_code == 200
    assert resp.json()["is_archived"] is False


@pytest.mark.parametrize(("label", "publish", "segment"), _TYPES)
async def test_unknown_token_returns_404(
    client: AsyncClient,
    db_session: AsyncSession,  # noqa: ARG001 - keeps DB wired for the override
    label: str,
    publish: Callable[..., Awaitable[object]],  # noqa: ARG001 - bundled in _TYPES parametrize
    segment: str,
) -> None:
    """An unknown share token returns 404."""
    resp = await client.get(f"/public/{segment}/does-not-exist-{label}")
    assert resp.status_code == 404


@pytest.mark.parametrize(("label", "publish", "segment"), _TYPES)
async def test_unpublished_token_returns_404(
    client: AsyncClient,
    db_session: AsyncSession,
    label: str,
    publish: Callable[..., Awaitable[object]],
    segment: str,
) -> None:
    """A valid token on an item with is_public=False returns 404."""
    user = await _make_user(db_session, f"{label}-unpub")
    token = f"tok-unpub-{label}"
    await publish(db_session, user.id, token, is_public=False)

    resp = await client.get(f"/public/{segment}/{token}")
    assert resp.status_code == 404


@pytest.mark.parametrize(("label", "publish", "segment"), _TYPES)
async def test_soft_deleted_item_returns_404(
    client: AsyncClient,
    db_session: AsyncSession,
    label: str,
    publish: Callable[..., Awaitable[object]],
    segment: str,
) -> None:
    """A soft-deleted item returns 404 even with a valid, published token."""
    user = await _make_user(db_session, f"{label}-deleted")
    token = f"tok-deleted-{label}"
    await publish(db_session, user.id, token, deleted_at=datetime.now(UTC))

    resp = await client.get(f"/public/{segment}/{token}")
    assert resp.status_code == 404


async def test_response_excludes_owner_fields(
    client: AsyncClient, db_session: AsyncSession,
) -> None:
    """The public response must not leak owner/organizational/operational fields."""
    user = await _make_user(db_session, "no-leak")
    await _publish_bookmark(db_session, user.id, "tok-no-leak")

    resp = await client.get("/public/bookmarks/tok-no-leak")

    assert resp.status_code == 200
    data = resp.json()
    for forbidden in (
        "id", "user_id", "tags", "relationships", "archived_at", "deleted_at",
        "is_public", "public_token", "summary", "last_used_at",
    ):
        assert forbidden not in data, f"{forbidden} leaked into public response"


async def test_public_response_uses_public_cache_headers(
    client: AsyncClient, db_session: AsyncSession,
) -> None:
    """Public responses are publicly cacheable with revalidation and no Vary: Authorization."""
    user = await _make_user(db_session, "cache")
    await _publish_note(db_session, user.id, "tok-cache")

    resp = await client.get("/public/notes/tok-cache")

    assert resp.status_code == 200
    assert resp.headers["cache-control"] == "public, max-age=0, must-revalidate"
    assert "authorization" not in resp.headers.get("vary", "").lower()


async def test_public_endpoint_304_keeps_public_headers(
    client: AsyncClient, db_session: AsyncSession,
) -> None:
    """A matching If-None-Match yields 304 that still carries the public cache headers."""
    user = await _make_user(db_session, "etag")
    await _publish_note(db_session, user.id, "tok-etag")

    first = await client.get("/public/notes/tok-etag")
    assert first.status_code == 200
    etag = first.headers["etag"]

    second = await client.get("/public/notes/tok-etag", headers={"If-None-Match": etag})
    assert second.status_code == 304
    assert second.headers["cache-control"] == "public, max-age=0, must-revalidate"
    assert "authorization" not in second.headers.get("vary", "").lower()


async def test_authenticated_endpoint_keeps_private_headers(
    client: AsyncClient,
) -> None:
    """Regression: authed (non-public) GETs still get private, no-cache + Vary: Authorization."""
    created = await client.post("/bookmarks/", json={"url": "https://private.example.com"})
    assert created.status_code == 201
    bookmark_id = created.json()["id"]

    resp = await client.get(f"/bookmarks/{bookmark_id}")

    assert resp.status_code == 200
    assert resp.headers["cache-control"] == "private, no-cache"
    assert resp.headers.get("vary") == "Authorization"


async def test_ip_rate_limit_returns_429_and_is_keyed_by_forwarded_ip(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Per-IP limit returns 429 past the cap, and distinct X-Forwarded-For IPs get own buckets."""
    monkeypatch.setattr("core.rate_limiter.PUBLIC_IP_RATE_LIMIT_PER_MINUTE", 2)
    user = await _make_user(db_session, "ratelimit")
    await _publish_bookmark(db_session, user.id, "tok-rl")
    url = "/public/bookmarks/tok-rl"
    ip_a = {"X-Forwarded-For": "203.0.113.10"}
    ip_b = {"X-Forwarded-For": "203.0.113.99"}

    assert (await client.get(url, headers=ip_a)).status_code == 200
    assert (await client.get(url, headers=ip_a)).status_code == 200
    blocked = await client.get(url, headers=ip_a)
    assert blocked.status_code == 429
    assert "retry-after" in blocked.headers

    # A different forwarded IP is an independent bucket and is still allowed.
    assert (await client.get(url, headers=ip_b)).status_code == 200


async def test_x_real_ip_takes_precedence_and_resists_xff_spoof(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When X-Real-IP is present, it keys the bucket and a rotating spoofed XFF can't dodge it."""
    monkeypatch.setattr("core.rate_limiter.PUBLIC_IP_RATE_LIMIT_PER_MINUTE", 2)
    user = await _make_user(db_session, "realip")
    await _publish_bookmark(db_session, user.id, "tok-realip")
    url = "/public/bookmarks/tok-realip"

    # Same real client (X-Real-IP) but a different forged X-Forwarded-For each
    # time: all share one bucket, so the third request is blocked despite the
    # rotating spoof — proving XFF can't be used to mint fresh buckets.
    def headers(spoof: str) -> dict[str, str]:
        return {"X-Real-IP": "198.51.100.7", "X-Forwarded-For": spoof}

    assert (await client.get(url, headers=headers("1.1.1.1"))).status_code == 200
    assert (await client.get(url, headers=headers("2.2.2.2"))).status_code == 200
    assert (await client.get(url, headers=headers("3.3.3.3"))).status_code == 429


async def test_public_response_includes_content_metadata(
    client: AsyncClient, db_session: AsyncSession,
) -> None:
    """content_metadata reports the full line range for the returned content."""
    user = await _make_user(db_session, "cmeta")
    await _publish_note(db_session, user.id, "tok-cmeta", content="line1\nline2\nline3")

    resp = await client.get("/public/notes/tok-cmeta")

    assert resp.status_code == 200
    meta = resp.json()["content_metadata"]
    assert meta is not None
    assert meta["total_lines"] == 3
    assert meta["start_line"] == 1
    assert meta["end_line"] == 3
    assert meta["is_partial"] is False


async def test_public_response_with_empty_content(
    client: AsyncClient, db_session: AsyncSession,
) -> None:
    """An item with no content returns content/content_metadata as null, not an error."""
    user = await _make_user(db_session, "empty")
    await _publish_note(db_session, user.id, "tok-empty", content=None)

    resp = await client.get("/public/notes/tok-empty")

    assert resp.status_code == 200
    data = resp.json()
    assert data["content"] is None
    assert data["content_metadata"] is None
