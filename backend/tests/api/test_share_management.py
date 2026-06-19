"""
Tests for the owner share-management endpoints (Milestone 3).

These cover the dedicated publish/unpublish/rotate endpoints on the three
type-specific routers and the invariants the feature relies on:
  - publishing mints a token and flips is_public, without bumping updated_at or
    writing history (sharing is not a content change);
  - unpublishing keeps the token (re-publishing restores the same URL);
  - rotating issues a fresh token and invalidates the old public URL, working
    even while unpublished;
  - is_public is exposed on list AND detail responses, but the raw public_token
    is exposed on detail responses ONLY (kept off bulk/agent surfaces).

Items are created via the API as the dev user, so the owner-scoped share
endpoints resolve them. The behaviour is identical across types, so each case is
parametrized over the three URL segments.
"""
from collections.abc import AsyncGenerator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import Settings, get_settings

_SEGMENTS = ["bookmarks", "notes", "prompts"]

# A syntactically valid UUID that never matches a real item.
_FAKE_UUID = "00000000-0000-0000-0000-000000000000"


async def _create_item(client: AsyncClient, segment: str) -> dict:
    """Create one item of the given type as the dev user; return its detail JSON."""
    if segment == "bookmarks":
        payload: dict = {"url": "https://example.com/share-target", "title": "Shareable"}
    elif segment == "notes":
        payload = {"title": "Shareable Note", "content": "note body"}
    else:
        payload = {"name": "shareable-prompt", "content": "Summarize the text."}
    resp = await client.post(f"/{segment}/", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _history_total(client: AsyncClient, segment: str, item_id: str) -> int:
    """Return the number of history records for an item."""
    resp = await client.get(f"/{segment}/{item_id}/history")
    assert resp.status_code == 200, resp.text
    return resp.json()["total"]


@pytest.mark.parametrize("segment", _SEGMENTS)
async def test_publish_mints_token_and_sets_public(
    client: AsyncClient, segment: str,
) -> None:
    """First publish generates a public_token and flips is_public to true."""
    item = await _create_item(client, segment)
    assert item["is_public"] is False
    assert item["public_token"] is None

    resp = await client.post(f"/{segment}/{item['id']}/share")

    assert resp.status_code == 200, resp.text
    shared = resp.json()
    assert shared["is_public"] is True
    assert shared["public_token"] is not None
    assert shared["public_token"]  # non-empty


@pytest.mark.parametrize("segment", _SEGMENTS)
async def test_publish_does_not_bump_updated_at_or_write_history(
    client: AsyncClient, segment: str,
) -> None:
    """Sharing is not a content change: updated_at and history are untouched."""
    item = await _create_item(client, segment)
    history_before = await _history_total(client, segment, item["id"])

    resp = await client.post(f"/{segment}/{item['id']}/share")
    assert resp.status_code == 200, resp.text

    # updated_at is unchanged (no content edit; column has no onupdate).
    assert resp.json()["updated_at"] == item["updated_at"]
    # No new history entry was recorded for the share event.
    assert await _history_total(client, segment, item["id"]) == history_before


@pytest.mark.parametrize("segment", _SEGMENTS)
async def test_normal_update_after_share_preserves_token(
    client: AsyncClient, segment: str,
) -> None:
    """A subsequent content update keeps the token stable (URLs don't churn)."""
    item = await _create_item(client, segment)
    token = (await client.post(f"/{segment}/{item['id']}/share")).json()["public_token"]

    updated = await client.patch(f"/{segment}/{item['id']}", json={"title": "Updated Title"})
    assert updated.status_code == 200, updated.text

    detail = updated.json()
    assert detail["public_token"] == token
    assert detail["is_public"] is True
    # A real content update *does* bump updated_at — only sharing leaves it alone.
    assert detail["updated_at"] != item["updated_at"]


@pytest.mark.parametrize("segment", _SEGMENTS)
async def test_unpublish_keeps_token(
    client: AsyncClient, segment: str,
) -> None:
    """Unpublishing flips is_public to false but retains the token."""
    item = await _create_item(client, segment)
    token = (await client.post(f"/{segment}/{item['id']}/share")).json()["public_token"]

    resp = await client.delete(f"/{segment}/{item['id']}/share")

    assert resp.status_code == 200, resp.text
    unshared = resp.json()
    assert unshared["is_public"] is False
    assert unshared["public_token"] == token


@pytest.mark.parametrize("segment", _SEGMENTS)
async def test_republish_reuses_existing_token(
    client: AsyncClient, segment: str,
) -> None:
    """Re-publishing a previously-unpublished item restores the same URL."""
    item = await _create_item(client, segment)
    token = (await client.post(f"/{segment}/{item['id']}/share")).json()["public_token"]
    await client.delete(f"/{segment}/{item['id']}/share")

    resp = await client.post(f"/{segment}/{item['id']}/share")

    assert resp.status_code == 200, resp.text
    assert resp.json()["public_token"] == token
    assert resp.json()["is_public"] is True


@pytest.mark.parametrize("segment", _SEGMENTS)
async def test_rotate_invalidates_old_public_url(
    client: AsyncClient, segment: str,
) -> None:
    """Rotating issues a new token; the old public URL stops resolving."""
    item = await _create_item(client, segment)
    old_token = (await client.post(f"/{segment}/{item['id']}/share")).json()["public_token"]
    assert (await client.get(f"/public/{segment}/{old_token}")).status_code == 200

    resp = await client.post(f"/{segment}/{item['id']}/rotate-share-token")

    assert resp.status_code == 200, resp.text
    new_token = resp.json()["public_token"]
    assert new_token != old_token
    assert resp.json()["is_public"] is True  # rotate leaves sharing state alone

    assert (await client.get(f"/public/{segment}/{old_token}")).status_code == 404
    assert (await client.get(f"/public/{segment}/{new_token}")).status_code == 200


@pytest.mark.parametrize("segment", _SEGMENTS)
async def test_rotate_does_not_write_history(
    client: AsyncClient, segment: str,
) -> None:
    """Rotating the token records no history entry (not a content change)."""
    item = await _create_item(client, segment)
    await client.post(f"/{segment}/{item['id']}/share")
    history_before = await _history_total(client, segment, item["id"])

    resp = await client.post(f"/{segment}/{item['id']}/rotate-share-token")
    assert resp.status_code == 200, resp.text

    assert await _history_total(client, segment, item["id"]) == history_before


@pytest.mark.parametrize("segment", _SEGMENTS)
async def test_rotate_while_unpublished_updates_token(
    client: AsyncClient, segment: str,
) -> None:
    """Rotating works while unpublished; the token changes, is_public stays false."""
    item = await _create_item(client, segment)

    first = await client.post(f"/{segment}/{item['id']}/rotate-share-token")
    assert first.status_code == 200, first.text
    token1 = first.json()["public_token"]
    assert token1 is not None
    assert first.json()["is_public"] is False

    second = await client.post(f"/{segment}/{item['id']}/rotate-share-token")
    assert second.json()["public_token"] != token1
    assert second.json()["is_public"] is False

    # Still unpublished, so the token does not resolve publicly.
    assert (await client.get(f"/public/{segment}/{token1}")).status_code == 404


@pytest.mark.parametrize("segment", _SEGMENTS)
async def test_detail_exposes_token_list_does_not(
    client: AsyncClient, segment: str,
) -> None:
    """is_public is on both surfaces; the raw token is on detail only."""
    item = await _create_item(client, segment)
    token = (await client.post(f"/{segment}/{item['id']}/share")).json()["public_token"]

    detail = (await client.get(f"/{segment}/{item['id']}")).json()
    assert detail["is_public"] is True
    assert detail["public_token"] == token

    listing = (await client.get(f"/{segment}/")).json()
    listed = next(row for row in listing["items"] if row["id"] == item["id"])
    assert listed["is_public"] is True
    assert "public_token" not in listed


@pytest.mark.parametrize("segment", _SEGMENTS)
async def test_share_unknown_id_returns_404(
    client: AsyncClient, segment: str,
) -> None:
    """Share/unshare/rotate on a non-existent (or non-owned) item returns 404."""
    assert (await client.post(f"/{segment}/{_FAKE_UUID}/share")).status_code == 404
    assert (await client.delete(f"/{segment}/{_FAKE_UUID}/share")).status_code == 404
    rotate = await client.post(f"/{segment}/{_FAKE_UUID}/rotate-share-token")
    assert rotate.status_code == 404


@pytest.mark.parametrize("segment", _SEGMENTS)
async def test_share_on_deleted_item_returns_404(
    client: AsyncClient, segment: str,
) -> None:
    """A soft-deleted item can't be published or rotated — the status write excludes deleted."""
    item = await _create_item(client, segment)
    assert (await client.delete(f"/{segment}/{item['id']}")).status_code == 204

    assert (await client.post(f"/{segment}/{item['id']}/share")).status_code == 404
    assert (
        await client.post(f"/{segment}/{item['id']}/rotate-share-token")
    ).status_code == 404


@pytest.mark.parametrize("segment", _SEGMENTS)
async def test_share_on_archived_item_succeeds(
    client: AsyncClient, segment: str,
) -> None:
    """An archived item IS shareable — archived content is still live content."""
    item = await _create_item(client, segment)
    assert (await client.post(f"/{segment}/{item['id']}/archive")).status_code == 200

    resp = await client.post(f"/{segment}/{item['id']}/share")
    assert resp.status_code == 200, resp.text
    assert resp.json()["is_public"] is True
    assert resp.json()["public_token"] is not None


@pytest.mark.parametrize("segment", _SEGMENTS)
async def test_etag_revalidation_reflects_share_change(
    client: AsyncClient, segment: str,
) -> None:
    """
    The ETag (full-body validator) catches a share change even though sharing
    leaves updated_at untouched.

    This is the path the web app relies on: an If-None-Match revalidation after
    publishing returns 200 with the fresh share fields, not a stale 304. The
    Last-Modified/If-Modified-Since fast path is deliberately NOT the validator
    for share state (see the API "Caching & conditional requests" note); this
    test pins the protection that makes deferring that fix safe.
    """
    item = await _create_item(client, segment)
    first = await client.get(f"/{segment}/{item['id']}")
    assert first.status_code == 200
    etag = first.headers["etag"]

    # Baseline: an unchanged item revalidates to 304 via the ETag.
    cached = await client.get(f"/{segment}/{item['id']}", headers={"If-None-Match": etag})
    assert cached.status_code == 304

    await client.post(f"/{segment}/{item['id']}/share")

    # After publishing, the body changed -> ETag differs -> 200 with fresh fields.
    revalidated = await client.get(f"/{segment}/{item['id']}", headers={"If-None-Match": etag})
    assert revalidated.status_code == 200
    assert revalidated.json()["is_public"] is True
    assert revalidated.json()["public_token"] is not None


@pytest.fixture
async def auth_required_client(
    async_engine: object,  # noqa: ARG001 - ensures the schema is created
    db_session: AsyncSession,
    database_url: str,
) -> AsyncGenerator[AsyncClient]:
    """A client with auth enforced (dev_mode disabled, no credentials attached)."""
    from api.main import app  # noqa: PLC0415
    from db.session import get_async_session  # noqa: PLC0415

    async def override_get_async_session() -> AsyncGenerator[AsyncSession]:
        yield db_session

    def override_get_settings() -> Settings:
        return Settings(
            database_url=database_url,
            dev_mode=False,
            auth0_domain="test.auth0.com",
            auth0_audience="https://test-api",
            auth0_client_id="test-client-id",
            auth0_custom_claim_namespace="https://test.example.com",
        )

    app.dependency_overrides[get_async_session] = override_get_async_session
    app.dependency_overrides[get_settings] = override_get_settings
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test",
    ) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.mark.parametrize("segment", _SEGMENTS)
async def test_share_endpoints_require_auth(
    auth_required_client: AsyncClient, segment: str,
) -> None:
    """All three share operations reject unauthenticated callers with 401."""
    base = f"/{segment}/{_FAKE_UUID}"
    assert (await auth_required_client.post(f"{base}/share")).status_code == 401
    assert (await auth_required_client.delete(f"{base}/share")).status_code == 401
    assert (await auth_required_client.post(f"{base}/rotate-share-token")).status_code == 401
