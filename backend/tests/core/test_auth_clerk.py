"""
Tests for Clerk token verification (M1 dual-accept, Clerk-only since M6b).

These mint REAL RS256 JWTs with a test keypair and patch only the JWKS
client — the azp rule, clock-skew leeway, and expiry checks live inside
decode_clerk_jwt, so patching the decoder would bypass exactly what needs
testing. (TEST_AUTH0_ISSUER survives only to prove the old issuer is now
rejected at dispatch.)

Note: Imports from core.auth are done inside test methods to avoid triggering
Settings validation during test collection (before DATABASE_URL is set by fixtures).
"""
import logging
import time
from collections.abc import Generator
from typing import TYPE_CHECKING
from unittest.mock import MagicMock, patch

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException, Request
from fastapi.routing import APIRoute
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import Settings
from core.logging_config import FIRST_PARTY_LOGGERS, configure_logging
from core.tier_limits import Tier, get_tier_limits
from models.deleted_identity import DeletedIdentity
from models.user import User
from schemas.token import TokenCreate
from tests.clerk_tokens import (
    CLAUDE_CODE_CLIENT_ID,
    TEST_AUTHORIZED_PARTY,
    TEST_CLERK_FRONTEND_API,
    TEST_CLERK_ISSUER,
    TEST_CLI_OAUTH_CLIENT_ID,
    FakeJWKSClient,
    mint_clerk_oauth_token,
    mint_clerk_token,
)

if TYPE_CHECKING:
    from cryptography.hazmat.primitives.asymmetric.rsa import RSAPrivateKey

TEST_AUTH0_ISSUER = "https://test-tenant.auth0.com/"


@pytest.fixture(autouse=True)
def _database_url_env(database_url: str) -> str:
    """Importing core.auth loads db.session, which needs DATABASE_URL set."""
    return database_url


@pytest.fixture(scope="module")
def clerk_signing_key() -> "RSAPrivateKey":
    """Test RSA keypair standing in for the Clerk instance's JWKS key."""
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture
def mock_request() -> Request:
    """
    Create a mock request for auth tests. Its scope has no matched route, so a
    connector token is refused on it; connector tests use `connector_request`.
    """
    request = MagicMock(spec=Request)
    request.headers = {}
    request.state = MagicMock()
    request.method = "GET"
    request.scope = {}
    return request


def _app_route(method: str, path: str) -> APIRoute:
    """The real route on api.main.app, so the check reads a genuine template."""
    from api.main import app  # noqa: PLC0415

    for route in app.routes:
        if isinstance(route, APIRoute) and route.path == path and method in route.methods:
            return route
    raise LookupError(f"no {method} {path} route on the app")


def request_on_route(method: str, path: str) -> Request:
    """A mock request whose scope carries the matched route, as FastAPI sets it."""
    request = MagicMock(spec=Request)
    request.headers = {}
    request.state = MagicMock()
    request.method = method
    request.scope = {"route": _app_route(method, path)}
    return request


@pytest.fixture
def connector_request() -> Request:
    """A request on GET /bookmarks/, a route connector tokens may call."""
    return request_on_route("GET", "/bookmarks/")


@pytest.fixture
def clerk_settings() -> Settings:
    """Mock settings with the Clerk configuration populated."""
    settings = MagicMock(spec=Settings)
    settings.dev_mode = False
    settings.clerk_frontend_api = TEST_CLERK_FRONTEND_API
    settings.clerk_issuer = TEST_CLERK_ISSUER
    settings.clerk_jwks_url = f"{TEST_CLERK_ISSUER}/.well-known/jwks.json"
    settings.clerk_authorized_parties = [TEST_AUTHORIZED_PARTY]
    settings.clerk_jit_create_enabled = True
    settings.clerk_cli_oauth_client_id = TEST_CLI_OAUTH_CLIENT_ID
    return settings


@pytest.fixture(autouse=True)
def patched_jwks(clerk_signing_key: "RSAPrivateKey") -> Generator[FakeJWKSClient]:
    """
    Patch the JWKS client so verification uses the test public key.

    Autouse: most tests in this module verify real signatures; the few that
    never reach JWKS (opaque bearer, patched Auth0 decode) are unaffected.
    """
    fake = FakeJWKSClient(clerk_signing_key)
    with patch("core.auth.get_jwks_client", return_value=fake):
        yield fake


class TestDecodeClerkJwt:
    """Claim enforcement in decode_clerk_jwt (real signatures, mocked JWKS)."""

    def test__valid_token__returns_payload(
        self,
        clerk_signing_key: "RSAPrivateKey",
        clerk_settings: Settings,
    ) -> None:
        """A validly signed, unexpired token with custom claims decodes."""
        from core.auth import decode_clerk_jwt  # noqa: PLC0415

        token = mint_clerk_token(
            clerk_signing_key, email="user@test.com", email_verified=True,
        )
        payload = decode_clerk_jwt(token, clerk_settings).claims

        assert payload["sub"] == "user_test_clerk_id"
        assert payload["email"] == "user@test.com"
        assert payload["email_verified"] is True

    def test__azp_allowlisted__accepted(
        self,
        clerk_signing_key: "RSAPrivateKey",
        clerk_settings: Settings,
    ) -> None:
        """Azp present and in the allowlist → accepted."""
        from core.auth import decode_clerk_jwt  # noqa: PLC0415

        token = mint_clerk_token(clerk_signing_key, azp=TEST_AUTHORIZED_PARTY)
        payload = decode_clerk_jwt(token, clerk_settings).claims

        assert payload["azp"] == TEST_AUTHORIZED_PARTY

    def test__azp_wrong__rejected_401(
        self,
        clerk_signing_key: "RSAPrivateKey",
        clerk_settings: Settings,
    ) -> None:
        """Azp present but not allowlisted → 401 (a token minted for another site)."""
        from core.auth import decode_clerk_jwt  # noqa: PLC0415

        token = mint_clerk_token(clerk_signing_key, azp="https://evil.example.com")
        with pytest.raises(HTTPException) as exc_info:
            decode_clerk_jwt(token, clerk_settings)

        assert exc_info.value.status_code == 401

    def test__azp_absent__accepted(
        self,
        clerk_signing_key: "RSAPrivateKey",
        clerk_settings: Settings,
    ) -> None:
        """Azp absent → tolerated (M0 spike: non-browser tokens carry none)."""
        from core.auth import decode_clerk_jwt  # noqa: PLC0415

        token = mint_clerk_token(clerk_signing_key)  # no azp claim
        payload = decode_clerk_jwt(token, clerk_settings).claims

        assert "azp" not in payload

    def test__expired_token__rejected_401(
        self,
        clerk_signing_key: "RSAPrivateKey",
        clerk_settings: Settings,
    ) -> None:
        """A token expired beyond the leeway window → 401."""
        from core.auth import decode_clerk_jwt  # noqa: PLC0415

        token = mint_clerk_token(clerk_signing_key, exp=int(time.time()) - 120)
        with pytest.raises(HTTPException) as exc_info:
            decode_clerk_jwt(token, clerk_settings)

        assert exc_info.value.status_code == 401
        assert exc_info.value.detail == "Token has expired"

    def test__exp_within_leeway__accepted(
        self,
        clerk_signing_key: "RSAPrivateKey",
        clerk_settings: Settings,
    ) -> None:
        """A token whose exp is ~3s past still verifies (5s clock-skew leeway)."""
        from core.auth import decode_clerk_jwt  # noqa: PLC0415

        token = mint_clerk_token(clerk_signing_key, exp=int(time.time()) - 3)
        payload = decode_clerk_jwt(token, clerk_settings).claims

        assert payload["sub"] == "user_test_clerk_id"

    def test__exp_past_leeway__rejected(
        self,
        clerk_signing_key: "RSAPrivateKey",
        clerk_settings: Settings,
    ) -> None:
        """A token whose exp is ~10s past is outside the 5s leeway → 401."""
        from core.auth import decode_clerk_jwt  # noqa: PLC0415

        token = mint_clerk_token(clerk_signing_key, exp=int(time.time()) - 10)
        with pytest.raises(HTTPException) as exc_info:
            decode_clerk_jwt(token, clerk_settings)

        assert exc_info.value.status_code == 401

    def test__wrong_issuer__rejected_401(
        self,
        clerk_signing_key: "RSAPrivateKey",
        clerk_settings: Settings,
    ) -> None:
        """A validly signed token with the wrong iss → 401."""
        from core.auth import decode_clerk_jwt  # noqa: PLC0415

        token = mint_clerk_token(
            clerk_signing_key, issuer="https://other-instance.clerk.accounts.dev",
        )
        with pytest.raises(HTTPException) as exc_info:
            decode_clerk_jwt(token, clerk_settings)

        assert exc_info.value.status_code == 401
        assert exc_info.value.detail == "Invalid issuer"

    def test__missing_sub__rejected_401(
        self,
        clerk_signing_key: "RSAPrivateKey",
        clerk_settings: Settings,
    ) -> None:
        """A token without sub fails the require list → 401."""
        from core.auth import decode_clerk_jwt  # noqa: PLC0415

        token = mint_clerk_token(clerk_signing_key, omit=("sub",))
        with pytest.raises(HTTPException) as exc_info:
            decode_clerk_jwt(token, clerk_settings)

        assert exc_info.value.status_code == 401

    def test__missing_exp__rejected_401(
        self,
        clerk_signing_key: "RSAPrivateKey",
        clerk_settings: Settings,
    ) -> None:
        """A token without exp fails the require list → 401 (never-expiring tokens)."""
        from core.auth import decode_clerk_jwt  # noqa: PLC0415

        token = mint_clerk_token(clerk_signing_key, omit=("exp",))
        with pytest.raises(HTTPException) as exc_info:
            decode_clerk_jwt(token, clerk_settings)

        assert exc_info.value.status_code == 401


