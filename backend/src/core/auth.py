"""
Authentication module: IdP JWT verification (dual-accept) and PAT support.

Provider seam containment (architecture-level intent — keep it this way): every
provider-specific shape in the backend lives in this module plus its immediate
collaborators (`core/config.py`, `core/auth_cache.py`, `core/request_context.py`,
`schemas/cached_user.py`). Nothing outside the seam may parse tokens, read
provider claims, or know which IdP issued a credential.

Dual-accept window (Auth0 → Clerk migration, see
docs/implementation_plans/2026-07-02-clerk-migration.md): JWTs are routed by
their `iss` claim to the Auth0 or Clerk verifier; both resolve to the same user
rows (Auth0 tokens via users.auth0_id, Clerk tokens via users.external_auth_id).
The Auth0 path is removed at decommission (M6b).
"""
import logging
from typing import Annotated

import jwt
from fastapi import Depends, Header, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from core.auth_cache import get_auth_cache
from core.config import Settings, get_settings
from core.policy_versions import PRIVACY_POLICY_VERSION, TERMS_OF_SERVICE_VERSION
from core.rate_limit_config import (
    RateLimitExceededError,
    get_operation_type,
)
from core.rate_limiter import check_rate_limit
# Import and re-export for backward compatibility
from core.request_context import AuthType, RequestContext
from core.tier_limits import get_tier_safely
from db.session import get_async_session
from models.content_history import SOURCE_MAX_LENGTH
from models.user import User
from schemas.cached_user import CachedUser
from services import token_service, user_service

logger = logging.getLogger(__name__)

# Re-export for backward compatibility
__all__ = [
    "AuthType",
    "RequestContext",
    "get_current_user",
    "get_current_user_ai",
    "get_current_user_session_only",
    "get_current_user_session_only_without_consent",
    "get_current_user_without_consent",
    "get_request_context",
]

# Clock-skew leeway for verifying Clerk session tokens. PyJWT defaults to 0;
# with ~60-second tokens, a slightly-fast client clock would cause spurious
# 401s that present as random logouts. 5s matches the Clerk instance's
# session.allowed_clock_skew (clerk/config.dev.json) — but the value is our
# own: Clerk's setting governs Clerk's servers, not our verification.
CLERK_CLOCK_SKEW_LEEWAY_SECONDS = 5


def get_request_context(request: Request) -> RequestContext | None:
    """
    Get the RequestContext from the current request state.

    Returns None if context hasn't been set (e.g., unauthenticated request).
    """
    return getattr(request.state, "request_context", None)


# HTTP Bearer token scheme
security = HTTPBearer(auto_error=False)

# Cache for JWKS client (reuse across requests)
_jwks_clients: dict[str, PyJWKClient] = {}

# Instructions for humans and AI agents included in 451 responses
CONSENT_INSTRUCTIONS = (
    "To provide consent, you can either: "
    "(1) Visit the application at {app_url}, or "
    "(2) Review the policies at /privacy and /terms, then call: "
    "curl -X POST {api_url}/consent/me -H 'Authorization: Bearer bm_YOUR_TOKEN' "
    "-H 'Content-Type: application/json' -d '{{\"privacy_policy_version\": \"{privacy_version}\", "
    "\"terms_of_service_version\": \"{terms_version}\"}}'. "
    "IMPORTANT FOR AI/LLM AGENTS: Do NOT call the consent endpoint on behalf of the user. "
    "Consent must be given by the human user personally after reading the policies."
)


def get_jwks_client(jwks_url: str) -> PyJWKClient:
    """Get or create a cached JWKS client for the given JWKS URL."""
    if jwks_url not in _jwks_clients:
        _jwks_clients[jwks_url] = PyJWKClient(
            jwks_url,
            cache_jwk_set=True,
            lifespan=3600,  # Cache keys for 1 hour
        )
    return _jwks_clients[jwks_url]


