#!/usr/bin/env python3
"""
Middleware impact analysis.

Measures the performance impact of each middleware layer under concurrent load
by incrementally adding middleware to a minimal FastAPI app.

Run with: uv run python performance/profiling/middleware_impact.py

Tests these configurations:
1. Bare FastAPI (baseline)
2. + CORS middleware
3. + BaseHTTPMiddleware (empty, measures wrapper overhead)
4. + Security headers middleware
5. + ETag middleware (computes hash of response)
6. + Rate limit headers middleware
7. All middleware combined
"""
import asyncio
import statistics
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import httpx


# Each app variant as a string - will be written to temp files
APP_VARIANTS = {
    "1_bare": '''
from fastapi import FastAPI

app = FastAPI()

@app.get("/health")
async def health():
    return {"status": "ok"}
''',

    "2_cors": '''
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health():
    return {"status": "ok"}
''',

    "3_base_http_middleware": '''
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint

app = FastAPI()

class EmptyMiddleware(BaseHTTPMiddleware):
    """Empty middleware - measures BaseHTTPMiddleware wrapper overhead."""
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        return await call_next(request)

app.add_middleware(EmptyMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health():
    return {"status": "ok"}
''',

    "4_security_headers": '''
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint

app = FastAPI()

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add security headers to all responses."""
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        return response

app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health():
    return {"status": "ok"}
''',

    "5_etag": '''
import hashlib
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint

app = FastAPI()

class ETagMiddleware(BaseHTTPMiddleware):
    """Generate ETag from response body."""
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)
        # Read body and compute hash (simplified version)
        body = b""
        async for chunk in response.body_iterator:
            body += chunk
        etag = hashlib.md5(body).hexdigest()
        return Response(
            content=body,
            status_code=response.status_code,
            headers=dict(response.headers),
            media_type=response.media_type,
        )

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        return response

app.add_middleware(ETagMiddleware)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health():
    return {"status": "ok"}
''',

    "6_ratelimit_headers": '''
import hashlib
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint

app = FastAPI()

class RateLimitHeadersMiddleware(BaseHTTPMiddleware):
    """Add rate limit headers (simulated)."""
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = "100"
        response.headers["X-RateLimit-Remaining"] = "99"
        response.headers["X-RateLimit-Reset"] = "1234567890"
        return response

class ETagMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)
        body = b""
        async for chunk in response.body_iterator:
            body += chunk
        etag = hashlib.md5(body).hexdigest()
        return Response(
            content=body,
            status_code=response.status_code,
            headers=dict(response.headers),
            media_type=response.media_type,
        )

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        return response

app.add_middleware(RateLimitHeadersMiddleware)
app.add_middleware(ETagMiddleware)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health():
    return {"status": "ok"}
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
    # Write code to temp file
    with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as f:
        f.write(code)
        app_path = Path(f.name)

    # Start server
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", f"{app_path.stem}:app",
         "--host", "127.0.0.1", "--port", str(port), "--app-dir", str(app_path.parent)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    results: dict[int, dict[str, float]] = {}

    try:
        await asyncio.sleep(1.5)  # Wait for startup

        # Verify server is running
        async with httpx.AsyncClient(timeout=5) as client:
            for attempt in range(5):
                try:
                    resp = await client.get(f"http://localhost:{port}/health")
                    if resp.status_code == 200:
                        break
                except httpx.ConnectError:
                    await asyncio.sleep(0.5)
            else:
                print(f"  ERROR: Could not start {name}")
                return results

            # Warmup
            for _ in range(5):
                await client.get(f"http://localhost:{port}/health")

            # Test each concurrency level
            for n in concurrency_levels:
                result = await measure_concurrent(client, f"http://localhost:{port}/health", n)
                results[n] = result
                await asyncio.sleep(0.1)

    finally:
        proc.terminate()
        proc.wait()
        app_path.unlink()

    return results


async def main() -> None:
    """Run middleware impact analysis."""
    concurrency_levels = [1, 10, 50]
    base_port = 8010

    print("=" * 70)
    print("MIDDLEWARE IMPACT ANALYSIS")
    print("=" * 70)
    print("\nMeasuring performance impact of each middleware layer under load.\n")

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

    # Print results table
    print("\n" + "=" * 70)
    print("RESULTS: P50 Latency (ms)")
    print("=" * 70)
    print(f"\n{'Configuration':<35} | {'@1':>8} | {'@10':>8} | {'@50':>8}")
    print("-" * 35 + "-+-" + "-" * 8 + "-+-" + "-" * 8 + "-+-" + "-" * 8)

    baseline_50 = None
    for name, results in all_results.items():
        if not results:
            continue
        p50_1 = results.get(1, {}).get("p50", 0)
        p50_10 = results.get(10, {}).get("p50", 0)
        p50_50 = results.get(50, {}).get("p50", 0)

        if baseline_50 is None:
            baseline_50 = p50_50

        print(f"{name:<35} | {p50_1:>7.1f}ms | {p50_10:>7.1f}ms | {p50_50:>7.1f}ms")

    # Print incremental cost analysis
    print("\n" + "=" * 70)
    print("INCREMENTAL COST ANALYSIS (at 50 concurrent)")
    print("=" * 70)

    prev_p50 = 0
    for name, results in all_results.items():
        if not results:
            continue
        p50_50 = results.get(50, {}).get("p50", 0)
        delta = p50_50 - prev_p50
        if prev_p50 == 0:
            print(f"\n{name:<35}: {p50_50:>7.1f}ms (baseline)")
        else:
            print(f"{name:<35}: {p50_50:>7.1f}ms (+{delta:>6.1f}ms)")
        prev_p50 = p50_50

    # Compare with actual app if running
    print("\n" + "=" * 70)
    print("COMPARISON WITH YOUR APP")
    print("=" * 70)

    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get("http://localhost:8000/health")
            if resp.status_code == 200:
                # Warmup
                for _ in range(5):
                    await client.get("http://localhost:8000/health")

                result = await measure_concurrent(client, "http://localhost:8000/health", 50)
                print(f"\nYour app /health @50 concurrent: {result['p50']:.1f}ms P50")

                # Get simulated total
                simulated = all_results.get("6_ratelimit_headers", {}).get(50, {}).get("p50", 0)
                print(f"Simulated middleware stack @50:    {simulated:.1f}ms P50")
                print(f"Difference:                        {result['p50'] - simulated:.1f}ms")
                print("\n(Difference may be due to additional app initialization, dependencies, etc.)")
    except (httpx.ConnectError, httpx.ReadTimeout):
        print("\nYour app not running on port 8000 - skipping comparison")
        print("Start with: VITE_DEV_MODE=true make run")


if __name__ == "__main__":
    asyncio.run(main())
