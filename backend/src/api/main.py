"""FastAPI application entry point."""
import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

logger = logging.getLogger(__name__)

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint

from api.routers import (
    ai,
    bookmarks,
    consent,
    content,
    filters,
    health,
    history,
    mcp,
    notes,
    prompts,
    relationships,
    settings,
    tags,
    tokens,
    users,
)
from litellm.exceptions import (
    APIConnectionError as LiteLLMAPIConnectionError,
    APIError as LiteLLMAPIError,
    AuthenticationError as LiteLLMAuthenticationError,
    BadRequestError as LiteLLMBadRequestError,
    RateLimitError as LiteLLMRateLimitError,
    Timeout as LiteLLMTimeout,
)

from core.auth_cache import AuthCache, set_auth_cache
from core.config import get_settings
from core.http_cache import ETagMiddleware
from core.rate_limit_config import RateLimitExceededError
from core.redis import RedisClient, set_redis_client
from db.session import engine
from services.exceptions import FieldLimitExceededError, QuotaExceededError
from services.llm_service import LLMService, set_llm_service


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None]:
    """Manage application lifespan - startup and shutdown."""
    app_settings = get_settings()

    # Startup: Connect to Redis
    redis_client = RedisClient(
        url=app_settings.redis_url,
        enabled=app_settings.redis_enabled,
        pool_size=app_settings.redis_pool_size,
    )
    await redis_client.connect()
    set_redis_client(redis_client)

    # Startup: Initialize auth cache
    auth_cache = AuthCache(redis_client)
    set_auth_cache(auth_cache)

    # Startup: Initialize LLM service
    llm_service = LLMService(app_settings)
    set_llm_service(llm_service)

    yield

    # Shutdown: Dispose database connection pool
    await engine.dispose()

    # Shutdown: Clean up LLM service, auth cache, and Redis
    set_llm_service(None)
    set_auth_cache(None)
    await redis_client.close()
    set_redis_client(None)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add security headers to all responses."""

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint,
    ) -> Response:
        """Process request and add security headers to response."""
        response = await call_next(request)
        # HSTS: enforce HTTPS for 1 year, including subdomains
        response.headers["Strict-Transport-Security"] = (
            "max-age=31536000; includeSubDomains"
        )
        # Prevent MIME type sniffing
        response.headers["X-Content-Type-Options"] = "nosniff"
        # Prevent clickjacking - API shouldn't be framed
        response.headers["X-Frame-Options"] = "DENY"
        return response


class RateLimitHeadersMiddleware(BaseHTTPMiddleware):
    """Add rate limit headers to successful responses."""

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint,
    ) -> Response:
        """Process request and add rate limit headers to response."""
        response = await call_next(request)

        # Add headers if rate limit info was stored by dependency
        # Note: 429 responses are handled by exception handler, not middleware
        info = getattr(request.state, "rate_limit_info", None)
        if info:
            response.headers["X-RateLimit-Limit"] = str(info["limit"])
            response.headers["X-RateLimit-Remaining"] = str(info["remaining"])
            response.headers["X-RateLimit-Reset"] = str(info["reset"])

        return response


app_settings = get_settings()

app = FastAPI(
    title="Tiddly API",
    description="A content management system with tagging and search capabilities.",
    version="0.1.0",
    lifespan=lifespan,
)


@app.exception_handler(RateLimitExceededError)
async def rate_limit_exception_handler(
    _request: Request, exc: RateLimitExceededError,
) -> JSONResponse:
    """Handle rate limit exceeded with proper headers."""
    return JSONResponse(
        status_code=429,
        content={"detail": "Rate limit exceeded. Please try again later."},
        headers={
            "Retry-After": str(exc.result.retry_after),
            "X-RateLimit-Limit": str(exc.result.limit),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": str(exc.result.reset),
        },
    )


@app.exception_handler(QuotaExceededError)
async def quota_exceeded_exception_handler(
    _request: Request, exc: QuotaExceededError,
) -> JSONResponse:
    """Handle quota exceeded errors with structured response."""
    return JSONResponse(
        status_code=402,
        content={
            "detail": str(exc),
            "error_code": "QUOTA_EXCEEDED",
            "resource": exc.resource,
            "current": exc.current,
            "limit": exc.limit,
        },
    )


@app.exception_handler(FieldLimitExceededError)
async def field_limit_exceeded_exception_handler(
    _request: Request, exc: FieldLimitExceededError,
) -> JSONResponse:
    """Handle field length limit exceeded errors."""
    return JSONResponse(
        status_code=400,
        content={
            "detail": str(exc),
            "error_code": "FIELD_LIMIT_EXCEEDED",
            "field": exc.field,
            "current": exc.current,
            "limit": exc.limit,
        },
    )


# LiteLLM exception handlers — map provider errors to HTTP responses.
# Defined inline to match the pattern of existing exception handlers above.
# All LLM errors use llm_* error codes so the frontend can distinguish them
# from platform auth errors (which use HTTP 401).


@app.exception_handler(LiteLLMAuthenticationError)
async def llm_auth_exception_handler(
    _request: Request, exc: LiteLLMAuthenticationError,
) -> JSONResponse:
    """LLM authentication failed (bad API key) → 422."""
    logger.warning("llm_auth_failed", extra={"error": str(exc)})
    return JSONResponse(
        status_code=422,
        content={"detail": "LLM authentication failed. Check your API key.", "error_code": "llm_auth_failed"},
    )


@app.exception_handler(LiteLLMBadRequestError)
async def llm_bad_request_exception_handler(
    _request: Request, exc: LiteLLMBadRequestError,
) -> JSONResponse:
    """Invalid request to LLM provider → 400."""
    logger.warning("llm_bad_request", extra={"error": str(exc)})
    return JSONResponse(
        status_code=400,
        content={"detail": "Invalid request to LLM provider.", "error_code": "llm_bad_request"},
    )


@app.exception_handler(LiteLLMRateLimitError)
async def llm_rate_limit_exception_handler(
    _request: Request, exc: LiteLLMRateLimitError,
) -> JSONResponse:
    """LLM provider rate limit exceeded → 429."""
    logger.warning("llm_rate_limited", extra={"error": str(exc)})
    return JSONResponse(
        status_code=429,
        content={"detail": "LLM provider rate limit exceeded. Try again later.", "error_code": "llm_rate_limited"},
    )


@app.exception_handler(LiteLLMTimeout)
async def llm_timeout_exception_handler(
    _request: Request, exc: LiteLLMTimeout,
) -> JSONResponse:
    """LLM request timed out → 504."""
    logger.warning("llm_timeout", extra={"error": str(exc)})
    return JSONResponse(
        status_code=504,
        content={"detail": "LLM request timed out. Try again.", "error_code": "llm_timeout"},
    )


@app.exception_handler(LiteLLMAPIConnectionError)
async def llm_connection_exception_handler(
    _request: Request, exc: LiteLLMAPIConnectionError,
) -> JSONResponse:
    """Could not connect to LLM provider → 502."""
    logger.warning("llm_connection_error", extra={"error": str(exc)})
    return JSONResponse(
        status_code=502,
        content={"detail": "Could not connect to LLM provider.", "error_code": "llm_connection_error"},
    )


@app.exception_handler(LiteLLMAPIError)
async def llm_unavailable_exception_handler(
    _request: Request, exc: LiteLLMAPIError,
) -> JSONResponse:
    """Catch-all for unknown LiteLLM errors → 503."""
    logger.warning("llm_unavailable", extra={"error": str(exc)})
    return JSONResponse(
        status_code=503,
        content={"detail": "AI service temporarily unavailable.", "error_code": "llm_unavailable"},
    )


# Rate limit headers middleware (innermost, runs first on response)
app.add_middleware(RateLimitHeadersMiddleware)

# ETag middleware (generates ETags, returns 304 when content unchanged)
# Added before SecurityHeadersMiddleware so 304 responses get security headers
app.add_middleware(ETagMiddleware)

# Security headers middleware (adds HSTS, X-Frame-Options, etc. to all responses)
app.add_middleware(SecurityHeadersMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=app_settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    max_age=3600,
)

app.include_router(ai.router)
app.include_router(health.router)
app.include_router(users.router)
app.include_router(consent.router)
app.include_router(bookmarks.router)
app.include_router(notes.router)
app.include_router(prompts.router)
app.include_router(content.router)
app.include_router(tags.router)
app.include_router(tokens.router)
app.include_router(filters.router)
app.include_router(settings.router)
app.include_router(history.router)
app.include_router(relationships.router)
app.include_router(mcp.router)
