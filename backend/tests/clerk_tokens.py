"""
Real RS256 Clerk tokens for tests, signed with a test key.

Tests patch `core.auth.get_jwks_client` to return a `FakeJWKSClient` built from
the same key, so `decode_clerk_jwt` verifies a genuine signature, issuer, and
expiry instead of a mocked decoder.
"""
import time
from typing import TYPE_CHECKING
from unittest.mock import MagicMock

import jwt

if TYPE_CHECKING:
    from cryptography.hazmat.primitives.asymmetric.rsa import RSAPrivateKey

TEST_CLERK_FRONTEND_API = "test-instance.clerk.accounts.dev"
TEST_CLERK_ISSUER = f"https://{TEST_CLERK_FRONTEND_API}"
TEST_AUTHORIZED_PARTY = "http://localhost:5173"
# The configured "Tiddly CLI" OAuth app; any other client_id is a connector.
TEST_CLI_OAUTH_CLIENT_ID = "zTESTcliclient456"
CLAUDE_CODE_CLIENT_ID = "https://claude.ai/oauth/claude-code-client-metadata"


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


def mint_clerk_oauth_token(
    signing_key: "RSAPrivateKey",
    sub: str = "user_test_clerk_id",
    *,
    client_id: str | None = "zTESTclientid123",
    azp: str | None = None,
    issuer: str = TEST_CLERK_ISSUER,
    lifetime_seconds: int = 86400,
    typ: str = "at+jwt",
) -> str:
    """
    Mint a real RS256 OAuth access token shaped like Clerk's.

    Claim shape is the fixture from the M4 opening probe (ledger Q5, decoded
    from a real dev-instance token 2026-07-13): header `typ: "at+jwt"`; claims
    `sub`/`client_id`/`scope`/`jti`/`nbf`; no email, no azp, 24h lifetime.
    The default `client_id` is a connector's (not the CLI's).
    """
    now = int(time.time())
    claims: dict = {
        "iss": issuer,
        "sub": sub,
        "iat": now,
        "nbf": now - 10,
        "exp": now + lifetime_seconds,
        "scope": "openid profile email offline_access",
        "jti": "oat_TESTTESTTESTTEST",
    }
    if client_id is not None:
        claims["client_id"] = client_id
    if azp is not None:
        claims["azp"] = azp
    return jwt.encode(claims, signing_key, algorithm="RS256", headers={"typ": typ})


class FakeJWKSClient:
    """Stands in for PyJWKClient; serves the test public key for any token."""

    def __init__(self, signing_key: "RSAPrivateKey") -> None:
        self._public_key = signing_key.public_key()

    def get_signing_key_from_jwt(self, token: str) -> MagicMock:  # noqa: ARG002
        entry = MagicMock()
        entry.key = self._public_key
        return entry
