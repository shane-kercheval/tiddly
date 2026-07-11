"""
Tests for the Clerk half of dual-accept token verification (M1).

Unlike the Auth0-path tests (which patch decode_jwt), these mint REAL RS256
JWTs with a test keypair and patch only the JWKS client — the azp rule,
clock-skew leeway, and expiry checks live inside decode_clerk_jwt, so patching
the decoder would bypass exactly what needs testing.

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
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import Settings
from models.user import User

if TYPE_CHECKING:
    from cryptography.hazmat.primitives.asymmetric.rsa import RSAPrivateKey

TEST_CLERK_FRONTEND_API = "test-instance.clerk.accounts.dev"
TEST_CLERK_ISSUER = f"https://{TEST_CLERK_FRONTEND_API}"
TEST_AUTHORIZED_PARTY = "http://localhost:5173"
TEST_AUTH0_ISSUER = "https://test-tenant.auth0.com/"


@pytest.fixture(scope="module")
def clerk_signing_key() -> "RSAPrivateKey":
    """Test RSA keypair standing in for the Clerk instance's JWKS key."""
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture
def mock_request() -> Request:
    """Create a mock request for auth tests."""
    request = MagicMock(spec=Request)
    request.headers = {}
    request.state = MagicMock()
    return request


@pytest.fixture
def clerk_settings() -> Settings:
    """Mock settings with the Clerk dual-accept configuration populated."""
    settings = MagicMock(spec=Settings)
    settings.dev_mode = False
    settings.frontend_url = "http://localhost:5173"
    settings.api_url = "http://localhost:8000"
    settings.auth0_issuer = TEST_AUTH0_ISSUER
    settings.auth0_custom_claim_namespace = "https://test.example.com"
    settings.auth0_jit_create_enabled = True
    settings.clerk_frontend_api = TEST_CLERK_FRONTEND_API
    settings.clerk_issuer = TEST_CLERK_ISSUER
    settings.clerk_jwks_url = f"{TEST_CLERK_ISSUER}/.well-known/jwks.json"
    settings.clerk_authorized_parties = [TEST_AUTHORIZED_PARTY]
    settings.clerk_jit_create_enabled = True
    return settings


def mint_clerk_token(
    signing_key: "RSAPrivateKey",
    sub: str = "user_test_clerk_id",
    *,
    azp: str | None = None,
    email: str | None = None,
    email_verified: bool | None = None,
    issuer: str = TEST_CLERK_ISSUER,
    lifetime_seconds: int = 60,
    exp: int | None = None,
    omit: tuple[str, ...] = (),
) -> str:
    """Mint a real RS256 session token shaped like Clerk's (60s lifetime)."""
    now = int(time.time())
    claims: dict = {
        "iss": issuer,
        "sub": sub,
        "iat": now,
        "exp": exp if exp is not None else now + lifetime_seconds,
    }
    if azp is not None:
        claims["azp"] = azp
    if email is not None:
        claims["email"] = email
    if email_verified is not None:
        claims["email_verified"] = email_verified
    for claim in omit:
        claims.pop(claim, None)
    return jwt.encode(claims, signing_key, algorithm="RS256")


class _FakeJWKSClient:
    """Stands in for PyJWKClient; serves the test public key for any token."""

    def __init__(self, signing_key: "RSAPrivateKey") -> None:
        self._public_key = signing_key.public_key()

    def get_signing_key_from_jwt(self, token: str) -> MagicMock:  # noqa: ARG002
        entry = MagicMock()
        entry.key = self._public_key
        return entry