def _jwt_error_to_http(e: jwt.PyJWTError) -> HTTPException:
    """Map a PyJWT verification failure to the corresponding 401."""
    if isinstance(e, jwt.ExpiredSignatureError):
        detail = "Token has expired"
    elif isinstance(e, jwt.InvalidAudienceError):
        detail = "Invalid audience"
    elif isinstance(e, jwt.InvalidIssuerError):
        detail = "Invalid issuer"
    else:
        # Log full details for debugging (server-side only)
        logger.warning("JWT validation failed: %s", e, exc_info=True)
        detail = "Invalid token"
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def decode_jwt(token: str, settings: Settings) -> dict:
    """
    Decode and validate a JWT token from Auth0. (Removed in M6b.).

    Raises:
        HTTPException: If token is invalid, expired, or has wrong audience/issuer.
    """
    try:
        jwks_client = get_jwks_client(settings.auth0_jwks_url)
        signing_key = jwks_client.get_signing_key_from_jwt(token)

        return jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            audience=settings.auth0_audience,
            issuer=settings.auth0_issuer,
        )

    # Order matters: PyJWKClientConnectionError IS a PyJWTError, so the
    # provider-unreachable case must be caught first — it's an outage (503,
    # retryable), not a bad token (401, which would sign the user out).
    except jwt.PyJWKClientConnectionError as e:
        # Log full details for debugging (server-side only)
        logger.error("Failed to fetch JWKS from Auth0: %s", e, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not validate credentials",
        )
    except jwt.PyJWTError as e:
        raise _jwt_error_to_http(e)


def decode_clerk_jwt(token: str, settings: Settings) -> dict:
    """
    Decode and validate a Clerk session token.

    Differences from the Auth0 path, per the migration plan's M1 (each verified
    against the live dev instance in the M0 spike):
    - No audience claim exists; the equivalent check is `azp` (authorized
      party) below.
    - `azp` rule: if present it must be in the configured allowlist; if absent
      it is tolerated. Browser-origin tokens carry `azp`; Backend-API-minted
      tokens carry none (M0 spike), and other non-browser token types (native
      iOS, OAuth) are expected to match. Absence can't be forged onto a
      browser token — the token is signed — so present→check/absent→tolerate
      is safe regardless.
    - Explicit clock-skew leeway (~60s tokens; see the constant's comment).

    Raises:
        HTTPException: If token is invalid, expired, or has wrong issuer/azp.
    """
    try:
        jwks_client = get_jwks_client(settings.clerk_jwks_url)
        signing_key = jwks_client.get_signing_key_from_jwt(token)

        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            issuer=settings.clerk_issuer,
            leeway=CLERK_CLOCK_SKEW_LEEWAY_SECONDS,
            options={
                "verify_aud": False,  # no audience on Clerk session tokens
                "require": ["exp", "iss", "sub"],
            },
        )
    # Order matters: PyJWKClientConnectionError IS a PyJWTError, so the
    # provider-unreachable case must be caught first — it's an outage (503,
    # retryable), not a bad token (401, which would sign the user out).
    except jwt.PyJWKClientConnectionError as e:
        # Log full details for debugging (server-side only)
        logger.error("Failed to fetch JWKS from Clerk: %s", e, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not validate credentials",
        )
    except jwt.PyJWTError as e:
        raise _jwt_error_to_http(e)

    azp = payload.get("azp")
    if azp is not None and azp not in settings.clerk_authorized_parties:
        logger.warning("Clerk token rejected: azp %r not in authorized parties", azp)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return payload


