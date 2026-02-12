"""FastAPI application entry point."""
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint

from api.routers import (
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
from core.auth_cache import AuthCache, set_auth_cache
from core.config import get_settings
from core.http_cache import ETagMiddleware
from core.rate_limit_config import RateLimitExceededError
from core.redis import RedisClient, set_redis_client
from db.session import engine
from services.exceptions import FieldLimitExceededError, QuotaExceededError


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

    yield

    # Shutdown: Dispose database connection pool
    await engine.dispose()

    # Shutdown: Clean up auth cache and Redis
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
)

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
