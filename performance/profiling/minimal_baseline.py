#!/usr/bin/env python3
"""
Minimal FastAPI baseline test.

Creates a bare-bones FastAPI app and measures latency under concurrent load.
This establishes the baseline overhead of FastAPI/uvicorn without any
application code, middleware, or database.

Run with: uv run python performance/profiling/minimal_baseline.py

Compares:
- Minimal FastAPI (no middleware, no DB)
- Your app's /health endpoint
- Your app's /notes/ endpoint (with DB)
"""
import asyncio
import statistics
import subprocess
import sys
import time
from pathlib import Path

import httpx


MINIMAL_APP_CODE = '''
from fastapi import FastAPI

app = FastAPI()

@app.get("/health")
async def health():
    return {"status": "ok"}
'''


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


async def test_endpoint(
    base_url: str,
    endpoint: str,
    name: str,
    concurrency_levels: list[int],
) -> None:
    """Test an endpoint at various concurrency levels."""
    print(f"\n{name}:")
    print(f"  {'Conc':>5} | {'P50':>8} | {'P95':>8} | {'Max':>8} | {'Mean':>8}")
    print(f"  {'-'*5}-+-{'-'*8}-+-{'-'*8}-+-{'-'*8}-+-{'-'*8}")

    async with httpx.AsyncClient(base_url=base_url, timeout=30) as client:
        # Warmup
        for _ in range(3):
            await client.get(endpoint)

        for n in concurrency_levels:
            result = await measure_concurrent(client, endpoint, n)
            print(
                f"  {n:5} | {result['p50']:7.1f}ms | {result['p95']:7.1f}ms | "
                f"{result['max']:7.1f}ms | {result['mean']:7.1f}ms"
            )
            await asyncio.sleep(0.1)


async def main() -> None:
    """Run baseline comparison tests."""
    concurrency = [1, 10, 50]

    # Write minimal app to temp file
    minimal_app_path = Path("/tmp/minimal_fastapi_baseline.py")
    minimal_app_path.write_text(MINIMAL_APP_CODE)

    # Start minimal server
    print("Starting minimal FastAPI server on port 8001...")
    minimal_proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "minimal_fastapi_baseline:app",
         "--host", "127.0.0.1", "--port", "8001", "--app-dir", "/tmp"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    await asyncio.sleep(2)  # Wait for startup

    try:
        # Verify minimal server is running
        async with httpx.AsyncClient() as client:
            try:
                resp = await client.get("http://localhost:8001/health")
                if resp.status_code != 200:
                    print("ERROR: Minimal server not responding")
                    return
            except httpx.ConnectError:
                print("ERROR: Could not connect to minimal server on port 8001")
                return

        print("\n" + "=" * 60)
        print("BASELINE COMPARISON")
        print("=" * 60)

        # Test minimal FastAPI
        await test_endpoint(
            "http://localhost:8001",
            "/health",
            "Minimal FastAPI (no middleware, no DB)",
            concurrency,
        )

        # Test app's health endpoint (if running)
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get("http://localhost:8000/health", timeout=2)
                if resp.status_code == 200:
                    await test_endpoint(
                        "http://localhost:8000",
                        "/health",
                        "App /health (with middleware, no DB query)",
                        concurrency,
                    )

                    await test_endpoint(
                        "http://localhost:8000",
                        "/notes/",
                        "App /notes/ (with middleware + DB)",
                        concurrency,
                    )
        except (httpx.ConnectError, httpx.ReadTimeout):
            print("\nNote: App server not running on port 8000, skipping app tests")
            print("Start with: VITE_DEV_MODE=true make run")

        print("\n" + "=" * 60)
        print("INTERPRETATION")
        print("=" * 60)
        print("""
- Minimal FastAPI baseline shows pure framework overhead
- Difference between minimal and app /health = middleware cost
- Difference between /health and /notes/ = database + auth cost
- High latency at 50 concurrent even on minimal = normal for single-worker async
""")

    finally:
        minimal_proc.terminate()
        minimal_proc.wait()
        print("Minimal server stopped.")


if __name__ == "__main__":
    asyncio.run(main())