def _peek_issuer(token: str) -> str | None:
    """
    Read a JWT's `iss` claim WITHOUT verifying it — for dispatch only.

    This looks alarming but is safe: the value is used solely to select which
    verifier runs; the selected verifier then enforces signature, issuer, and
    every other claim from scratch. A forged `iss` merely routes the token to
    a verifier whose keys will reject it.

    Raises:
        HTTPException 401: if the bearer isn't parseable as a JWT at all. The
        warning log names the cause — this is the observable symptom of a
        Clerk OAuth app misconfigured to issue opaque tokens (M4/M5), and the
        log is what makes that misconfiguration diagnosable instead of a
        silent 401.
    """
    try:
        payload = jwt.decode(token, options={"verify_signature": False})
    except jwt.PyJWTError as e:
        logger.warning(
            "Bearer token is not a PAT and not parseable as a JWT "
            "(opaque token from a misconfigured OAuth app?): %s",
            e,
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return payload.get("iss")


async def get_or_create_user(
    db: AsyncSession,
    *,
    auth0_id: str | None = None,
    external_auth_id: str | None = None,
    email: str | None = None,
    email_verified: bool | None = None,
    jit_create_allowed: bool = True,
) -> User | CachedUser:
    """
    Get user from cache or database, keyed by whichever provider identifier
    the verified token supplied (exactly one required — the users table CHECK
    constraint backstops this).

    Returns CachedUser on cache hit, User ORM object on cache miss.

    Safe attributes (available on both types):
    - id: UUID
    - auth0_id: str | None
    - external_auth_id: str | None
    - email: str | None
    - email_verified: bool | None

    Consent fields (different access patterns):
    - CachedUser: consent_privacy_version, consent_tos_version (direct attributes)
    - User ORM: consent.privacy_policy_version, consent.terms_of_service_version

    WARNING: Do NOT access ORM relationships like .bookmarks, .tokens on the return value.
    Those only exist on User, not CachedUser.

    JIT-create gating (dual-accept window rule, AD5): lookup is always allowed;
    when `jit_create_allowed` is False an unknown identity is rejected with a
    generic 401 plus a warning log naming the identity — the loud, observable
    failure mode for identities leaking past a provider-side sign-up control.

    Handles race conditions where multiple concurrent requests may try to create
    the same user simultaneously. If an IntegrityError occurs (due to the unique
    constraint on the identifier column), the function rolls back and fetches
    the existing user.

    Note: Uses flush(), not commit. Session generator handles commit at request end.
    """
    if (auth0_id is None) == (external_auth_id is None):
        raise ValueError(
            "Exactly one of auth0_id or external_auth_id is required.",
        )
    lookup_column = User.auth0_id if auth0_id else User.external_auth_id
    identifier = auth0_id if auth0_id else external_auth_id

    # Try cache first
    cached = await _cache_lookup(auth0_id, external_auth_id)
    if cached:
        # Fall through to DB if email changed (can't update cache directly).
        # Note: email_verified is intentionally NOT checked here. It's an
        # informational field not used for access control, so staleness up to
        # cache TTL (5 min) is acceptable. Avoiding a DB hit on every request
        # for a rarely-changing field is the right tradeoff.
        if email and cached.email != email:
            logger.debug("auth_cache email_mismatch, falling through to DB")
        else:
            return cached

    # Cache miss or email update needed - hit DB
    result = await db.execute(
        select(User)
        .options(joinedload(User.consent))
        .where(lookup_column == identifier),
    )
    user = result.scalar_one_or_none()

    if user is None:
        if not jit_create_allowed:
            _reject_jit_create(auth0_id, identifier)
        try:
            user = await user_service.create_user_with_defaults(
                db,
                auth0_id=auth0_id,
                external_auth_id=external_auth_id,
                email=email,
                email_verified=email_verified,
            )
        except IntegrityError:
            # Race condition: another request created the user between our SELECT
            # and INSERT. Rollback and fetch the existing user.
            await db.rollback()
            result = await db.execute(
                select(User)
                .options(joinedload(User.consent))
                .where(lookup_column == identifier),
            )
            user = result.scalar_one()

    # Update email/email_verified if changed at the IdP (applies to both existing
    # users and users fetched after race condition recovery)
    if email and user.email != email:
        user.email = email
    if email_verified is not None and user.email_verified != email_verified:
        user.email_verified = email_verified
    await db.flush()

    # Populate cache
    auth_cache = get_auth_cache()
    if auth_cache:
        await auth_cache.set(user)

    return user


async def _cache_lookup(
    auth0_id: str | None,
    external_auth_id: str | None,
) -> CachedUser | None:
    """Look up the auth-cache segment matching the supplied identifier."""
    auth_cache = get_auth_cache()
    if not auth_cache:
        return None
    if auth0_id:
        return await auth_cache.get_by_auth0_id(auth0_id)
    return await auth_cache.get_by_external_auth_id(external_auth_id)


def _reject_jit_create(auth0_id: str | None, identifier: str | None) -> None:
    """
    Reject a gated JIT creation: generic 401 + a warning log naming the
    identity and issuer (the loud, observable failure mode for identities
    leaking past a provider-side sign-up control — AD5 window rules).
    """
    issuer_name = "auth0" if auth0_id else "clerk"
    logger.warning(
        "JIT user creation rejected (disabled for issuer=%s): sub=%s",
        issuer_name,
        identifier,
    )
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid token",
        headers={"WWW-Authenticate": "Bearer"},
    )