class TestClerkOAuthAccessTokens:
    """
    M4: the OAuth-access-token (`at+jwt`) parameterization of decode_clerk_jwt.

    The discriminator is the JWT header `typ` (signature-covered, read after
    verification) — deliberately NOT azp-absence, which would have made the
    azp check optional across the board. Session-token rules must be provably
    unchanged; the same-user test is the M4 Definition-of-Done requirement.
    """

    def test__valid_oauth_token__returns_payload(
        self,
        clerk_signing_key: "RSAPrivateKey",
        clerk_settings: Settings,
    ) -> None:
        """A validly signed at+jwt with client_id decodes; no email expected."""
        from core.auth import decode_clerk_jwt  # noqa: PLC0415

        token = mint_clerk_oauth_token(clerk_signing_key)
        payload = decode_clerk_jwt(token, clerk_settings).claims

        assert payload["sub"] == "user_test_clerk_id"
        assert payload["client_id"] == "zTESTclientid123"
        assert "email" not in payload
        assert "azp" not in payload

    def test__url_shaped_client_id__accepted_and_logged_at_info(
        self,
        clerk_signing_key: "RSAPrivateKey",
        clerk_settings: Settings,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """
        A CIMD client's `client_id` is its metadata URL; it is accepted (no
        allowlist, no format check — the security-review decision recorded in
        the docstring) and the accepted-token line reaches the log at INFO
        through the API's configured logging (stream routing is covered in
        test_logging_config.py).

        Before/after in one test: with `core` reset to the unconfigured state
        the line is dropped (the defect the logging setup fixes); after
        `configure_logging()` it is emitted. No `caplog.at_level` here — that
        would raise the logger level itself and mask the defect.
        """
        from core.auth import decode_clerk_jwt  # noqa: PLC0415

        cimd_client_id = "https://claude.ai/oauth/claude-code-client-metadata"
        token = mint_clerk_oauth_token(clerk_signing_key, client_id=cimd_client_id)
        # Snapshot every logger configure_logging touches, plus the root: the
        # "before" half needs root at WARNING (pytest's --log-level would raise
        # it), and the restore must cover all first-party loggers, not just `core`.
        root = logging.getLogger()
        saved_root_level = root.level
        saved = {
            name: (logging.getLogger(name).level, list(logging.getLogger(name).handlers))
            for name in FIRST_PARTY_LOGGERS
        }
        core_logger = logging.getLogger("core")
        try:
            root.setLevel(logging.WARNING)
            core_logger.setLevel(logging.NOTSET)
            core_logger.handlers[:] = []
            payload = decode_clerk_jwt(token, clerk_settings).claims
            assert payload["client_id"] == cimd_client_id
            assert "clerk_oauth_token_accepted" not in caplog.text

            configure_logging()
            payload = decode_clerk_jwt(token, clerk_settings).claims
            assert payload["client_id"] == cimd_client_id
        finally:
            root.setLevel(saved_root_level)
            for name, (level, handlers) in saved.items():
                logging.getLogger(name).setLevel(level)
                logging.getLogger(name).handlers[:] = handlers

        accepted = [
            r for r in caplog.records
            if r.name == "core.auth" and r.getMessage().startswith("clerk_oauth_token_accepted")
        ]
        assert len(accepted) == 1
        assert accepted[0].levelno == logging.INFO
        assert f"client_id={cimd_client_id}" in accepted[0].getMessage()
        assert "sub=user_test_clerk_id" in accepted[0].getMessage()
        assert accepted[0].getMessage().endswith(" kind=connector")

    def test__oauth_token_missing_client_id__rejected_401(
        self,
        clerk_signing_key: "RSAPrivateKey",
        clerk_settings: Settings,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """An at+jwt without client_id → 401 with a diagnosable warning."""
        from core.auth import decode_clerk_jwt  # noqa: PLC0415

        token = mint_clerk_oauth_token(clerk_signing_key, client_id=None)
        with caplog.at_level(logging.WARNING), pytest.raises(HTTPException) as exc_info:
            decode_clerk_jwt(token, clerk_settings)

        assert exc_info.value.status_code == 401
        assert exc_info.value.detail == "Invalid token"
        assert "missing client_id" in caplog.text

    def test__typ_comparison_is_case_insensitive(
        self,
        clerk_signing_key: "RSAPrivateKey",
        clerk_settings: Settings,
    ) -> None:
        """RFC 7515: `typ` compares case-insensitively — AT+JWT gets OAuth rules."""
        from core.auth import decode_clerk_jwt  # noqa: PLC0415

        token = mint_clerk_oauth_token(clerk_signing_key, client_id=None, typ="AT+JWT")
        with pytest.raises(HTTPException) as exc_info:
            decode_clerk_jwt(token, clerk_settings)

        assert exc_info.value.status_code == 401

    def test__full_media_type_typ_gets_oauth_rules(
        self,
        clerk_signing_key: "RSAPrivateKey",
        clerk_settings: Settings,
    ) -> None:
        """
        RFC 9068 §4 registers both `at+jwt` and `application/at+jwt`; the full
        form must also engage OAuth rules — otherwise a legal provider-side
        spelling change would silently reroute OAuth tokens to session rules,
        dropping the client_id requirement.
        """
        from core.auth import decode_clerk_jwt  # noqa: PLC0415

        token = mint_clerk_oauth_token(
            clerk_signing_key, client_id=None, typ="application/at+jwt",
        )
        with pytest.raises(HTTPException) as exc_info:
            decode_clerk_jwt(token, clerk_settings)

        assert exc_info.value.status_code == 401

    def test__azp_rule_still_applies_to_oauth_tokens(
        self,
        clerk_signing_key: "RSAPrivateKey",
        clerk_settings: Settings,
    ) -> None:
        """
        The present→check/absent→tolerate azp rule spans both token kinds:
        Clerk never sets azp on at+jwt, but if one arrives with a wrong azp it
        is rejected — the discriminator added OAuth rules without exempting
        OAuth tokens from session rules.
        """
        from core.auth import decode_clerk_jwt  # noqa: PLC0415

        token = mint_clerk_oauth_token(
            clerk_signing_key, azp="https://evil.example.com",
        )
        with pytest.raises(HTTPException) as exc_info:
            decode_clerk_jwt(token, clerk_settings)

        assert exc_info.value.status_code == 401

    def test__session_token_unaffected_by_oauth_rules(
        self,
        clerk_signing_key: "RSAPrivateKey",
        clerk_settings: Settings,
    ) -> None:
        """A typ:JWT session token without client_id still verifies (M1 rules)."""
        from core.auth import decode_clerk_jwt  # noqa: PLC0415

        token = mint_clerk_token(clerk_signing_key, azp=TEST_AUTHORIZED_PARTY)
        payload = decode_clerk_jwt(token, clerk_settings).claims

        assert "client_id" not in payload

    async def test__session_and_oauth_tokens_resolve_to_same_user(
        self,
        db_session: AsyncSession,
        redis_client: object,  # noqa: ARG002
        clerk_signing_key: "RSAPrivateKey",
        clerk_settings: Settings,
        connector_request: Request,
    ) -> None:
        """
        M4 Definition of Done: a session-shaped and an OAuth-shaped token with
        the same `sub` land on the same user row (same external_auth_id
        lookup; the email-less OAuth token neither blocks resolution nor
        clears the stored email).
        """
        from core.auth import AuthType, _authenticate_user  # noqa: PLC0415

        sub = "user_clerk_same_across_kinds"
        session_credentials = HTTPAuthorizationCredentials(
            scheme="Bearer",
            credentials=mint_clerk_token(
                clerk_signing_key, sub=sub, email="cli@test.com", email_verified=True,
            ),
        )
        session_user = await _authenticate_user(
            connector_request, session_credentials, db_session, clerk_settings, source="web",
        )

        oauth_credentials = HTTPAuthorizationCredentials(
            scheme="Bearer",
            credentials=mint_clerk_oauth_token(clerk_signing_key, sub=sub),
        )
        oauth_user = await _authenticate_user(
            connector_request, oauth_credentials, db_session, clerk_settings, source="cli",
        )

        assert oauth_user.id == session_user.id
        assert oauth_user.external_auth_id == sub
        assert oauth_user.email == "cli@test.com"  # null email did not clobber
        context = connector_request.state.request_context
        assert context.auth_type == AuthType.SESSION
        assert context.source == "cli"


class TestOAuthClientClassification:
    """
    The CLI's OAuth token is told apart from an AI app's ("connector") token by
    comparing the signed `client_id` to `clerk_cli_oauth_client_id`. The
    classification lands on the request context and the accepted-token log
    line; it never changes `auth_type`. What it blocks is tested in
    TestConnectorRouteLimits.
    """

    async def _authenticate(
        self,
        token: str,
        db_session: AsyncSession,
        settings: Settings,
        request: Request,
    ) -> User:
        from core.auth import _authenticate_user  # noqa: PLC0415

        credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
        return await _authenticate_user(
            request, credentials, db_session, settings, source="cli",
        )

    async def test__cli_client_id__classified_cli(
        self,
        db_session: AsyncSession,
        redis_client: object,  # noqa: ARG002
        clerk_signing_key: "RSAPrivateKey",
        clerk_settings: Settings,
        mock_request: Request,
    ) -> None:
        """The configured CLI client_id is the CLI's; auth_type stays SESSION."""
        token = mint_clerk_oauth_token(
            clerk_signing_key, sub="user_cli_kind", client_id=TEST_CLI_OAUTH_CLIENT_ID,
        )
        await self._authenticate(token, db_session, clerk_settings, mock_request)

        context = mock_request.state.request_context
        assert context.oauth_client_kind == "cli"
        assert context.oauth_client_id == TEST_CLI_OAUTH_CLIENT_ID
        assert context.auth_type == "session"

    async def test__claude_code_metadata_url__classified_connector(
        self,
        db_session: AsyncSession,
        redis_client: object,  # noqa: ARG002
        clerk_signing_key: "RSAPrivateKey",
        clerk_settings: Settings,
        connector_request: Request,
    ) -> None:
        """A CIMD client (client_id is its metadata URL) is a connector."""
        token = mint_clerk_oauth_token(
            clerk_signing_key, sub="user_cimd_kind", client_id=CLAUDE_CODE_CLIENT_ID,
        )
        await self._authenticate(token, db_session, clerk_settings, connector_request)

        context = connector_request.state.request_context
        assert context.oauth_client_kind == "connector"
        assert context.oauth_client_id == CLAUDE_CODE_CLIENT_ID
        assert context.auth_type == "session"

    async def test__dcr_style_client_id__classified_connector(
        self,
        db_session: AsyncSession,
        redis_client: object,  # noqa: ARG002
        clerk_signing_key: "RSAPrivateKey",
        clerk_settings: Settings,
        connector_request: Request,
    ) -> None:
        """An opaque Clerk-generated (DCR) client_id is a connector."""
        token = mint_clerk_oauth_token(
            clerk_signing_key, sub="user_dcr_kind", client_id="zTESTclientid123",
        )
        await self._authenticate(token, db_session, clerk_settings, connector_request)

        context = connector_request.state.request_context
        assert context.oauth_client_kind == "connector"
        assert context.oauth_client_id == "zTESTclientid123"

    @pytest.mark.parametrize(
        "near_miss",
        [
            TEST_CLI_OAUTH_CLIENT_ID.upper(),
            f"{TEST_CLI_OAUTH_CLIENT_ID}x",
            TEST_CLI_OAUTH_CLIENT_ID[:-1],
            f" {TEST_CLI_OAUTH_CLIENT_ID}",
        ],
    )
    async def test__near_miss_of_cli_client_id__classified_connector(
        self,
        near_miss: str,
        db_session: AsyncSession,
        redis_client: object,  # noqa: ARG002
        clerk_signing_key: "RSAPrivateKey",
        clerk_settings: Settings,
        connector_request: Request,
    ) -> None:
        """The compare is exact: case, prefix, suffix, and whitespace variants are connectors."""
        token = mint_clerk_oauth_token(
            clerk_signing_key, sub="user_near_miss_kind", client_id=near_miss,
        )
        await self._authenticate(token, db_session, clerk_settings, connector_request)

        assert connector_request.state.request_context.oauth_client_kind == "connector"

    async def test__session_token__no_classification(
        self,
        db_session: AsyncSession,
        redis_client: object,  # noqa: ARG002
        clerk_signing_key: "RSAPrivateKey",
        clerk_settings: Settings,
        mock_request: Request,
    ) -> None:
        """A session token is not an OAuth token: no client_id, no kind."""
        token = mint_clerk_token(
            clerk_signing_key, sub="user_session_kind", azp=TEST_AUTHORIZED_PARTY,
        )
        await self._authenticate(token, db_session, clerk_settings, mock_request)

        context = mock_request.state.request_context
        assert context.auth_type == "session"
        assert context.oauth_client_kind is None
        assert context.oauth_client_id is None

    async def test__pat__no_classification(
        self,
        db_session: AsyncSession,
        clerk_settings: Settings,
        mock_request: Request,
    ) -> None:
        """A PAT carries no OAuth classification."""
        from core.auth import _authenticate_user  # noqa: PLC0415
        from services import token_service  # noqa: PLC0415

        user = User(external_auth_id="user_pat_kind", email="pat@test.com")
        db_session.add(user)
        await db_session.flush()
        _, plaintext = await token_service.create_token(
            db_session, user.id, TokenCreate(name="kind test"), get_tier_limits(Tier.FREE),
        )

        credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=plaintext)
        await _authenticate_user(
            mock_request, credentials, db_session, clerk_settings, source="cli",
        )

        context = mock_request.state.request_context
        assert context.auth_type == "pat"
        assert context.oauth_client_kind is None
        assert context.oauth_client_id is None

    async def test__dev_mode__no_classification(
        self,
        db_session: AsyncSession,
        redis_client: object,  # noqa: ARG002
        clerk_signing_key: "RSAPrivateKey",
        clerk_settings: Settings,
        mock_request: Request,
    ) -> None:
        """Dev mode bypasses verification, so even a CLI-shaped token is unclassified."""
        clerk_settings.dev_mode = True
        token = mint_clerk_oauth_token(
            clerk_signing_key, client_id=TEST_CLI_OAUTH_CLIENT_ID,
        )
        await self._authenticate(token, db_session, clerk_settings, mock_request)

        context = mock_request.state.request_context
        assert context.auth_type == "dev"
        assert context.oauth_client_kind is None
        assert context.oauth_client_id is None

    def test__padded_cli_client_id_setting__still_matches_cli(
        self,
        clerk_signing_key: "RSAPrivateKey",
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """
        Whitespace around the configured value (e.g. a newline pasted into
        Railway) is trimmed when Settings reads it, so the CLI's token still
        classifies as CLI. The compare against the token's claim stays exact.
        """
        from core.auth import decode_clerk_jwt  # noqa: PLC0415

        monkeypatch.setenv("CLERK_CLI_OAUTH_CLIENT_ID", f"  {TEST_CLI_OAUTH_CLIENT_ID}\n")
        settings = Settings(
            _env_file=None,
            database_url="postgresql://test",
            VITE_DEV_MODE="false",
            CLERK_FRONTEND_API=TEST_CLERK_FRONTEND_API,
            CLERK_AUTHORIZED_PARTIES=TEST_AUTHORIZED_PARTY,
        )
        token = mint_clerk_oauth_token(
            clerk_signing_key, client_id=TEST_CLI_OAUTH_CLIENT_ID,
        )

        assert decode_clerk_jwt(token, settings).oauth_client_kind == "cli"

    def test__cli_token__logged_with_kind_cli(
        self,
        clerk_signing_key: "RSAPrivateKey",
        clerk_settings: Settings,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """The accepted-token line names the CLI as kind=cli, on the same one line."""
        from core.auth import decode_clerk_jwt  # noqa: PLC0415

        token = mint_clerk_oauth_token(
            clerk_signing_key, sub="user_cli_log", client_id=TEST_CLI_OAUTH_CLIENT_ID,
        )
        with caplog.at_level(logging.INFO, logger="core.auth"):
            decode_clerk_jwt(token, clerk_settings)

        accepted = [
            r.getMessage() for r in caplog.records
            if r.name == "core.auth" and r.getMessage().startswith("clerk_oauth_token_accepted")
        ]
        assert accepted == [
            f"clerk_oauth_token_accepted client_id={TEST_CLI_OAUTH_CLIENT_ID} "
            "sub=user_cli_log kind=cli",
        ]


CONNECTOR_FORBIDDEN_DETAIL = (
    "This endpoint is not available to AI-app connector tokens. Use the app's "
    "Tiddly tools, the web app, or a Personal Access Token."
)


def _assert_connector_forbidden(exc: HTTPException) -> None:
    assert exc.status_code == 403
    assert getattr(exc, "error_code", None) == "connector_forbidden"
    assert exc.detail == CONNECTOR_FORBIDDEN_DETAIL
    # The token is valid and only the route is refused, so no re-auth challenge.
    assert not exc.headers


class TestConnectorRouteLimits:
    """
    A connector token may call only the routes in core/connector_policy.py. The
    CLI's OAuth token, session tokens, and PATs are never checked against that
    list. Requests carry a real route from api.main.app, so the check reads the
    template FastAPI puts in the scope.
    """

    async def _authenticate(
        self,
        token: str,
        request: Request,
        db_session: AsyncSession,
        settings: Settings,
        *,
        allow_pat: bool = True,
    ) -> User:
        from core.auth import _authenticate_user  # noqa: PLC0415

        credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
        return await _authenticate_user(
            request, credentials, db_session, settings,
            source="mcp-content", allow_pat=allow_pat,
        )

    async def test__cli_token_accepted_on_session_only_route(
        self,
        db_session: AsyncSession,
        redis_client: object,  # noqa: ARG002
        clerk_signing_key: "RSAPrivateKey",
        clerk_settings: Settings,
    ) -> None:
        """
        The tripwire for `tiddly tokens` and `tiddly mcp configure`: the CLI's
        OAuth token passes the PAT block (allow_pat=False) on POST /tokens/. If
        this breaks, the CLI can no longer create, list, or delete PATs.
        """
        token = mint_clerk_oauth_token(
            clerk_signing_key, sub="user_cli_tokens_route", client_id=TEST_CLI_OAUTH_CLIENT_ID,
        )
        request = request_on_route("POST", "/tokens/")

        user = await self._authenticate(
            token, request, db_session, clerk_settings, allow_pat=False,
        )

        assert user.external_auth_id == "user_cli_tokens_route"
        assert request.state.request_context.oauth_client_kind == "cli"

    async def test__connector_token_on_session_only_route__403(
        self,
        db_session: AsyncSession,
        redis_client: object,  # noqa: ARG002
        clerk_signing_key: "RSAPrivateKey",
        clerk_settings: Settings,
    ) -> None:
        """A connector token can't create a PAT: POST /tokens/ is not on the list."""
        token = mint_clerk_oauth_token(
            clerk_signing_key, sub="user_connector_tokens_route", client_id=CLAUDE_CODE_CLIENT_ID,
        )

        with pytest.raises(HTTPException) as exc_info:
            await self._authenticate(
                token, request_on_route("POST", "/tokens/"), db_session, clerk_settings,
                allow_pat=False,
            )

        _assert_connector_forbidden(exc_info.value)

    async def test__connector_token_on_allowed_route__accepted(
        self,
        db_session: AsyncSession,
        redis_client: object,  # noqa: ARG002
        clerk_signing_key: "RSAPrivateKey",
        clerk_settings: Settings,
    ) -> None:
        token = mint_clerk_oauth_token(
            clerk_signing_key, sub="user_connector_allowed", client_id=CLAUDE_CODE_CLIENT_ID,
        )
        request = request_on_route("GET", "/bookmarks/")

        user = await self._authenticate(token, request, db_session, clerk_settings)

        assert user.external_auth_id == "user_connector_allowed"
        assert request.state.request_context.oauth_client_kind == "connector"

    async def test__connector_token_on_delete_route__403(
        self,
        db_session: AsyncSession,
        redis_client: object,  # noqa: ARG002
        clerk_signing_key: "RSAPrivateKey",
        clerk_settings: Settings,
    ) -> None:
        token = mint_clerk_oauth_token(
            clerk_signing_key, sub="user_connector_delete", client_id=CLAUDE_CODE_CLIENT_ID,
        )

        with pytest.raises(HTTPException) as exc_info:
            await self._authenticate(
                token, request_on_route("DELETE", "/bookmarks/{bookmark_id}"),
                db_session, clerk_settings,
            )

        _assert_connector_forbidden(exc_info.value)

    async def test__connector_token_without_matched_route__403(
        self,
        db_session: AsyncSession,
        redis_client: object,  # noqa: ARG002
        clerk_signing_key: "RSAPrivateKey",
        clerk_settings: Settings,
        mock_request: Request,
    ) -> None:
        """
        Pins the fail-closed default: called without a matched route, the check
        refuses a connector. Real requests always carry one, because the router
        answers HEAD, unknown paths, and slash redirects (405, 404, 307) before
        any dependency runs.
        """
        token = mint_clerk_oauth_token(
            clerk_signing_key, sub="user_connector_no_route", client_id=CLAUDE_CODE_CLIENT_ID,
        )

        with pytest.raises(HTTPException) as exc_info:
            await self._authenticate(token, mock_request, db_session, clerk_settings)

        _assert_connector_forbidden(exc_info.value)

    async def test__oauth_token_not_labeled_cli__403(
        self,
        db_session: AsyncSession,
        redis_client: object,  # noqa: ARG002
        clerk_signing_key: "RSAPrivateKey",
        clerk_settings: Settings,
    ) -> None:
        """
        Every OAuth token except the CLI's is limited, so a token that a future
        change labels some other way, or leaves unlabeled, can't get full access.
        """
        from core.auth import VerifiedClerkToken  # noqa: PLC0415

        token = mint_clerk_oauth_token(
            clerk_signing_key, sub="user_unlabeled_oauth", client_id="zTESTnewkind",
        )
        unlabeled = VerifiedClerkToken(
            claims={"sub": "user_unlabeled_oauth"},
            oauth_client_id="zTESTnewkind",
            oauth_client_kind=None,
        )

        with (
            patch("core.auth.decode_clerk_jwt", return_value=unlabeled),
            pytest.raises(HTTPException) as exc_info,
        ):
            await self._authenticate(
                token, request_on_route("DELETE", "/bookmarks/{bookmark_id}"),
                db_session, clerk_settings,
            )

        _assert_connector_forbidden(exc_info.value)

    @pytest.mark.parametrize(
        ("method", "path"),
        [("GET", "/bookmarks/"), ("DELETE", "/bookmarks/{bookmark_id}"), ("POST", "/tokens/")],
    )
    async def test__session_token_accepted_on_allowed_and_blocked_routes(
        self,
        method: str,
        path: str,
        db_session: AsyncSession,
        redis_client: object,  # noqa: ARG002
        clerk_signing_key: "RSAPrivateKey",
        clerk_settings: Settings,
    ) -> None:
        token = mint_clerk_token(
            clerk_signing_key, sub="user_session_routes", azp=TEST_AUTHORIZED_PARTY,
        )

        user = await self._authenticate(
            token, request_on_route(method, path), db_session, clerk_settings, allow_pat=False,
        )

        assert user.external_auth_id == "user_session_routes"

    async def test__blocked_request_logged_at_warning(
        self,
        db_session: AsyncSession,
        redis_client: object,  # noqa: ARG002
        clerk_signing_key: "RSAPrivateKey",
        clerk_settings: Settings,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """One WARNING line names the client, the user, and the refused route."""
        token = mint_clerk_oauth_token(
            clerk_signing_key, sub="user_connector_logged", client_id=CLAUDE_CODE_CLIENT_ID,
        )

        with (
            caplog.at_level(logging.INFO, logger="core.auth"),
            pytest.raises(HTTPException),
        ):
            await self._authenticate(
                token, request_on_route("DELETE", "/bookmarks/{bookmark_id}"),
                db_session, clerk_settings,
            )

        blocked = [
            (r.levelno, r.getMessage()) for r in caplog.records
            if r.name == "core.auth" and r.getMessage().startswith("connector_token_blocked")
        ]
        assert blocked == [(
            logging.WARNING,
            f"connector_token_blocked client_id={CLAUDE_CODE_CLIENT_ID} "
            "sub=user_connector_logged method=DELETE route=/bookmarks/{bookmark_id}",
        )]

    @pytest.mark.parametrize("token_kind", ["cli", "session", "pat"])
    async def test__first_party_token_never_blocked_on_any_route(
        self,
        token_kind: str,
        db_session: AsyncSession,
        redis_client: object,  # noqa: ARG002
        clerk_signing_key: "RSAPrivateKey",
        clerk_settings: Settings,
    ) -> None:
        """
        The CLI's OAuth token, a session token, and a PAT pass the route check
        on every route the app has, not only the ones the CLI calls today. A
        wrong CLI label would surface here as a long list of refused routes.
        """
        from api.main import app  # noqa: PLC0415
        from services import token_service  # noqa: PLC0415

        sub = f"user_never_blocked_{token_kind}"
        if token_kind == "cli":
            token = mint_clerk_oauth_token(
                clerk_signing_key, sub=sub, client_id=TEST_CLI_OAUTH_CLIENT_ID,
            )
        elif token_kind == "session":
            token = mint_clerk_token(clerk_signing_key, sub=sub, azp=TEST_AUTHORIZED_PARTY)
        else:
            user = User(external_auth_id=sub, email="pat-routes@test.com")
            db_session.add(user)
            await db_session.flush()
            _, token = await token_service.create_token(
                db_session, user.id, TokenCreate(name="route test"), get_tier_limits(Tier.FREE),
            )

        routes = [
            (method, route.path)
            for route in app.routes
            if isinstance(route, APIRoute)
            for method in sorted(route.methods)
        ]
        refused = []
        for method, path in routes:
            try:
                await self._authenticate(
                    token, request_on_route(method, path), db_session, clerk_settings,
                )
            except HTTPException as exc:
                refused.append((method, path, exc.status_code))

        assert len(routes) > 90  # the walk really covered the app
        assert refused == []


class TestIssuerDispatch:
    """Issuer routing in _authenticate_user."""

    async def test__clerk_token__authenticates_and_jit_provisions(
        self,
        db_session: AsyncSession,
        redis_client: object,  # noqa: ARG002
        clerk_signing_key: "RSAPrivateKey",
        clerk_settings: Settings,
        mock_request: Request,
    ) -> None:
        """Happy path: Clerk token → user JIT-created by external_auth_id."""
        from core.auth import AuthType, _authenticate_user  # noqa: PLC0415

        sub = "user_clerk_jit_happy"
        credentials = HTTPAuthorizationCredentials(
            scheme="Bearer",
            credentials=mint_clerk_token(
                clerk_signing_key, sub=sub, email="jit@test.com", email_verified=True,
            ),
        )

        user = await _authenticate_user(
            mock_request, credentials, db_session, clerk_settings, source="web",
        )

        assert user.external_auth_id == sub
        assert user.email == "jit@test.com"
        assert user.email_verified is True
        context = mock_request.state.request_context
        assert context.auth_type == AuthType.SESSION
        assert context.source == "web"

    async def test__unknown_issuer__rejected_401(
        self,
        db_session: AsyncSession,
        clerk_signing_key: "RSAPrivateKey",
        clerk_settings: Settings,
        mock_request: Request,
    ) -> None:
        """A JWT from an issuer that is neither Auth0 nor Clerk → generic 401."""
        from core.auth import _authenticate_user  # noqa: PLC0415

        credentials = HTTPAuthorizationCredentials(
            scheme="Bearer",
            credentials=mint_clerk_token(
                clerk_signing_key, issuer="https://unknown-idp.example.com",
            ),
        )

        with pytest.raises(HTTPException) as exc_info:
            await _authenticate_user(
                mock_request, credentials, db_session, clerk_settings, source="web",
            )

        assert exc_info.value.status_code == 401
        assert exc_info.value.detail == "Invalid token"

    async def test__missing_issuer__rejected_401(
        self,
        db_session: AsyncSession,
        clerk_signing_key: "RSAPrivateKey",
        clerk_settings: Settings,
        mock_request: Request,
    ) -> None:
        """A JWT with no iss claim at all → generic 401."""
        from core.auth import _authenticate_user  # noqa: PLC0415

        credentials = HTTPAuthorizationCredentials(
            scheme="Bearer",
            credentials=mint_clerk_token(clerk_signing_key, omit=("iss",)),
        )

        with pytest.raises(HTTPException) as exc_info:
            await _authenticate_user(
                mock_request, credentials, db_session, clerk_settings, source="web",
            )

        assert exc_info.value.status_code == 401

    async def test__opaque_bearer__clean_401_with_warning_log(
        self,
        db_session: AsyncSession,
        clerk_settings: Settings,
        mock_request: Request,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """
        A non-PAT bearer that isn't a JWT → clean 401 (not 500) + warning log.

        This is the observable symptom of a Clerk OAuth app misconfigured to
        issue opaque tokens (M4/M5 operator requirement).
        """
        from core.auth import _authenticate_user  # noqa: PLC0415

        credentials = HTTPAuthorizationCredentials(
            scheme="Bearer",
            credentials="opaque_token_not_a_jwt_at_all",
        )

        with (
            caplog.at_level(logging.WARNING, logger="core.auth"),
            pytest.raises(HTTPException) as exc_info,
        ):
            await _authenticate_user(
                mock_request, credentials, db_session, clerk_settings, source="cli",
            )

        assert exc_info.value.status_code == 401
        assert exc_info.value.detail == "Invalid token"
        assert any("not parseable as a JWT" in r.message for r in caplog.records)

    async def test__clerk_issuer_token_with_bad_signature__rejected(
        self,
        db_session: AsyncSession,
        clerk_settings: Settings,
        mock_request: Request,
    ) -> None:
        """
        Issuer confusion guard: a token CLAIMING the Clerk issuer but signed
        with a different key never validates — dispatch only selects the
        verifier; the verifier still enforces the signature.
        """
        from core.auth import _authenticate_user  # noqa: PLC0415

        attacker_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        credentials = HTTPAuthorizationCredentials(
            scheme="Bearer",
            credentials=mint_clerk_token(attacker_key, sub="user_forged"),
        )

        with pytest.raises(HTTPException) as exc_info:
            await _authenticate_user(
                mock_request, credentials, db_session, clerk_settings, source="web",
            )

        assert exc_info.value.status_code == 401
        # And no user row was created for the forged sub
        result = await db_session.execute(
            select(User).where(User.external_auth_id == "user_forged"),
        )
        assert result.scalar_one_or_none() is None

    async def test__auth0_issuer_token__rejected_as_unknown_issuer(
        self,
        db_session: AsyncSession,
        clerk_settings: Settings,
        mock_request: Request,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """
        M6b decommission invariant: a token carrying the old Auth0 issuer is
        an unknown issuer now — generic 401 at dispatch, verifier never
        invoked, no user row. The token is an old-issuer placeholder rejected
        before verifier selection (signature is never examined here); the
        genuinely-valid-Auth0-token proof is the run sheet's H3 production
        check, not this unit test.
        """
        from core.auth import _authenticate_user  # noqa: PLC0415

        # Pin the retained Settings field to the value the token carries: if
        # the Auth0 dispatch arm were ever restored, the issuer comparison
        # must genuinely match and route into verification — which the JWKS
        # patch below turns into a loud failure. On the bare MagicMock the
        # comparison would be False for the wrong reason and a restored arm
        # would go undetected.
        clerk_settings.auth0_issuer = TEST_AUTH0_ISSUER
        sub = "legacy|straggler-after-decommission"
        token = jwt.encode({"iss": TEST_AUTH0_ISSUER, "sub": sub}, "unused-test-key-0123456789abcdef", algorithm="HS256")
        credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)

        with (
            caplog.at_level(logging.WARNING, logger="core.auth"),
            patch(
                "core.auth.get_jwks_client",
                side_effect=AssertionError(
                    "verifier boundary reached for an old-issuer token — "
                    "the Auth0 dispatch arm has been reintroduced",
                ),
            ) as jwks_boundary,
            pytest.raises(HTTPException) as exc_info,
        ):
            await _authenticate_user(
                mock_request, credentials, db_session, clerk_settings, source="ios",
            )

        jwks_boundary.assert_not_called()
        assert exc_info.value.status_code == 401
        assert exc_info.value.detail == "Invalid token"
        assert exc_info.value.headers["WWW-Authenticate"] == "Bearer"
        assert any("unknown or missing issuer" in r.message for r in caplog.records)
        result = await db_session.execute(
            select(User).where(User.external_auth_id == sub),
        )
        assert result.scalar_one_or_none() is None


class TestJitCreateFlags:
    """Clerk JIT-create gating (single-issuer world since M6b)."""

    async def test__clerk_create_disabled__unknown_identity_401_with_log(
        self,
        db_session: AsyncSession,
        redis_client: object,  # noqa: ARG002
        clerk_signing_key: "RSAPrivateKey",
        clerk_settings: Settings,
        mock_request: Request,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """Clerk JIT-create off: valid token for an unknown sub → 401 + warning."""
        from core.auth import _authenticate_user  # noqa: PLC0415

        clerk_settings.clerk_jit_create_enabled = False
        sub = "user_clerk_create_denied"
        credentials = HTTPAuthorizationCredentials(
            scheme="Bearer",
            credentials=mint_clerk_token(clerk_signing_key, sub=sub),
        )

        with (
            caplog.at_level(logging.WARNING, logger="core.auth"),
            pytest.raises(HTTPException) as exc_info,
        ):
            await _authenticate_user(
                mock_request, credentials, db_session, clerk_settings, source="web",
            )

        assert exc_info.value.status_code == 401
        assert exc_info.value.detail == "Invalid token"
        assert any(
            "JIT user creation rejected" in r.message and sub in r.getMessage()
            for r in caplog.records
        )
        result = await db_session.execute(
            select(User).where(User.external_auth_id == sub),
        )
        assert result.scalar_one_or_none() is None

    async def test__clerk_create_disabled__existing_user_still_authenticates(
        self,
        db_session: AsyncSession,
        redis_client: object,  # noqa: ARG002
        clerk_signing_key: "RSAPrivateKey",
        clerk_settings: Settings,
        mock_request: Request,
    ) -> None:
        """Lookup is unaffected by the create gate in every flag state."""
        from core.auth import _authenticate_user  # noqa: PLC0415

        sub = "user_clerk_lookup_ok"
        existing = User(external_auth_id=sub, email="lookup@test.com")
        db_session.add(existing)
        await db_session.flush()

        clerk_settings.clerk_jit_create_enabled = False
        credentials = HTTPAuthorizationCredentials(
            scheme="Bearer",
            credentials=mint_clerk_token(clerk_signing_key, sub=sub),
        )

        user = await _authenticate_user(
            mock_request, credentials, db_session, clerk_settings, source="web",
        )

        assert user.id == existing.id


class TestClerkUserResolution:
    """get_or_create_user keyed by external_auth_id (JIT, sync rules, race)."""

    async def test__creates_user_by_external_auth_id(
        self,
        db_session: AsyncSession,
        redis_client: object,  # noqa: ARG002
    ) -> None:
        """A Clerk-keyed create resolves and persists the identity."""
        from core.auth import get_or_create_user  # noqa: PLC0415

        user = await get_or_create_user(
            db_session,
            external_auth_id="user_resolution_create",
            email="res@test.com",
            email_verified=True,
        )
        await db_session.commit()

        assert user.external_auth_id == "user_resolution_create"
        assert user.email == "res@test.com"

    async def test__email_sync_rules_apply_on_clerk_path(
        self,
        db_session: AsyncSession,
        redis_client: object,  # noqa: ARG002
    ) -> None:
        """Null email never overwrites a value; a new value updates (same as Auth0 path)."""
        from core.auth import get_or_create_user  # noqa: PLC0415
        from core.auth_cache import get_auth_cache  # noqa: PLC0415

        ext_id = "user_email_sync"
        user1 = await get_or_create_user(
            db_session, external_auth_id=ext_id, email="first@test.com",
        )
        await db_session.commit()

        auth_cache = get_auth_cache()
        if auth_cache:
            await auth_cache.invalidate(user1.id, external_auth_id=ext_id)

        # Null email does not overwrite
        user2 = await get_or_create_user(db_session, external_auth_id=ext_id, email=None)
        assert user2.email == "first@test.com"

        if auth_cache:
            await auth_cache.invalidate(user1.id, external_auth_id=ext_id)

        # Changed email updates
        user3 = await get_or_create_user(
            db_session, external_auth_id=ext_id, email="second@test.com",
        )
        await db_session.commit()
        assert user3.id == user1.id
        assert user3.email == "second@test.com"

    async def test__cache_hit_returns_cached_user(
        self,
        db_session: AsyncSession,
        redis_client: object,  # noqa: ARG002
    ) -> None:
        """
        Resolution is served from the ext cache segment once a *committed* row
        has been read. A freshly-created user is deliberately not cached (see
        test__freshly_created_user_not_cached_until_committed), so the cache is
        populated on the first post-commit read and served on the next.
        """
        from core.auth import get_or_create_user  # noqa: PLC0415
        from schemas.cached_user import CachedUser  # noqa: PLC0415

        ext_id = "user_cache_roundtrip"
        await get_or_create_user(db_session, external_auth_id=ext_id, email="c@test.com")
        await db_session.commit()

        # First post-commit resolution reads the committed row and caches it
        first = await get_or_create_user(
            db_session, external_auth_id=ext_id, email="c@test.com",
        )
        assert isinstance(first, User)

        # The next resolution is served from cache
        result = await get_or_create_user(
            db_session, external_auth_id=ext_id, email="c@test.com",
        )
        assert isinstance(result, CachedUser)
        assert result.external_auth_id == ext_id

    async def test__freshly_created_user_not_cached_until_committed(
        self,
        db_session: AsyncSession,
        redis_client: object,  # noqa: ARG002
    ) -> None:
        """
        A user created in THIS request must not be cached: the row is only
        flushed, not committed, so if the request rolls back, a cached entry
        would serve a phantom user for the 5-min TTL and the next write against
        it would 500 on a foreign-key violation. Regression for an observed 500.

        The rollback that originally produced it was the consent gate 451-ing a
        brand-new user's first request. That gate is gone (consent
        simplification, 2026-08-01) and this test is deliberately NOT deleted
        with it: the row stays uncommitted until the request commits, and the
        session rolls back on any exception raised after this point. The
        reachable case now is the route handler — a brand-new user whose first
        request 404s on a nonexistent id loses the row with it.

        The rollback below is triggered directly rather than through whichever
        mechanism happens to be reachable today, so the test outlives the
        example. See core/auth.py's `if created:` comment.
        """
        from core.auth import get_or_create_user  # noqa: PLC0415
        from core.auth_cache import get_auth_cache  # noqa: PLC0415

        ext_id = "user_phantom_cache"
        user = await get_or_create_user(
            db_session, external_auth_id=ext_id, email="p@test.com",
        )
        assert user.external_auth_id == ext_id

        # The just-created, still-uncommitted user is NOT cached
        auth_cache = get_auth_cache()
        assert auth_cache is not None
        assert await auth_cache.get_by_external_auth_id(ext_id) is None

        # The request fails after creation (e.g. the route handler 404s)
        await db_session.rollback()

        # No phantom survives: neither a committed row nor a cache entry
        assert await auth_cache.get_by_external_auth_id(ext_id) is None
        result = await db_session.execute(
            select(User).where(User.external_auth_id == ext_id),
        )
        assert result.scalar_one_or_none() is None


class TestClerkRaceCondition:
    """Race-condition recovery on the external_auth_id unique constraint."""

    async def test__integrity_error_recovers_to_existing_user(
        self,
        db_session: AsyncSession,
        redis_client: object,  # noqa: ARG002
    ) -> None:
        """A lost INSERT race on external_auth_id recovers by re-fetching."""
        from core.auth import get_or_create_user  # noqa: PLC0415

        ext_id = "user_race_clerk"
        existing = User(external_auth_id=ext_id, email="race@test.com")
        db_session.add(existing)
        # Commit so the row survives the rollback inside the recovery path
        # (in production the winning request's transaction has committed).
        await db_session.commit()
        existing_id = existing.id

        # Simulate the race: the initial SELECT misses (patched to look up a
        # nonexistent id), the INSERT then hits the unique constraint, and
        # recovery re-selects the real row.
        from services import user_service  # noqa: PLC0415
        original_create = user_service.create_user_with_defaults

        call_state = {"first_select_skipped": False}
        original_execute = db_session.execute

        async def execute_with_race(stmt: object, *args: object, **kwargs: object) -> object:
            stmt_str = str(stmt).lower()
            if (
                "users" in stmt_str
                and "select" in stmt_str
                and "external_auth_id" in stmt_str
                and not call_state["first_select_skipped"]
            ):
                call_state["first_select_skipped"] = True
                return await original_execute(
                    select(User).where(User.external_auth_id == "user_nonexistent"),
                )
            return await original_execute(stmt, *args, **kwargs)

        with patch.object(db_session, "execute", side_effect=execute_with_race):
            user = await get_or_create_user(
                db_session, external_auth_id=ext_id, email="race@test.com",
            )

        assert user.id == existing_id
        assert original_create is user_service.create_user_with_defaults


class TestJwksUnavailable:
    """
    Provider JWKS unreachable → 503 (retryable outage), never 401 (bad token).

    PyJWKClientConnectionError subclasses PyJWTError, so without the explicit
    catch it would map to a generic 401 — which the frontend treats as
    "sign the user out". These raise from the mock client's
    get_signing_key_from_jwt, mirroring where the real failure occurs.
    """

    @staticmethod
    def _broken_jwks_client(error: Exception) -> MagicMock:
        client = MagicMock()
        client.get_signing_key_from_jwt.side_effect = error
        return client

    def test__clerk_jwks_connection_failure__503(
        self,
        clerk_signing_key: "RSAPrivateKey",
        clerk_settings: Settings,
    ) -> None:
        from core.auth import decode_clerk_jwt  # noqa: PLC0415

        broken = self._broken_jwks_client(
            jwt.PyJWKClientConnectionError("connection refused"),
        )
        token = mint_clerk_token(clerk_signing_key)
        with (
            patch("core.auth.get_jwks_client", return_value=broken),
            pytest.raises(HTTPException) as exc_info,
        ):
            decode_clerk_jwt(token, clerk_settings)

        assert exc_info.value.status_code == 503
        assert exc_info.value.detail == "Could not validate credentials"

    def test__clerk_unknown_signing_key__401(
        self,
        clerk_signing_key: "RSAPrivateKey",
        clerk_settings: Settings,
    ) -> None:
        """
        A JWKS *content* problem (e.g. unknown kid) stays a 401 — the
        provider is reachable; the token just doesn't verify.
        """
        from core.auth import decode_clerk_jwt  # noqa: PLC0415

        broken = self._broken_jwks_client(
            jwt.exceptions.PyJWKClientError("Unable to find a signing key"),
        )
        token = mint_clerk_token(clerk_signing_key)
        with (
            patch("core.auth.get_jwks_client", return_value=broken),
            pytest.raises(HTTPException) as exc_info,
        ):
            decode_clerk_jwt(token, clerk_settings)

        assert exc_info.value.status_code == 401
        assert exc_info.value.detail == "Invalid token"


class TestDeletedIdentityResurrection:
    """
    M8 anti-resurrection guard: tombstoned identities cannot JIT-recreate
    users, with the explicit deleted-account 401.
    """

    async def test__stale_clerk_jwt_after_deletion__explicit_401_no_resurrection(
        self,
        db_session: AsyncSession,
        redis_client: object,  # noqa: ARG002
        clerk_signing_key: "RSAPrivateKey",
        clerk_settings: Settings,
        mock_request: Request,
    ) -> None:
        """A still-valid Clerk JWT after deletion gets 401, not a fresh row."""
        from core.auth import _authenticate_user  # noqa: PLC0415
        from services.user_service import (  # noqa: PLC0415
            delete_user_by_external_auth_id,
        )

        sub = "user_deleted_but_token_lives"
        user = User(external_auth_id=sub, email="stale@test.com")
        db_session.add(user)
        await db_session.flush()
        # Token minted while the account existed, still hours from expiry
        token = mint_clerk_token(clerk_signing_key, sub=sub, lifetime_seconds=3600)

        assert (await delete_user_by_external_auth_id(db_session, sub)).deleted is True

        credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
        with pytest.raises(HTTPException) as exc_info:
            await _authenticate_user(
                mock_request, credentials, db_session, clerk_settings, source="web",
            )

        assert exc_info.value.status_code == 401
        assert exc_info.value.detail == "This account was deleted"
        assert exc_info.value.error_code == "account_deleted"
        result = await db_session.execute(
            select(User).where(User.external_auth_id == sub),
        )
        assert result.scalar_one_or_none() is None

    async def test__cached_then_deleted__next_call_clean_401_not_500(
        self,
        db_session: AsyncSession,
        redis_client: object,  # noqa: ARG002
        clerk_signing_key: "RSAPrivateKey",
        clerk_settings: Settings,
        mock_request: Request,
    ) -> None:
        """
        A user cached by a recent request, then deleted: the next call misses
        the (invalidated) cache, misses the DB, hits the tombstone — a clean
        401 instead of authenticating into foreign-key 500s. Invalidation
        happens caller-side after commit (the webhook route's semantics),
        not inside the service — mirrored here.
        """
        from core.auth import _authenticate_user  # noqa: PLC0415
        from core.auth_cache import get_auth_cache  # noqa: PLC0415
        from services.user_service import (  # noqa: PLC0415
            delete_user_by_external_auth_id,
        )

        sub = "user_cached_then_deleted"
        token = mint_clerk_token(clerk_signing_key, sub=sub, lifetime_seconds=3600)
        credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)

        # First request JIT-creates the user (freshly-created users are not
        # cached); the second reads the now-existing row and caches it.
        for _ in range(2):
            await _authenticate_user(
                mock_request, credentials, db_session, clerk_settings, source="web",
            )
        auth_cache = get_auth_cache()
        assert auth_cache is not None
        assert await auth_cache.get_by_external_auth_id(sub) is not None

        deletion = await delete_user_by_external_auth_id(db_session, sub)
        assert deletion.deleted is True
        await auth_cache.invalidate(  # the route does this after commit
            deletion.user_id,
            external_auth_id=deletion.external_auth_id,
        )
        assert await auth_cache.get_by_external_auth_id(sub) is None

        with pytest.raises(HTTPException) as exc_info:
            await _authenticate_user(
                mock_request, credentials, db_session, clerk_settings, source="web",
            )
        assert exc_info.value.status_code == 401
        assert exc_info.value.detail == "This account was deleted"
        assert exc_info.value.error_code == "account_deleted"

    async def test__tombstone_does_not_block_new_identities(
        self,
        db_session: AsyncSession,
        redis_client: object,  # noqa: ARG002
        clerk_signing_key: "RSAPrivateKey",
        clerk_settings: Settings,
        mock_request: Request,
    ) -> None:
        """
        Tombstones block dead credentials, not people: a deleted user who
        signs up again arrives with a brand-new Clerk ID that no tombstone
        matches, and JIT provisioning works normally.
        """
        from core.auth import _authenticate_user  # noqa: PLC0415
        from services.user_service import (  # noqa: PLC0415
            delete_user_by_external_auth_id,
        )

        old_sub = "user_first_account"
        user = User(external_auth_id=old_sub, email="comeback@test.com")
        db_session.add(user)
        await db_session.flush()
        assert (await delete_user_by_external_auth_id(db_session, old_sub)).deleted is True

        new_sub = "user_second_account"
        credentials = HTTPAuthorizationCredentials(
            scheme="Bearer",
            credentials=mint_clerk_token(
                clerk_signing_key, sub=new_sub, email="comeback@test.com",
            ),
        )
        recreated = await _authenticate_user(
            mock_request, credentials, db_session, clerk_settings, source="web",
        )
        assert recreated.external_auth_id == new_sub

    async def test__recheck_eviction_failure__still_401_and_logged(
        self,
        db_session: AsyncSession,
        redis_client: object,  # noqa: ARG002
        clerk_signing_key: "RSAPrivateKey",
        clerk_settings: Settings,
        mock_request: Request,
        monkeypatch: pytest.MonkeyPatch,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """
        Redis fails open: if the post-population recheck detects a tombstone
        but cannot evict the entry it just wrote, the request must still be
        rejected with the deleted-account 401 and the failure logged loudly
        (the documented TTL-bounded residual).
        """
        from core.auth import _authenticate_user  # noqa: PLC0415
        from core.redis import RedisClient  # noqa: PLC0415

        # Artificial coexistence: user row AND tombstone both present — the
        # mid-race state the recheck exists to catch on the lookup path.
        sub = "user_recheck_evict_fails"
        user = User(external_auth_id=sub, email="evict@test.com")
        db_session.add(user)
        db_session.add(DeletedIdentity(external_auth_id=sub))
        await db_session.flush()

        async def failing_delete(self: RedisClient, *keys: str) -> bool:  # noqa: ARG001
            return False

        monkeypatch.setattr(RedisClient, "delete", failing_delete)

        token = mint_clerk_token(clerk_signing_key, sub=sub)
        credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
        with (
            caplog.at_level(logging.ERROR, logger="core.auth"),
            pytest.raises(HTTPException) as exc_info,
        ):
            await _authenticate_user(
                mock_request, credentials, db_session, clerk_settings, source="web",
            )

        assert exc_info.value.status_code == 401
        assert exc_info.value.detail == "This account was deleted"
        assert exc_info.value.error_code == "account_deleted"
        assert any(
            "tombstone_recheck_eviction_failed" in r.message for r in caplog.records
        )
