"""
A connector token (an AI app's OAuth token) through the real app.

Real FastAPI app, real Postgres, dev mode off, and real RS256 tokens verified
against a test key: only the JWKS fetch is patched. A connector token reaches
the routes the MCP servers call and gets 403 `connector_forbidden` everywhere
else; the CLI's OAuth token, session tokens, and PATs behave as before. Each
write is checked in the database, not only by status code.
"""
from collections.abc import AsyncGenerator
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING
from unittest.mock import AsyncMock, patch
from uuid import UUID

import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import Settings, get_settings
from core.rate_limiter import check_rate_limit
from core.tier_limits import Tier, get_tier_limits
from models.api_token import ApiToken
from models.bookmark import Bookmark
from models.content_relationship import ContentRelationship
from models.note import Note
from models.user import User
from schemas.token import TokenCreate
from services import token_service
from tests.clerk_tokens import (
    CLAUDE_CODE_CLIENT_ID,
    TEST_AUTHORIZED_PARTY,
    TEST_CLERK_FRONTEND_API,
    TEST_CLI_OAUTH_CLIENT_ID,
    FakeJWKSClient,
    mint_clerk_oauth_token,
    mint_clerk_token,
)

if TYPE_CHECKING:
    from cryptography.hazmat.primitives.asymmetric.rsa import RSAPrivateKey

SUB = "user_connector_limits"
CONNECTOR_FORBIDDEN_BODY = {
    "detail": (
        "This endpoint is not available to AI-app connector tokens. Use the app's "
        "Tiddly tools, the web app, or a Personal Access Token."
    ),
    "error_code": "connector_forbidden",
}


@pytest.fixture(scope="module")
def clerk_signing_key() -> "RSAPrivateKey":
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture
async def user(db_session: AsyncSession) -> User:
    """
    The account all three Clerk tokens and the PAT belong to. PRO is the only
    tier with AI quota, so without the route check the AI request would reach
    the LLM service instead of stopping at a 429.
    """
    user = User(external_auth_id=SUB, email="connector-limits@test.com", tier=Tier.PRO.value)
    db_session.add(user)
    await db_session.flush()
    return user


@pytest.fixture
async def real_auth_client(
    client: AsyncClient,
    database_url: str,
    clerk_signing_key: "RSAPrivateKey",
    user: User,  # noqa: ARG001 - the tokens' account must exist
) -> AsyncGenerator[AsyncClient]:
    """
    The root `client` (it overrides the session factory and concurrent queries
    the context endpoints use) with dev mode off and the JWKS fetch patched to
    the test key.
    """
    from api.main import app  # noqa: PLC0415

    settings = Settings(
        database_url=database_url,
        dev_mode=False,
        clerk_frontend_api=TEST_CLERK_FRONTEND_API,
        clerk_authorized_parties_str=TEST_AUTHORIZED_PARTY,
        clerk_cli_oauth_client_id=TEST_CLI_OAUTH_CLIENT_ID,
    )
    app.dependency_overrides[get_settings] = lambda: settings
    with patch("core.auth.get_jwks_client", return_value=FakeJWKSClient(clerk_signing_key)):
        yield client


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def connector_headers(clerk_signing_key: "RSAPrivateKey") -> dict[str, str]:
    return _bearer(mint_clerk_oauth_token(
        clerk_signing_key, sub=SUB, client_id=CLAUDE_CODE_CLIENT_ID,
    ))


@pytest.fixture
def cli_headers(clerk_signing_key: "RSAPrivateKey") -> dict[str, str]:
    return _bearer(mint_clerk_oauth_token(
        clerk_signing_key, sub=SUB, client_id=TEST_CLI_OAUTH_CLIENT_ID,
    ))


@pytest.fixture
def session_headers(clerk_signing_key: "RSAPrivateKey") -> dict[str, str]:
    return _bearer(mint_clerk_token(clerk_signing_key, sub=SUB, azp=TEST_AUTHORIZED_PARTY))


@pytest.fixture
async def pat_headers(db_session: AsyncSession, user: User) -> dict[str, str]:
    _, plaintext = await token_service.create_token(
        db_session, user.id, TokenCreate(name="existing pat"), get_tier_limits(Tier.PRO),
    )
    return _bearer(plaintext)


