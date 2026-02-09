#!/usr/bin/env python3
"""
Middleware + I/O impact analysis.

Extends the middleware analysis to include simulated I/O operations
similar to what the actual /health endpoint does.

Run with: uv run python performance/profiling/middleware_with_io.py

Tests:
1. Bare FastAPI (baseline)
2. + All middleware
3. + Simulated DB call (asyncio.sleep)
4. + Simulated Redis call
5. + FastAPI Depends() overhead
"""
import asyncio
import statistics
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import httpx


APP_VARIANTS = {
    "1_bare": '''
from fastapi import FastAPI

app = FastAPI()

@app.get("/health")
async def health():
    return {"status": "ok"}
''',

    "2_all_middleware": '''
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint

app = FastAPI()

class RateLimitHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = "100"
        response.headers["X-RateLimit-Remaining"] = "99"
        return response

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

app.add_middleware(RateLimitHeadersMiddleware)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

@app.get("/health")
async def health():
    return {"status": "ok"}
''',

    "3_with_db_io": '''
import asyncio
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint

app = FastAPI()

class RateLimitHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = "100"
        return response

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

app.add_middleware(RateLimitHeadersMiddleware)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

@app.get("/health")
async def health():
    # Simulate DB query (SELECT 1) - typically ~1-2ms
    await asyncio.sleep(0.001)
    return {"status": "ok", "database": "healthy"}
''',

    "4_with_db_and_redis": '''
import asyncio
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint

app = FastAPI()

class RateLimitHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = "100"
        return response

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

app.add_middleware(RateLimitHeadersMiddleware)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

@app.get("/health")
async def health():
    # Simulate DB query + Redis ping
    await asyncio.sleep(0.001)  # DB
    await asyncio.sleep(0.0005)  # Redis
    return {"status": "ok", "database": "healthy", "redis": "connected"}
''',

    "5_with_depends": '''
import asyncio
from fastapi import FastAPI, Request, Response, Depends
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint

app = FastAPI()

class RateLimitHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = "100"
        return response

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

app.add_middleware(RateLimitHeadersMiddleware)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# Simulate dependency that acquires a resource
async def get_db_session():
    await asyncio.sleep(0.0005)  # Pool checkout
    yield "session"
    # cleanup

async def get_redis():
    return "redis_client"

@app.get("/health")
async def health(db = Depends(get_db_session), redis = Depends(get_redis)):
    # Simulate DB query + Redis ping
    await asyncio.sleep(0.001)  # DB query
    await asyncio.sleep(0.0005)  # Redis ping
    return {"status": "ok", "database": "healthy", "redis": "connected"}
''',

    "6_many_routers": '''
import asyncio
from fastapi import FastAPI, Request, Response, Depends, APIRouter
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint

app = FastAPI()

class RateLimitHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = "100"
        return response

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

app.add_middleware(RateLimitHeadersMiddleware)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# Simulate many routers like the real app has
for i in range(12):  # Similar to actual app router count
    router = APIRouter(prefix=f"/router{i}", tags=[f"router{i}"])
    @router.get("/items")
    async def get_items():
        return []
    app.include_router(router)

async def get_db_session():
    await asyncio.sleep(0.0005)
    yield "session"

async def get_redis():
    return "redis_client"

health_router = APIRouter(tags=["health"])

@health_router.get("/health")
async def health(db = Depends(get_db_session), redis = Depends(get_redis)):
    await asyncio.sleep(0.001)
    await asyncio.sleep(0.0005)
    return {"status": "ok", "database": "healthy", "redis": "connected"}

app.include_router(health_router)
''',
}