@pytest.fixture(autouse=True)
def patched_jwks(clerk_signing_key: "RSAPrivateKey") -> Generator[_FakeJWKSClient]:
    """
    Patch the JWKS client so verification uses the test public key.

    Autouse: most tests in this module verify real signatures; the few that
    never reach JWKS (opaque bearer, patched Auth0 decode) are unaffected.
    """
    fake = _FakeJWKSClient(clerk_signing_key)
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
        payload = decode_clerk_jwt(token, clerk_settings)

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
        payload = decode_clerk_jwt(token, clerk_settings)

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
        payload = decode_clerk_jwt(token, clerk_settings)

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
        payload = decode_clerk_jwt(token, clerk_settings)

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
        assert user.auth0_id is None
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

    async def test__auth0_path__emits_source_log_line(
        self,
        db_session: AsyncSession,
        redis_client: object,  # noqa: ARG002
        clerk_settings: Settings,
        mock_request: Request,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """
        Every Auth0-path authentication logs the resolved request source
        (the M6a→M6b cutover signal).
        """
        from core.auth import _authenticate_user  # noqa: PLC0415

        sub = "auth0|log-line-test"
        token = jwt.encode({"iss": TEST_AUTH0_ISSUER, "sub": sub}, "unused-test-key-0123456789abcdef", algorithm="HS256")
        credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)

        with (
            caplog.at_level(logging.INFO, logger="core.auth"),
            patch("core.auth.decode_jwt", return_value={"sub": sub}),
        ):
            await _authenticate_user(
                mock_request, credentials, db_session, clerk_settings, source="ios",
            )

        assert any(
            "auth0_path_authentication" in r.message and "source=ios" in r.getMessage()
            for r in caplog.records
        )


class TestJitCreateFlags:
    """Per-issuer JIT-create gating (AD5 window rules, backend-enforced)."""

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

    async def test__auth0_create_disabled__unknown_identity_401_with_log(
        self,
        db_session: AsyncSession,
        redis_client: object,  # noqa: ARG002
        clerk_settings: Settings,
        mock_request: Request,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """Auth0 JIT-create off (M6a flip state): unknown Auth0 sub → 401 + warning."""
        from core.auth import _authenticate_user  # noqa: PLC0415

        clerk_settings.auth0_jit_create_enabled = False
        sub = "auth0|straggler-after-flip"
        token = jwt.encode({"iss": TEST_AUTH0_ISSUER, "sub": sub}, "unused-test-key-0123456789abcdef", algorithm="HS256")
        credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)

        with (
            caplog.at_level(logging.WARNING, logger="core.auth"),
            patch("core.auth.decode_jwt", return_value={"sub": sub}),
            pytest.raises(HTTPException) as exc_info,
        ):
            await _authenticate_user(
                mock_request, credentials, db_session, clerk_settings, source="web",
            )

        assert exc_info.value.status_code == 401
        assert any("JIT user creation rejected" in r.message for r in caplog.records)

    async def test__auth0_create_disabled__existing_user_still_authenticates(
        self,
        db_session: AsyncSession,
        redis_client: object,  # noqa: ARG002
        clerk_settings: Settings,
        mock_request: Request,
    ) -> None:
        """The iOS-during-window scenario: existing Auth0 users keep working."""
        from core.auth import _authenticate_user  # noqa: PLC0415

        sub = "auth0|existing-ios-user"
        existing = User(auth0_id=sub, email="ios@test.com")
        db_session.add(existing)
        await db_session.flush()

        clerk_settings.auth0_jit_create_enabled = False
        token = jwt.encode({"iss": TEST_AUTH0_ISSUER, "sub": sub}, "unused-test-key-0123456789abcdef", algorithm="HS256")
        credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)

        with patch("core.auth.decode_jwt", return_value={"sub": sub}):
            user = await _authenticate_user(
                mock_request, credentials, db_session, clerk_settings, source="ios",
            )

        assert user.id == existing.id


class TestClerkUserResolution:
    """get_or_create_user keyed by external_auth_id (JIT, sync rules, race)."""

    async def test__creates_user_by_external_auth_id(
        self,
        db_session: AsyncSession,
        redis_client: object,  # noqa: ARG002
    ) -> None:
        """A Clerk-keyed create leaves auth0_id NULL (identity invariant holds)."""
        from core.auth import get_or_create_user  # noqa: PLC0415

        user = await get_or_create_user(
            db_session,
            external_auth_id="user_resolution_create",
            email="res@test.com",
            email_verified=True,
        )
        await db_session.commit()

        assert user.external_auth_id == "user_resolution_create"
        assert user.auth0_id is None
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
        """Second Clerk-path resolution is served from the ext cache segment."""
        from core.auth import get_or_create_user  # noqa: PLC0415
        from schemas.cached_user import CachedUser  # noqa: PLC0415

        ext_id = "user_cache_roundtrip"
        await get_or_create_user(db_session, external_auth_id=ext_id, email="c@test.com")
        await db_session.commit()

        result = await get_or_create_user(
            db_session, external_auth_id=ext_id, email="c@test.com",
        )

        assert isinstance(result, CachedUser)
        assert result.external_auth_id == ext_id

    async def test__requires_exactly_one_identifier(
        self,
        db_session: AsyncSession,
    ) -> None:
        """Neither or both identifiers is a programming error, not a 401."""
        from core.auth import get_or_create_user  # noqa: PLC0415

        with pytest.raises(ValueError, match="Exactly one"):
            await get_or_create_user(db_session)

        with pytest.raises(ValueError, match="Exactly one"):
            await get_or_create_user(
                db_session, auth0_id="auth0|x", external_auth_id="user_y",
            )


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