async def get_or_create_dev_user(db: AsyncSession) -> User:
    """
    Get or create a development user for DEV_MODE.

    Deliberately not subject to the JIT-create gate — dev mode bypasses auth
    entirely. (The sentinel moves to external_auth_id in M6b.)
    """
    dev_auth0_id = "dev|local-development-user"
    return await get_or_create_user(
        db,
        auth0_id=dev_auth0_id,
        email="dev@localhost",
    )


async def validate_pat(db: AsyncSession, token: str) -> User:
    """
    Validate a Personal Access Token (PAT) and return the associated user.

    Args:
        db: Database session.
        token: The plaintext PAT (starts with 'bm_').

    Returns:
        User associated with the token.

    Raises:
        HTTPException: If token is invalid, expired, or revoked.
    """
    api_token = await token_service.validate_token(db, token)

    if api_token is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Load the user associated with this token (with consent for enforcement check)
    result = await db.execute(
        select(User)
        .options(joinedload(User.consent))
        .where(User.id == api_token.user_id),
    )
    user = result.scalar_one_or_none()

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return user


def _check_consent(user: User | CachedUser, settings: Settings) -> None:
    """
    Verify user has valid consent.

    Works with both User ORM objects and CachedUser dataclass.

    Raises HTTP 451 if consent is missing or outdated.
    Skipped in DEV_MODE.
    """
    if settings.dev_mode:
        return

    instructions = CONSENT_INSTRUCTIONS.format(
        app_url=settings.frontend_url,
        api_url=settings.api_url,
        privacy_version=PRIVACY_POLICY_VERSION,
        terms_version=TERMS_OF_SERVICE_VERSION,
    )

    # Get consent versions - different access patterns for User vs CachedUser
    if isinstance(user, CachedUser):
        privacy_version = user.consent_privacy_version
        tos_version = user.consent_tos_version
    else:
        privacy_version = (
            user.consent.privacy_policy_version if user.consent else None
        )
        tos_version = (
            user.consent.terms_of_service_version if user.consent else None
        )

    if privacy_version is None or tos_version is None:
        raise HTTPException(
            status_code=status.HTTP_451_UNAVAILABLE_FOR_LEGAL_REASONS,
            detail={
                "error": "consent_required",
                "message": "You must accept the Privacy Policy and Terms of Service.",
                "consent_url": "/consent/status",
                "instructions": instructions,
            },
        )

    if (
        privacy_version != PRIVACY_POLICY_VERSION
        or tos_version != TERMS_OF_SERVICE_VERSION
    ):
        raise HTTPException(
            status_code=status.HTTP_451_UNAVAILABLE_FOR_LEGAL_REASONS,
            detail={
                "error": "consent_outdated",
                "message": "Policy versions have been updated. Please review and accept.",
                "consent_url": "/consent/status",
                "instructions": instructions,
            },
        )


async def _apply_rate_limit(
    user: User | CachedUser,
    request: Request,
    settings: Settings,
) -> None:
    """
    Apply rate limiting for the current request.

    Checks both per-minute and daily limits based on user tier and operation type.
    Stores rate limit info in request.state for middleware to add headers.
    Raises RateLimitExceededError if limit exceeded (handled by exception handler).

    In dev mode, rate limiting is disabled to allow running evals and tests
    without hitting limits.
    """
    if settings.dev_mode:
        return

    operation_type = get_operation_type(request.method, request.url.path)
    tier = get_tier_safely(user.tier)

    result = await check_rate_limit(user.id, operation_type, tier)

    # Store result in request.state for RateLimitHeadersMiddleware
    request.state.rate_limit_info = {
        "limit": result.limit,
        "remaining": result.remaining,
        "reset": result.reset,
    }

    if not result.allowed:
        raise RateLimitExceededError(result)


def get_request_source(
    x_request_source: Annotated[
        str | None,
        Header(
            description=(
                "Free-form tag identifying the calling client, recorded on content "
                "history audit rows for telemetry. Not access control (spoofable). "
                "Lowercased server-side; no allowlist; a missing header resolves to "
                f"'unknown'. Keep it to {SOURCE_MAX_LENGTH} characters or fewer — "
                "longer values are truncated. Tiddly's own clients send: web, cli, "
                "chrome-extension, mcp-content, mcp-prompt, ios."
            ),
        ),
    ] = None,
) -> str:
    """
    Resolve the request source from the X-Request-Source header for the audit trail.

    Declared as a FastAPI Header dependency (rather than read off the raw request)
    so it appears in the generated OpenAPI/Swagger reference. Truncated to
    SOURCE_MAX_LENGTH so an over-length header can never exceed the history column
    and fail a write. See docs/architecture.md "Request source" for the canonical
    behavior and first-party client values.
    """
    return (x_request_source or "").strip().lower()[:SOURCE_MAX_LENGTH] or "unknown"


