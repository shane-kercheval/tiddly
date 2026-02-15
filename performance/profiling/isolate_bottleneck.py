#!/usr/bin/env python3
"""
Isolate bottleneck by testing app with middleware removed.

This script tests your actual app by creating variants with specific
middleware disabled. It modifies the app in-memory, not on disk.

Run with: uv run python performance/profiling/isolate_bottleneck.py

Requirements: API server should NOT be running (we start our own instances)
"""
import asyncio
import statistics
import sys
import time
from pathlib import Path

# Add backend to path
backend_path = Path(__file__).parent.parent.parent / "backend" / "src"
sys.path.insert(0, str(backend_path))

# Set dev mode before importing app
import os
os.environ["VITE_DEV_MODE"] = "true"
os.environ["DATABASE_URL"] = "postgresql+asyncpg://bookmarks:bookmarks@localhost:5435/bookmarks"
os.environ["REDIS_URL"] = "redis://localhost:6379"

import httpx
from httpx import ASGITransport


async def measure_concurrent(
    client: httpx.AsyncClient,
    endpoint: str,
    n: int,
) -> dict[str, float]:
    """Measure latency for n concurrent requests."""
    async def timed_request() -> float:
        start = time.perf_counter()
        resp = await client.get(endpoint)
        if resp.status_code != 200:
            print(f"    Warning: {endpoint} returned {resp.status_code}")
        return (time.perf_counter() - start) * 1000

    latencies = await asyncio.gather(*[timed_request() for _ in range(n)])
    sorted_lat = sorted(latencies)
    p95_idx = int(n * 0.95) if n >= 20 else n - 1

    return {
        "p50": sorted_lat[n // 2],
        "p95": sorted_lat[p95_idx],
        "mean": statistics.mean(latencies),
    }


async def test_app_variant(
    app,
    name: str,
    concurrency: int = 50,
) -> dict[str, float]:
    """Test an app variant."""
    transport = ASGITransport(app=app)

    async with httpx.AsyncClient(transport=transport, base_url="http://test", timeout=30) as client:
        # Warmup
        for _ in range(3):
            await client.get("/health")

        # Measure
        return await measure_concurrent(client, "/health", concurrency)


def create_app_no_middleware():
    """Create app with NO middleware at all but ALL routers."""
    from fastapi import FastAPI
    from api.routers import (
        bookmarks, consent, content, filters, health,
        mcp, notes, prompts, settings, tags, tokens, users,
    )

    app = FastAPI()
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
    app.include_router(mcp.router)
    return app


def create_app_only_cors():
    """Create app with only CORS middleware and ALL routers."""
    from fastapi import FastAPI
    from fastapi.middleware.cors import CORSMiddleware
    from api.routers import (
        bookmarks, consent, content, filters, health,
        mcp, notes, prompts, settings, tags, tokens, users,
    )
    from core.config import get_settings

    app_settings = get_settings()
    app = FastAPI()
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
    app.include_router(mcp.router)
    return app


def create_app_cors_security():
    """Create app with CORS + Security middleware."""
    from fastapi import FastAPI
    from fastapi.middleware.cors import CORSMiddleware
    from api.routers import (
        bookmarks, consent, content, filters, health,
        mcp, notes, prompts, settings, tags, tokens, users,
    )
    from api.main import SecurityHeadersMiddleware
    from core.config import get_settings

    app_settings = get_settings()
    app = FastAPI()

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
    app.include_router(mcp.router)
    return app


def create_app_cors_security_ratelimit():
    """Create app with CORS + Security + RateLimit middleware."""
    from fastapi import FastAPI
    from fastapi.middleware.cors import CORSMiddleware
    from api.routers import (
        bookmarks, consent, content, filters, health,
        mcp, notes, prompts, settings, tags, tokens, users,
    )
    from api.main import SecurityHeadersMiddleware, RateLimitHeadersMiddleware
    from core.config import get_settings

    app_settings = get_settings()
    app = FastAPI()

    app.add_middleware(RateLimitHeadersMiddleware)
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
    app.include_router(mcp.router)
    return app


def create_app_cors_security_etag():
    """Create app with CORS + Security + ETag middleware."""
    from fastapi import FastAPI
    from fastapi.middleware.cors import CORSMiddleware
    from api.routers import (
        bookmarks, consent, content, filters, health,
        mcp, notes, prompts, settings, tags, tokens, users,
    )
    from api.main import SecurityHeadersMiddleware
    from core.http_cache import ETagMiddleware
    from core.config import get_settings

    app_settings = get_settings()
    app = FastAPI()

    app.add_middleware(ETagMiddleware)
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
    app.include_router(mcp.router)
    return app


def create_app_all_middleware():
    """Create app with all 4 middleware (like full app but fresh instance)."""
    from fastapi import FastAPI
    from fastapi.middleware.cors import CORSMiddleware
    from api.routers import (
        bookmarks, consent, content, filters, health,
        mcp, notes, prompts, settings, tags, tokens, users,
    )
    from api.main import SecurityHeadersMiddleware, RateLimitHeadersMiddleware
    from core.http_cache import ETagMiddleware
    from core.config import get_settings

    app_settings = get_settings()
    app = FastAPI()

    # Same order as main.py
    app.add_middleware(RateLimitHeadersMiddleware)
    app.add_middleware(ETagMiddleware)
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
    app.include_router(mcp.router)
    return app


def create_app_no_etag():
    """Create full app but without ETag middleware."""
    from fastapi import FastAPI
    from fastapi.middleware.cors import CORSMiddleware
    from api.routers import (
        bookmarks, consent, content, filters, health,
        mcp, notes, prompts, settings, tags, tokens, users,
    )
    from api.main import SecurityHeadersMiddleware, RateLimitHeadersMiddleware
    from core.config import get_settings

    app_settings = get_settings()
    app = FastAPI()

    # Add all middleware EXCEPT ETag
    app.add_middleware(RateLimitHeadersMiddleware)
    # Skip ETagMiddleware
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
    app.include_router(mcp.router)
    return app


def create_app_no_security():
    """Create full app but without Security headers middleware."""
    from fastapi import FastAPI
    from fastapi.middleware.cors import CORSMiddleware
    from api.routers import (
        bookmarks, consent, content, filters, health,
        mcp, notes, prompts, settings, tags, tokens, users,
    )
    from api.main import RateLimitHeadersMiddleware
    from core.http_cache import ETagMiddleware
    from core.config import get_settings

    app_settings = get_settings()
    app = FastAPI()

    app.add_middleware(RateLimitHeadersMiddleware)
    app.add_middleware(ETagMiddleware)
    # Skip SecurityHeadersMiddleware
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
    app.include_router(mcp.router)
    return app


def create_app_no_ratelimit():
    """Create full app but without RateLimit headers middleware."""
    from fastapi import FastAPI
    from fastapi.middleware.cors import CORSMiddleware
    from api.routers import (
        bookmarks, consent, content, filters, health,
        mcp, notes, prompts, settings, tags, tokens, users,
    )
    from api.main import SecurityHeadersMiddleware
    from core.http_cache import ETagMiddleware
    from core.config import get_settings

    app_settings = get_settings()
    app = FastAPI()

    # Skip RateLimitHeadersMiddleware
    app.add_middleware(ETagMiddleware)
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
    app.include_router(mcp.router)
    return app


async def main() -> None:
    """Run bottleneck isolation tests."""
    print("=" * 70)
    print("BOTTLENECK ISOLATION")
    print("=" * 70)
    print("\nTesting your app with middleware removed one at a time.")
    print("Using ASGITransport (in-process, no network overhead).")
    print("Note: Lifespan events don't run, so no Redis/auth caching.\n")

    concurrency = 50
    results: dict[str, dict[str, float]] = {}

    # Test full app first
    print("Testing: Full app (from api.main)...", end=" ", flush=True)
    from api.main import app as full_app
    result = await test_app_variant(full_app, "full_app", concurrency)
    results["1_full_app"] = result
    print(f"P50: {result['p50']:.1f}ms")

    # Test variants - build up middleware one at a time
    variants = [
        ("2_no_middleware", create_app_no_middleware, "No middleware"),
        ("3_only_cors", create_app_only_cors, "+ CORS only"),
        ("4_cors_security", create_app_cors_security, "+ CORS + Security"),
        ("5_cors_security_ratelimit", create_app_cors_security_ratelimit, "+ CORS + Security + RateLimit"),
        ("6_cors_security_etag", create_app_cors_security_etag, "+ CORS + Security + ETag"),
        ("7_all_middleware", create_app_all_middleware, "+ All 4 middleware"),
    ]

    for name, factory, desc in variants:
        print(f"Testing: {desc}...", end=" ", flush=True)
        try:
            app = factory()
            result = await test_app_variant(app, name, concurrency)
            results[name] = result
            print(f"P50: {result['p50']:.1f}ms")
        except Exception as e:
            print(f"ERROR: {e}")

    # Results table
    print("\n" + "=" * 70)
    print(f"RESULTS @ {concurrency} CONCURRENT")
    print("=" * 70)
    print(f"\n{'Configuration':<35} | {'P50':>10} | {'P95':>10} | {'vs Full':>10}")
    print("-" * 35 + "-+-" + "-" * 10 + "-+-" + "-" * 10 + "-+-" + "-" * 10)

    full_p50 = results.get("1_full_app", {}).get("p50", 0)

    for name, result in sorted(results.items()):
        p50 = result["p50"]
        p95 = result["p95"]
        diff = p50 - full_p50
        sign = "+" if diff >= 0 else ""
        print(f"{name:<35} | {p50:>9.1f}ms | {p95:>9.1f}ms | {sign}{diff:>8.1f}ms")

    # Analysis
    print("\n" + "=" * 70)
    print("ANALYSIS")
    print("=" * 70)

    no_mw_p50 = results.get("2_no_middleware", {}).get("p50", 0)
    if no_mw_p50 > 0 and full_p50 > 0:
        middleware_cost = full_p50 - no_mw_p50
        print(f"\nTotal middleware overhead: {middleware_cost:.1f}ms")
        print(f"  (Full app: {full_p50:.1f}ms - No middleware: {no_mw_p50:.1f}ms)")

    # Find biggest contributor
    print("\nMiddleware impact (smaller = that middleware costs more):")
    for name, result in sorted(results.items()):
        if name.startswith(("4_", "5_", "6_")):
            diff = full_p50 - result["p50"]
            if diff > 5:
                mw_name = name.split("_", 2)[2]
                print(f"  - Removing {mw_name}: saves {diff:.1f}ms")


if __name__ == "__main__":
    asyncio.run(main())