class TestConsentLoopRegression:
    """
    Consent invalidation must cover the ext segment (M1 step 6).

    Without it, a fresh Clerk-path user accepts consent and is immediately
    asked again — their ext-segment cache entry survives with stale consent
    versions for up to the TTL.
    """

    async def test__consent_update_invalidates_ext_segment(
        self,
        db_session: AsyncSession,
        redis_client: object,  # noqa: ARG002
    ) -> None:
        """
        After consent + full invalidation, the next Clerk-path resolution
        sees the new consent (no stale 451).
        """
        from datetime import UTC, datetime  # noqa: PLC0415

        from core.auth import _check_consent, get_or_create_user  # noqa: PLC0415
        from core.auth_cache import get_auth_cache  # noqa: PLC0415
        from core.policy_versions import (  # noqa: PLC0415
            PRIVACY_POLICY_VERSION,
            TERMS_OF_SERVICE_VERSION,
        )
        from models.user_consent import UserConsent  # noqa: PLC0415

        ext_id = "user_consent_loop"
        settings = MagicMock(spec=Settings)
        settings.dev_mode = False
        settings.frontend_url = "http://localhost:5173"
        settings.api_url = "http://localhost:8000"

        # First request JIT-creates and caches the user (no consent yet)
        user = await get_or_create_user(db_session, external_auth_id=ext_id)
        await db_session.commit()
        with pytest.raises(HTTPException) as exc_info:
            _check_consent(user, settings)
        assert exc_info.value.status_code == 451

        # User accepts consent; the flow invalidates every cache segment
        # (mirrors api/routers/consent.py)
        consent = UserConsent(
            user_id=user.id,
            consented_at=datetime.now(UTC),
            privacy_policy_version=PRIVACY_POLICY_VERSION,
            terms_of_service_version=TERMS_OF_SERVICE_VERSION,
        )
        db_session.add(consent)
        await db_session.flush()
        auth_cache = get_auth_cache()
        if auth_cache:
            await auth_cache.invalidate(
                user.id,
                auth0_id=user.auth0_id,
                external_auth_id=user.external_auth_id,
            )

        # Simulate the next request: fresh ORM state (the real flow spans
        # two requests/sessions; expire_all gives the joinedload a clean read)
        db_session.expire_all()

        # Next Clerk-path request must see the recorded consent
        refreshed = await get_or_create_user(db_session, external_auth_id=ext_id)
        _check_consent(refreshed, settings)  # must not raise 451


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

    def test__auth0_jwks_connection_failure__503(
        self,
        clerk_signing_key: "RSAPrivateKey",
        clerk_settings: Settings,
    ) -> None:
        from core.auth import decode_jwt  # noqa: PLC0415

        broken = self._broken_jwks_client(
            jwt.PyJWKClientConnectionError("connection refused"),
        )
        token = mint_clerk_token(clerk_signing_key, issuer=TEST_AUTH0_ISSUER)
        with (
            patch("core.auth.get_jwks_client", return_value=broken),
            pytest.raises(HTTPException) as exc_info,
        ):
            decode_jwt(token, clerk_settings)

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

    def test__auth0_unknown_signing_key__401(
        self,
        clerk_signing_key: "RSAPrivateKey",
        clerk_settings: Settings,
    ) -> None:
        from core.auth import decode_jwt  # noqa: PLC0415

        broken = self._broken_jwks_client(
            jwt.exceptions.PyJWKClientError("Unable to find a signing key"),
        )
        token = mint_clerk_token(clerk_signing_key, issuer=TEST_AUTH0_ISSUER)
        with (
            patch("core.auth.get_jwks_client", return_value=broken),
            pytest.raises(HTTPException) as exc_info,
        ):
            decode_jwt(token, clerk_settings)

        assert exc_info.value.status_code == 401
        assert exc_info.value.detail == "Invalid token"