async def _authenticate_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None,
    db: AsyncSession,
    settings: Settings,
    *,
    source: str,
    allow_pat: bool = True,
) -> User | CachedUser:
    """
    Internal: authenticate user without consent check.

    Supports:
    - IdP-issued JWTs, routed by issuer (Auth0 or Clerk — dual-accept window)
    - Personal Access Tokens (PATs) starting with 'bm_' (for CLI/MCP/scripts)

    In DEV_MODE, bypasses auth and returns a test user.

    Also sets request.state.request_context with source/auth tracking info
    for content versioning audit trail.

    Args:
        request: The FastAPI request object.
        credentials: HTTP Authorization header credentials.
        db: Database session.
        settings: Application settings.
        source: Resolved X-Request-Source value (see get_request_source), recorded
            on the request context for the content-versioning audit trail.
        allow_pat: If False, reject PAT tokens with 403 to help prevent unintended
            programmatic use. Note: does not block IdP JWTs used outside the browser.
    """
    token_prefix: str | None = None

    if settings.dev_mode:
        auth_type = AuthType.DEV
        user = await get_or_create_dev_user(db)
    elif credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    else:
        token = credentials.credentials

        # Route to appropriate validation based on token prefix
        if token.startswith("bm_"):
            if not allow_pat:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="This endpoint is not available for API tokens. Please use the web interface.",  # noqa: E501
                )
            auth_type = AuthType.PAT
            # Compute token_prefix for audit trail (e.g., "bm_a3f8...")
            # Show first 15 chars which includes prefix + partial identifier
            token_prefix = token[:15] if len(token) > 15 else token
            user = await validate_pat(db, token)
        else:
            # IdP JWT: dispatch on the (unverified) `iss` claim — see _peek_issuer
            # for why that is safe. The selected verifier enforces everything.
            auth_type = AuthType.SESSION
            issuer = _peek_issuer(token)

            if issuer == settings.auth0_issuer:
                payload = decode_jwt(token, settings)

                # Extract user info from JWT claims
                auth0_id = payload.get("sub")
                if not auth0_id:
                    raise HTTPException(
                        status_code=status.HTTP_401_UNAUTHORIZED,
                        detail="Invalid token: missing sub claim",
                        headers={"WWW-Authenticate": "Bearer"},
                    )

                # The cutover signal (M6a→M6b): during the window, `ios` should be
                # the only source still authenticating via Auth0. Decommission is
                # gated on this log going quiet.
                logger.info(
                    "auth0_path_authentication source=%s sub=%s", source, auth0_id,
                )

                namespace = settings.auth0_custom_claim_namespace
                email = payload.get(f"{namespace}/email") if namespace else payload.get("email")
                email_verified = payload.get(f"{namespace}/email_verified") if namespace else None
                user = await get_or_create_user(
                    db,
                    auth0_id=auth0_id,
                    email=email,
                    email_verified=email_verified,
                    jit_create_allowed=settings.auth0_jit_create_enabled,
                )
            # Clerk config is optional in dev; guard before comparing
            # clerk_issuer so an unset Frontend API doesn't route tokens into
            # a malformed Clerk verifier. Auth0 needs no equivalent guard —
            # its settings are startup-required for the dual-accept window.
            elif settings.clerk_frontend_api and issuer == settings.clerk_issuer:
                payload = decode_clerk_jwt(token, settings)

                # `sub` presence is enforced by decode_clerk_jwt's require list.
                # Email claims are the plain (non-namespaced) custom session-token
                # claims configured on the Clerk instance.
                user = await get_or_create_user(
                    db,
                    external_auth_id=payload["sub"],
                    email=payload.get("email"),
                    email_verified=payload.get("email_verified"),
                    jit_create_allowed=settings.clerk_jit_create_enabled,
                )
            else:
                logger.warning("JWT rejected: unknown or missing issuer %r", issuer)
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid token",
                    headers={"WWW-Authenticate": "Bearer"},
                )

    # Set request context for content versioning audit trail
    request.state.request_context = RequestContext(
        source=source,
        auth_type=auth_type,
        token_prefix=token_prefix,
    )

    return user