async def _create_bookmark(
    client: AsyncClient, headers: dict[str, str], url: str = "https://example.com/seed",
) -> str:
    response = await client.post(
        "/bookmarks/", json={"url": url, "title": "Seeded"}, headers=headers,
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def _token_count(db_session: AsyncSession, user: User) -> int:
    result = await db_session.execute(select(ApiToken).where(ApiToken.user_id == user.id))
    return len(result.scalars().all())


# --- What a connector token can do -----------------------------------------


async def test__connector_reads_and_writes_on_mcp_routes(
    real_auth_client: AsyncClient,
    db_session: AsyncSession,
    session_headers: dict[str, str],
    connector_headers: dict[str, str],
) -> None:
    seeded_id = await _create_bookmark(real_auth_client, session_headers)

    listed = await real_auth_client.get("/bookmarks/", headers=connector_headers)
    assert listed.status_code == 200
    assert seeded_id in [item["id"] for item in listed.json()["items"]]

    created = await real_auth_client.post(
        "/bookmarks/",
        json={"url": "https://example.com/from-connector", "title": "From connector"},
        headers=connector_headers,
    )
    assert created.status_code == 201, created.text
    created_id = UUID(created.json()["id"])
    row = await db_session.get(Bookmark, created_id)
    assert row is not None
    assert row.title == "From connector"

    patched = await real_auth_client.patch(
        f"/bookmarks/{created_id}", json={"title": "Edited by connector"},
        headers=connector_headers,
    )
    assert patched.status_code == 200, patched.text
    await db_session.refresh(row)
    assert row.title == "Edited by connector"

    context = await real_auth_client.get("/mcp/context/content", headers=connector_headers)
    assert context.status_code == 200, context.text
    assert "Seeded" in context.text


async def test__connector_patch_archived_at__archives_item(
    real_auth_client: AsyncClient,
    db_session: AsyncSession,
    session_headers: dict[str, str],
    connector_headers: dict[str, str],
) -> None:
    """Decided (Shane 2026-11-03): the edit route's archived_at field is allowed."""
    bookmark_id = UUID(await _create_bookmark(real_auth_client, session_headers))
    past = (datetime.now(UTC) - timedelta(minutes=5)).isoformat()

    response = await real_auth_client.patch(
        f"/bookmarks/{bookmark_id}", json={"archived_at": past}, headers=connector_headers,
    )

    assert response.status_code == 200, response.text
    row = await db_session.get(Bookmark, bookmark_id)
    await db_session.refresh(row)
    assert row.archived_at is not None


async def test__connector_patch_relationships__replaces_links(
    real_auth_client: AsyncClient,
    db_session: AsyncSession,
    session_headers: dict[str, str],
    connector_headers: dict[str, str],
) -> None:
    """Decided (Shane 2026-11-03): the edit route's relationships field is allowed."""
    async def create_note(title: str) -> UUID:
        response = await real_auth_client.post(
            "/notes/", json={"title": title, "content": title}, headers=session_headers,
        )
        assert response.status_code == 201, response.text
        return UUID(response.json()["id"])

    note_id = await create_note("Source")
    old_target = await create_note("Old target")
    new_target = await create_note("New target")
    seeded = await real_auth_client.post(
        "/relationships/",
        json={
            "source_type": "note", "source_id": str(note_id),
            "target_type": "note", "target_id": str(old_target),
            "relationship_type": "related",
        },
        headers=session_headers,
    )
    assert seeded.status_code == 201, seeded.text

    response = await real_auth_client.patch(
        f"/notes/{note_id}",
        json={"relationships": [{"target_type": "note", "target_id": str(new_target)}]},
        headers=connector_headers,
    )

    assert response.status_code == 200, response.text
    rows = (await db_session.execute(
        select(ContentRelationship).where(
            (ContentRelationship.source_id == note_id)
            | (ContentRelationship.target_id == note_id),
        ),
    )).scalars().all()
    linked = {row.target_id if row.source_id == note_id else row.source_id for row in rows}
    assert linked == {new_target}


# --- What a connector token can't do ---------------------------------------


async def test__connector_permanent_delete__403_and_row_kept(
    real_auth_client: AsyncClient,
    db_session: AsyncSession,
    session_headers: dict[str, str],
    connector_headers: dict[str, str],
) -> None:
    bookmark_id = UUID(await _create_bookmark(real_auth_client, session_headers))

    response = await real_auth_client.delete(
        f"/bookmarks/{bookmark_id}?permanent=true", headers=connector_headers,
    )

    assert response.status_code == 403
    assert response.json() == CONNECTOR_FORBIDDEN_BODY
    assert "www-authenticate" not in response.headers
    await db_session.flush()
    row = (await db_session.execute(
        select(Bookmark).where(Bookmark.id == bookmark_id),
    )).scalar_one_or_none()
    assert row is not None
    assert row.deleted_at is None


async def test__connector_create_pat__403_and_no_token_row(
    real_auth_client: AsyncClient,
    db_session: AsyncSession,
    user: User,
    connector_headers: dict[str, str],
) -> None:
    response = await real_auth_client.post(
        "/tokens/", json={"name": "from connector"}, headers=connector_headers,
    )

    assert response.status_code == 403
    assert response.json() == CONNECTOR_FORBIDDEN_BODY
    assert await _token_count(db_session, user) == 0


async def test__connector_ai_suggest_tags__403_and_llm_never_called(
    real_auth_client: AsyncClient,
    connector_headers: dict[str, str],
) -> None:
    with patch(
        "api.routers.ai.get_llm_service",
        side_effect=AssertionError("the LLM service was reached"),
    ) as get_llm_service:
        response = await real_auth_client.post(
            "/ai/suggest-tags",
            json={"content_type": "bookmark", "title": "Anything"},
            headers=connector_headers,
        )

    assert response.status_code == 403
    assert response.json() == CONNECTOR_FORBIDDEN_BODY
    get_llm_service.assert_not_called()


async def test__connector_users_me__403(
    real_auth_client: AsyncClient,
    connector_headers: dict[str, str],
) -> None:
    response = await real_auth_client.get("/users/me", headers=connector_headers)

    assert response.status_code == 403
    assert response.json() == CONNECTOR_FORBIDDEN_BODY


async def test__refused_connector_request__charges_no_rate_limit(
    real_auth_client: AsyncClient,
    session_headers: dict[str, str],
    connector_headers: dict[str, str],
) -> None:
    """
    A refused request stops before either limiter runs, so an app calling
    refused routes can't use up the user's limits and get the user's own web
    app 429s. The two controls show each patch watches a limiter that runs.
    """
    general = AsyncMock(wraps=check_rate_limit)
    ai = AsyncMock(wraps=check_rate_limit)
    with (
        patch("core.auth.check_rate_limit", general),
        patch("api.routers.ai.check_rate_limit", ai),
        patch(
            "api.routers.ai.get_llm_service",
            side_effect=AssertionError("the LLM service was reached"),
        ),
    ):
        allowed = await real_auth_client.get("/bookmarks/", headers=connector_headers)
        assert allowed.status_code == 200
        assert (general.await_count, ai.await_count) == (1, 0)

        # An empty body fails validation after the AI limiter runs, so the
        # model is never called.
        ai_control = await real_auth_client.post(
            "/ai/suggest-tags", json={}, headers=session_headers,
        )
        assert ai_control.status_code == 422
        assert (general.await_count, ai.await_count) == (1, 1)

        general.reset_mock()
        ai.reset_mock()
        delete = await real_auth_client.delete(
            "/bookmarks/0190a1b2-0000-7000-8000-000000000099?permanent=true",
            headers=connector_headers,
        )
        suggest = await real_auth_client.post(
            "/ai/suggest-tags",
            json={"content_type": "bookmark", "title": "Anything"},
            headers=connector_headers,
        )

    assert delete.status_code == 403
    assert suggest.status_code == 403
    assert (general.await_count, ai.await_count) == (0, 0)


# --- Everyone else is unchanged --------------------------------------------


async def test__cli_creates_and_deletes_pat(
    real_auth_client: AsyncClient,
    db_session: AsyncSession,
    user: User,
    cli_headers: dict[str, str],
) -> None:
    """What `tiddly mcp configure` and `tiddly tokens delete` do with the CLI's token."""
    created = await real_auth_client.post(
        "/tokens/", json={"name": "from cli"}, headers=cli_headers,
    )
    assert created.status_code == 201, created.text
    assert await _token_count(db_session, user) == 1

    listed = await real_auth_client.get("/tokens/", headers=cli_headers)
    assert listed.status_code == 200
    token_id = created.json()["id"]
    assert token_id in [token["id"] for token in listed.json()]

    deleted = await real_auth_client.delete(f"/tokens/{token_id}", headers=cli_headers)
    assert deleted.status_code == 204
    assert await _token_count(db_session, user) == 0


async def test__session_permanent_delete__204_and_row_gone(
    real_auth_client: AsyncClient,
    db_session: AsyncSession,
    session_headers: dict[str, str],
) -> None:
    bookmark_id = UUID(await _create_bookmark(real_auth_client, session_headers))

    response = await real_auth_client.delete(
        f"/bookmarks/{bookmark_id}?permanent=true", headers=session_headers,
    )

    assert response.status_code == 204
    # The test session stands in for the request's; flush its pending delete.
    await db_session.flush()
    remaining = await db_session.execute(select(Bookmark.id).where(Bookmark.id == bookmark_id))
    assert remaining.scalar_one_or_none() is None


async def test__pat_create_pat__403_unchanged(
    real_auth_client: AsyncClient,
    db_session: AsyncSession,
    user: User,
    pat_headers: dict[str, str],
) -> None:
    """The PAT block on session-only routes keeps its own body."""
    response = await real_auth_client.post(
        "/tokens/", json={"name": "from pat"}, headers=pat_headers,
    )

    assert response.status_code == 403
    assert response.json() == {
        "detail": "This endpoint is not available for API tokens. Please use the web interface.",
    }
    assert await _token_count(db_session, user) == 1  # only the fixture's PAT


async def test__wrong_key_token__401(real_auth_client: AsyncClient) -> None:
    """The control: a token signed by another key is refused, so verification is on."""
    other_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    token = mint_clerk_oauth_token(other_key, sub=SUB, client_id=CLAUDE_CODE_CLIENT_ID)

    response = await real_auth_client.get("/bookmarks/", headers=_bearer(token))

    assert response.status_code == 401


async def test__connector_created_note_belongs_to_token_account(
    real_auth_client: AsyncClient,
    db_session: AsyncSession,
    user: User,
    connector_headers: dict[str, str],
) -> None:
    """A connector-created note lands on the token's account."""
    response = await real_auth_client.post(
        "/notes/", json={"title": "Connector note", "content": "x"}, headers=connector_headers,
    )

    assert response.status_code == 201, response.text
    row = await db_session.get(Note, UUID(response.json()["id"]))
    assert row is not None
    assert row.user_id == user.id