async def measure_concurrent(
    client: httpx.AsyncClient,
    endpoint: str,
    n: int,
) -> dict[str, float]:
    """Measure latency for n concurrent requests."""
    async def timed_request() -> float:
        start = time.perf_counter()
        await client.get(endpoint)
        return (time.perf_counter() - start) * 1000

    latencies = await asyncio.gather(*[timed_request() for _ in range(n)])
    sorted_lat = sorted(latencies)
    p95_idx = int(n * 0.95) if n >= 20 else n - 1

    return {
        "p50": sorted_lat[n // 2],
        "p95": sorted_lat[p95_idx],
        "max": max(latencies),
        "mean": statistics.mean(latencies),
    }


async def test_app_variant(
    name: str,
    code: str,
    port: int,
    concurrency_levels: list[int],
) -> dict[int, dict[str, float]]:
    """Start an app variant and measure its performance."""
    with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as f:
        f.write(code)
        app_path = Path(f.name)

    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", f"{app_path.stem}:app",
         "--host", "127.0.0.1", "--port", str(port), "--app-dir", str(app_path.parent)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    results: dict[int, dict[str, float]] = {}

    try:
        await asyncio.sleep(2)  # Give server more time to start

        async with httpx.AsyncClient(timeout=10) as client:
            for attempt in range(10):
                try:
                    resp = await client.get(f"http://localhost:{port}/health")
                    if resp.status_code == 200:
                        break
                except (httpx.ConnectError, httpx.ReadError):
                    await asyncio.sleep(0.5)
            else:
                print(f"  ERROR: Could not start {name}")
                return results

            # Warmup
            for _ in range(5):
                try:
                    await client.get(f"http://localhost:{port}/health")
                except httpx.ReadError:
                    await asyncio.sleep(0.1)

            for n in concurrency_levels:
                result = await measure_concurrent(client, f"http://localhost:{port}/health", n)
                results[n] = result
                await asyncio.sleep(0.2)

    finally:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()
        app_path.unlink(missing_ok=True)
        await asyncio.sleep(0.5)  # Give OS time to release port

    return results


async def main() -> None:
    """Run middleware + I/O impact analysis."""
    concurrency_levels = [1, 10, 50]
    base_port = 8020

    print("=" * 70)
    print("MIDDLEWARE + I/O IMPACT ANALYSIS")
    print("=" * 70)
    print("\nBuilding up from bare FastAPI to match your app's structure.\n")

    all_results: dict[str, dict[int, dict[str, float]]] = {}

    for i, (name, code) in enumerate(APP_VARIANTS.items()):
        port = base_port + i
        print(f"Testing: {name}...", end=" ", flush=True)
        results = await test_app_variant(name, code, port, concurrency_levels)
        all_results[name] = results
        if results:
            print(f"done (P50@50: {results.get(50, {}).get('p50', 0):.1f}ms)")
        else:
            print("failed")
        await asyncio.sleep(0.5)

    # Results table
    print("\n" + "=" * 70)
    print("RESULTS: P50 Latency (ms)")
    print("=" * 70)
    print(f"\n{'Configuration':<30} | {'@1':>8} | {'@10':>8} | {'@50':>8}")
    print("-" * 30 + "-+-" + "-" * 8 + "-+-" + "-" * 8 + "-+-" + "-" * 8)

    for name, results in all_results.items():
        if not results:
            continue
        p50_1 = results.get(1, {}).get("p50", 0)
        p50_10 = results.get(10, {}).get("p50", 0)
        p50_50 = results.get(50, {}).get("p50", 0)
        print(f"{name:<30} | {p50_1:>7.1f}ms | {p50_10:>7.1f}ms | {p50_50:>7.1f}ms")

    # Incremental analysis
    print("\n" + "=" * 70)
    print("INCREMENTAL COST (at 50 concurrent)")
    print("=" * 70)

    prev_p50 = 0
    for name, results in all_results.items():
        if not results:
            continue
        p50_50 = results.get(50, {}).get("p50", 0)
        delta = p50_50 - prev_p50
        if prev_p50 == 0:
            print(f"\n{name:<30}: {p50_50:>6.1f}ms (baseline)")
        else:
            sign = "+" if delta >= 0 else ""
            print(f"{name:<30}: {p50_50:>6.1f}ms ({sign}{delta:>5.1f}ms)")
        prev_p50 = p50_50

    # Compare with actual app
    print("\n" + "=" * 70)
    print("COMPARISON WITH YOUR APP")
    print("=" * 70)

    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get("http://localhost:8000/health")
            if resp.status_code == 200:
                for _ in range(5):
                    await client.get("http://localhost:8000/health")

                result = await measure_concurrent(client, "http://localhost:8000/health", 50)
                simulated = all_results.get("6_many_routers", {}).get(50, {}).get("p50", 0)

                print(f"\nYour app /health @50:     {result['p50']:>6.1f}ms P50")
                print(f"Best simulation @50:      {simulated:>6.1f}ms P50")
                print(f"Unexplained gap:          {result['p50'] - simulated:>6.1f}ms")

                if result['p50'] - simulated > 50:
                    print("\nPossible causes for the gap:")
                    print("  - Real DB connection pool overhead (vs simulated sleep)")
                    print("  - Real Redis network latency (vs simulated sleep)")
                    print("  - SQLAlchemy ORM overhead")
                    print("  - Pydantic validation/serialization")
                    print("  - Import/initialization overhead")
    except (httpx.ConnectError, httpx.ReadTimeout):
        print("\nYour app not running on port 8000 - skipping comparison")


if __name__ == "__main__":
    asyncio.run(main())