async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    db: AsyncSession = Depends(get_async_session),
    settings: Settings = Depends(get_settings),
    source: str = Depends(get_request_source),
) -> User | CachedUser:
    """
    Dependency that validates the token, applies rate limiting, checks consent,
    and returns the current user.

    Returns User ORM object on cache miss, CachedUser on cache hit.
    Auth + rate limiting + consent check (default for most routes).
    Use get_current_user_without_consent for exempt routes.

    Note: Rate limiting runs before consent check so all authenticated requests
    count against limits, even from users who haven't consented yet.
    """
    user = await _authenticate_user(request, credentials, db, settings, source=source)
    await _apply_rate_limit(user, request, settings)
    _check_consent(user, settings)
    return user


async def get_current_user_without_consent(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    db: AsyncSession = Depends(get_async_session),
    settings: Settings = Depends(get_settings),
    source: str = Depends(get_request_source),
) -> User | CachedUser:
    """
    Dependency that validates the token, applies rate limiting, and returns the user.

    Returns User ORM object on cache miss, CachedUser on cache hit.
    Auth + rate limiting, no consent check (for exempt routes like consent endpoints).
    """
    user = await _authenticate_user(request, credentials, db, settings, source=source)
    await _apply_rate_limit(user, request, settings)
    return user


async def get_current_user_session_only(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    db: AsyncSession = Depends(get_async_session),
    settings: Settings = Depends(get_settings),
    source: str = Depends(get_request_source),
) -> User | CachedUser:
    """
    Dependency: session-only auth + rate limiting + consent check (blocks PAT access).

    "Session" = an IdP-issued JWT (either issuer during dual-accept), as opposed
    to a PAT. Returns User ORM object on cache miss, CachedUser on cache hit.
    Use this to block PAT access and help prevent unintended programmatic use.

    Examples:
        - /bookmarks/fetch-metadata (blocks PAT-based SSRF abuse)
        - /tokens/* (prevents compromised PAT from creating more tokens)
        - /settings/* (account management)

    Note: This does NOT prevent all programmatic access. Users can still extract
    their session JWT from browser DevTools and use it in scripts. Rate limiting
    provides the additional layer to cap any abuse.

    Returns 403 Forbidden for PAT tokens.
    Returns 429 if rate limit exceeded.
    Returns 451 if user hasn't consented to privacy policy/terms.
    Use get_current_user_session_only_without_consent for consent-exempt routes.
    """
    user = await _authenticate_user(
        request, credentials, db, settings, source=source, allow_pat=False,
    )
    await _apply_rate_limit(user, request, settings)
    _check_consent(user, settings)
    return user


async def get_current_user_session_only_without_consent(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    db: AsyncSession = Depends(get_async_session),
    settings: Settings = Depends(get_settings),
    source: str = Depends(get_request_source),
) -> User | CachedUser:
    """
    Dependency: session-only auth + rate limiting, no consent check (blocks PAT access).

    Use to block PAT access on routes that must be accessible without consent
    (e.g., consent/settings pages).

    See get_current_user_session_only for details on what this does and doesn't prevent.
    """
    user = await _authenticate_user(
        request, credentials, db, settings, source=source, allow_pat=False,
    )
    await _apply_rate_limit(user, request, settings)
    return user


async def get_current_user_ai(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    db: AsyncSession = Depends(get_async_session),
    settings: Settings = Depends(get_settings),
    source: str = Depends(get_request_source),
) -> User | CachedUser:
    """
    Dependency: session-only auth + consent check, NO global rate limiting.

    Used by /ai/* endpoints. Skips _apply_rate_limit() to avoid consuming
    READ/WRITE quota — AI endpoints have their own rate limit buckets
    (AI_PLATFORM / AI_BYOK) enforced by a separate dependency.

    Returns 403 Forbidden for PAT tokens.
    Returns 451 if user hasn't consented to privacy policy/terms.
    """
    user = await _authenticate_user(
        request, credentials, db, settings, source=source, allow_pat=False,
    )
    _check_consent(user, settings)
    return user
