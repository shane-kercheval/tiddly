"""
API Performance Benchmark Script.

Measures API latency and throughput under concurrent load by making real HTTP
requests to a running local API server.

PURPOSE:
    Establish performance baselines and detect regressions. Unlike unit tests or
    isolated benchmarks, this tests the full stack: HTTP routing, database queries,
    ORM operations, and response serialization.

USE CASES:
    - Establish baseline performance metrics before major changes
    - Compare before/after metrics when adding features (e.g., content versioning,
      audit logging, caching layers)
    - Identify bottlenecks under concurrent load
    - Validate that performance meets acceptable thresholds

REQUIREMENTS:
    - Local API server running with dev mode: `VITE_DEV_MODE=true make run`
    - Docker services running: `make docker-up` (PostgreSQL, Redis)

LIMITATION - NO AUTH OVERHEAD:
    These benchmarks run in dev mode (no authentication) because PAT-based auth
    has rate limits (120 reads/min, 60 writes/min) that are too restrictive for
    load testing. This means the benchmarks measure pure API/database performance
    but do NOT include authentication overhead (token validation, user lookup,
    auth caching). For most use cases this is acceptable since auth overhead is
    typically small (~5-10ms) and consistent.

WHAT IT TESTS:
    - Create operations (notes, bookmarks)
    - Update operations (content changes)
    - Read operations (single item fetch)
    - List/search operations
    - Soft delete operations
    - Hard delete operations

METRICS CAPTURED:
    - Latency percentiles: P50, P95, P99, Min, Max
    - Mean latency and standard deviation
    - Throughput: requests per second
    - Error rate under load

CONCURRENCY:
    Tests run at multiple concurrency levels (default: 10, 50, 100) to understand
    how the API behaves as load increases. This simulates multiple users performing
    operations simultaneously.

OUTPUT:
    Generates a markdown report in performance/results/ with timestamped filename.

Run with: uv run python performance/scripts/benchmark_api.py

Options:
    --base-url URL      API base URL (default: http://localhost:8000)
    --concurrency N     Comma-separated concurrency levels (default: 10,50,100)
    --iterations N      Requests per concurrency level (default: 100)
"""
import argparse
import asyncio
import contextlib
import statistics
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from itertools import count
from pathlib import Path
from typing import Any

import httpx




@dataclass
class BenchmarkResult:
    """Result of a single benchmark test."""

    operation: str
    concurrency: int
    total_requests: int
    successful: int
    failed: int
    min_ms: float
    p50_ms: float
    p95_ms: float
    p99_ms: float
    max_ms: float
    mean_ms: float
    stddev_ms: float
    throughput_rps: float
    error_rate_pct: float


def calculate_percentiles(latencies: list[float]) -> dict[str, float]:
    """Calculate latency percentiles from a list of latencies."""
    if not latencies:
        return {
            "min": 0, "p50": 0, "p95": 0, "p99": 0, "max": 0,
            "mean": 0, "stddev": 0,
        }

    sorted_latencies = sorted(latencies)
    n = len(sorted_latencies)

    # Use statistics.quantiles for proper percentile calculation
    if n >= 4:
        quantiles = statistics.quantiles(sorted_latencies, n=100)
        p50 = quantiles[49]
        p95 = quantiles[94]
        p99 = quantiles[98]
    else:
        # Fallback for small sample sizes
        p50 = sorted_latencies[n // 2]
        p95 = sorted_latencies[min(int(n * 0.95), n - 1)]
        p99 = sorted_latencies[min(int(n * 0.99), n - 1)]

    return {
        "min": round(sorted_latencies[0], 2),
        "p50": round(p50, 2),
        "p95": round(p95, 2),
        "p99": round(p99, 2),
        "max": round(sorted_latencies[-1], 2),
        "mean": round(statistics.mean(sorted_latencies), 2),
        "stddev": round(statistics.stdev(sorted_latencies), 2) if n > 1 else 0,
    }


class ApiBenchmark:
    """Benchmarks API operations under concurrent load."""

    def __init__(
        self,
        base_url: str,
        iterations: int = 100,
        content_size_kb: int = 50,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.iterations = iterations
        self.content_size_kb = content_size_kb
        self.content = "x" * (content_size_kb * 1024)  # Pre-generate content
        self.created_note_ids: list[str] = []
        self.created_bookmark_ids: list[str] = []
        self.created_prompt_ids: list[str] = []

    async def _make_request(
        self,
        client: httpx.AsyncClient,
        method: str,
        path: str,
        json: dict | None = None,
        params: dict | None = None,
    ) -> tuple[float, bool, dict | None]:
        """Make a single request and return (latency_ms, success, response_data)."""
        url = f"{self.base_url}{path}"
        start = time.perf_counter()
        try:
            if method == "GET":
                response = await client.get(url, params=params)
            elif method == "POST":
                response = await client.post(url, json=json)
            elif method == "PATCH":
                response = await client.patch(url, json=json)
            elif method == "DELETE":
                response = await client.delete(url, params=params)
            else:
                raise ValueError(f"Unknown method: {method}")

            latency_ms = (time.perf_counter() - start) * 1000
            success = response.status_code < 400

            # Try to parse response JSON for tracking created resources
            data = None
            if success and method == "POST":
                with contextlib.suppress(Exception):
                    data = response.json()

            return latency_ms, success, data
        except Exception:
            latency_ms = (time.perf_counter() - start) * 1000
            return latency_ms, False, None

    async def warmup(self, client: httpx.AsyncClient, max_concurrency: int) -> None:
        """Warm up connections and caches before benchmarking.

        This performs both sequential warmup (for code paths, JIT, caches) and
        concurrent warmup (to pre-fill the database connection pool).

        Without concurrent warmup, the first high-concurrency test would include
        connection pool initialization time (~500ms for 50 connections), skewing
        the benchmark results.
        """
        print("Warming up...", end=" ", flush=True)

        # Sequential warmup: warm code paths, JIT, response caches
        for _ in range(5):
            await client.get(f"{self.base_url}/health")

        # Concurrent warmup: fill the database connection pool
        # This ensures all connections are established before timing starts
        await asyncio.gather(*[
            client.get(f"{self.base_url}/health")
            for _ in range(max_concurrency)
        ])

        # Also warm up an API endpoint that uses more code paths
        for _ in range(5):
            await client.get(
                f"{self.base_url}/notes/",
                params={"limit": 1},
            )

        print("done")

    async def _run_concurrent(
        self,
        client: httpx.AsyncClient,
        operation_name: str,
        concurrency: int,
        request_fn: Callable[[], tuple[str, str, dict | None, dict | None]],
        track_created_ids: list[str] | None = None,
    ) -> BenchmarkResult:
        """
        Run concurrent requests and collect metrics.

        Args:
            client: HTTP client
            operation_name: Name of the operation for reporting
            concurrency: Maximum concurrent requests
            request_fn: Function that returns (method, path, json_data, params)
            track_created_ids: If provided, append created resource IDs to this list
        """
        semaphore = asyncio.Semaphore(concurrency)
        latencies: list[float] = []
        successes = 0
        failures = 0
        latencies_lock = asyncio.Lock()

        async def bounded_request() -> None:
            nonlocal successes, failures
            async with semaphore:
                method, path, json_data, params = request_fn()
                latency, success, data = await self._make_request(
                    client, method, path, json_data, params,
                )
                async with latencies_lock:
                    latencies.append(latency)
                    if success:
                        successes += 1
                        # Track created resource IDs if requested
                        if track_created_ids is not None and data and "id" in data:
                            track_created_ids.append(data["id"])
                    else:
                        failures += 1

        start = time.perf_counter()
        tasks = [bounded_request() for _ in range(self.iterations)]
        await asyncio.gather(*tasks)
        total_time = time.perf_counter() - start

        total = successes + failures
        percentiles = calculate_percentiles(latencies)

        return BenchmarkResult(
            operation=operation_name,
            concurrency=concurrency,
            total_requests=total,
            successful=successes,
            failed=failures,
            min_ms=percentiles["min"],
            p50_ms=percentiles["p50"],
            p95_ms=percentiles["p95"],
            p99_ms=percentiles["p99"],
            max_ms=percentiles["max"],
            mean_ms=percentiles["mean"],
            stddev_ms=percentiles["stddev"],
            throughput_rps=round(total / total_time, 1) if total_time > 0 else 0,
            error_rate_pct=round((failures / total) * 100, 1) if total > 0 else 0,
        )

    async def _cleanup_notes(self, client: httpx.AsyncClient) -> None:
        """Hard delete all created notes."""
        for note_id in self.created_note_ids:
            with contextlib.suppress(Exception):
                await client.delete(
                    f"{self.base_url}/notes/{note_id}",
                    params={"permanent": "true"},
                )
        self.created_note_ids.clear()

    async def _cleanup_bookmarks(self, client: httpx.AsyncClient) -> None:
        """Hard delete all created bookmarks."""
        for bookmark_id in self.created_bookmark_ids:
            with contextlib.suppress(Exception):
                await client.delete(
                    f"{self.base_url}/bookmarks/{bookmark_id}",
                    params={"permanent": "true"},
                )
        self.created_bookmark_ids.clear()

    async def _cleanup_prompts(self, client: httpx.AsyncClient) -> None:
        """Hard delete all created prompts."""
        for prompt_id in self.created_prompt_ids:
            with contextlib.suppress(Exception):
                await client.delete(
                    f"{self.base_url}/prompts/{prompt_id}",
                    params={"permanent": "true"},
                )
        self.created_prompt_ids.clear()

    async def _cleanup_leftover_benchmark_items(
        self, client: httpx.AsyncClient,
    ) -> None:
        """Clean up leftover items from previous benchmark runs.

        This handles cases where a previous run crashed or was interrupted,
        leaving test items in the database. We search for items with
        benchmark-specific patterns and delete them.
        """
        print("Cleaning up leftover items from previous runs...", end=" ", flush=True)
        deleted = 0

        # Clean up notes with benchmark-related titles
        for query in ["Benchmark Note", "Test Note", "Soft Delete Test", "Hard Delete Test"]:
            with contextlib.suppress(Exception):
                response = await client.get(
                    f"{self.base_url}/notes/",
                    params={"query": query, "limit": 200, "include_deleted": "true"},
                )
                if response.status_code == 200:
                    for item in response.json().get("items", []):
                        with contextlib.suppress(Exception):
                            await client.delete(
                                f"{self.base_url}/notes/{item['id']}",
                                params={"permanent": "true"},
                            )
                            deleted += 1

        # Clean up bookmarks with benchmark-related titles/urls
        for query in ["Benchmark Bookmark", "Test Bookmark", "Soft Delete Test", "Hard Delete Test"]:
            with contextlib.suppress(Exception):
                response = await client.get(
                    f"{self.base_url}/bookmarks/",
                    params={"query": query, "limit": 200, "include_deleted": "true"},
                )
                if response.status_code == 200:
                    for item in response.json().get("items", []):
                        with contextlib.suppress(Exception):
                            await client.delete(
                                f"{self.base_url}/bookmarks/{item['id']}",
                                params={"permanent": "true"},
                            )
                            deleted += 1

        # Clean up prompts with benchmark-related names
        for query in ["benchmark-prompt", "soft-delete-prompt", "hard-delete-prompt"]:
            with contextlib.suppress(Exception):
                response = await client.get(
                    f"{self.base_url}/prompts/",
                    params={"query": query, "limit": 200, "include_deleted": "true"},
                )
                if response.status_code == 200:
                    for item in response.json().get("items", []):
                        with contextlib.suppress(Exception):
                            await client.delete(
                                f"{self.base_url}/prompts/{item['id']}",
                                params={"permanent": "true"},
                            )
                            deleted += 1

        print(f"done ({deleted} items)")

    async def _ensure_notes_exist(
        self, client: httpx.AsyncClient, min_count: int = 50,
    ) -> None:
        """Ensure we have enough notes for read/update tests."""
        if len(self.created_note_ids) >= min_count:
            return
        needed = min_count - len(self.created_note_ids)
        for i in range(needed):
            response = await client.post(
                f"{self.base_url}/notes/",
                json={
                    "title": f"Test Note {i}",
                    "content": f"Test Note {i}\n\n{self.content}",
                },
            )
            if response.status_code < 400:
                self.created_note_ids.append(response.json()["id"])

    async def _ensure_bookmarks_exist(
        self, client: httpx.AsyncClient, min_count: int = 50,
    ) -> None:
        """Ensure we have enough bookmarks for read/update tests."""
        if len(self.created_bookmark_ids) >= min_count:
            return
        needed = min_count - len(self.created_bookmark_ids)
        for i in range(needed):
            response = await client.post(
                f"{self.base_url}/bookmarks/",
                json={
                    "url": f"https://example-setup-{i}-{time.time_ns()}.com/page",
                    "title": f"Test Bookmark {i}",
                    "description": f"Test Bookmark {i}",
                    "content": self.content,
                },
            )
            if response.status_code < 400:
                self.created_bookmark_ids.append(response.json()["id"])

    async def _ensure_prompts_exist(
        self, client: httpx.AsyncClient, min_count: int = 50,
    ) -> None:
        """Ensure we have enough prompts for read/update tests."""
        if len(self.created_prompt_ids) >= min_count:
            return
        needed = min_count - len(self.created_prompt_ids)
        for i in range(needed):
            # Large content with template variables preserved
            prompt_body = self.content
            large_prompt = f"Summarize {{{{ topic }}}} in {{{{ style }}}} format.\n\n{prompt_body}"
            response = await client.post(
                f"{self.base_url}/prompts/",
                json={
                    "name": f"benchmark-prompt-{i}-{time.time_ns()}",
                    "content": large_prompt,
                    "arguments": [
                        {"name": "topic", "description": "The topic to summarize"},
                        {"name": "style", "description": "Writing style"},
                    ],
                },
            )
            if response.status_code < 400:
                self.created_prompt_ids.append(response.json()["id"])

    # -------------------------------------------------------------------------
    # Note Benchmarks
    # -------------------------------------------------------------------------

    async def benchmark_create_notes(
        self, client: httpx.AsyncClient, concurrency: int,
    ) -> BenchmarkResult:
        """Benchmark note creation."""
        counter = count(1)
        content = self.content

        def make_request() -> tuple[str, str, dict[str, Any] | None, dict[str, Any] | None]:
            n = next(counter)
            return (
                "POST",
                "/notes/",
                {
                    "title": f"Benchmark Note {n}",
                    "content": f"Benchmark Note {n}\n\n{content}",
                },
                None,
            )

        return await self._run_concurrent(
            client, "Create Note", concurrency, make_request,
            track_created_ids=self.created_note_ids,
        )

    async def benchmark_update_notes(
        self, client: httpx.AsyncClient, concurrency: int,
    ) -> BenchmarkResult:
        """Benchmark note updates."""
        await self._ensure_notes_exist(client)

        if not self.created_note_ids:
            return self._empty_result("Update Note", concurrency)

        note_ids = list(self.created_note_ids)
        counter = count(1)
        content = self.content

        def make_request() -> tuple[str, str, dict[str, Any] | None, dict[str, Any] | None]:
            n = next(counter)
            note_id = note_ids[n % len(note_ids)]
            return (
                "PATCH",
                f"/notes/{note_id}",
                {"content": f"Updated Note v{n}\n\n{content}"},
                None,
            )

        return await self._run_concurrent(client, "Update Note", concurrency, make_request)

    async def benchmark_read_notes(
        self, client: httpx.AsyncClient, concurrency: int,
    ) -> BenchmarkResult:
        """Benchmark reading individual notes."""
        await self._ensure_notes_exist(client)

        if not self.created_note_ids:
            return self._empty_result("Read Note", concurrency)

        note_ids = list(self.created_note_ids)
        counter = count(0)

        def make_request() -> tuple[str, str, dict[str, Any] | None, dict[str, Any] | None]:
            n = next(counter)
            note_id = note_ids[n % len(note_ids)]
            return ("GET", f"/notes/{note_id}", None, None)

        return await self._run_concurrent(client, "Read Note", concurrency, make_request)

    async def benchmark_list_notes(
        self, client: httpx.AsyncClient, concurrency: int,
    ) -> BenchmarkResult:
        """Benchmark listing notes."""

        def make_request() -> tuple[str, str, dict[str, Any] | None, dict[str, Any] | None]:
            return ("GET", "/notes/", None, {"limit": 20})

        return await self._run_concurrent(client, "List Notes", concurrency, make_request)

    async def benchmark_search_notes(
        self, client: httpx.AsyncClient, concurrency: int,
    ) -> BenchmarkResult:
        """Benchmark searching notes with a query."""

        def make_request() -> tuple[str, str, dict[str, Any] | None, dict[str, Any] | None]:
            return ("GET", "/notes/", None, {"query": "benchmark", "limit": 20})

        return await self._run_concurrent(client, "Search Notes", concurrency, make_request)

    async def benchmark_soft_delete_notes(
        self, client: httpx.AsyncClient, concurrency: int,
    ) -> BenchmarkResult:
        """Benchmark soft deleting notes."""
        # Create fresh notes for deletion
        delete_ids: list[str] = []
        for i in range(self.iterations):
            response = await client.post(
                f"{self.base_url}/notes/",
                json={"title": f"Soft Delete Test {i}", "content": "To be soft deleted"},
            )
            if response.status_code < 400:
                delete_ids.append(response.json()["id"])

        if not delete_ids:
            return self._empty_result("Soft Delete Note", concurrency)

        counter = count(0)

        def make_request() -> tuple[str, str, dict[str, Any] | None, dict[str, Any] | None]:
            n = next(counter)
            note_id = delete_ids[n % len(delete_ids)]
            return ("DELETE", f"/notes/{note_id}", None, {"permanent": "false"})

        result = await self._run_concurrent(
            client, "Soft Delete Note", concurrency, make_request,
        )

        # Add remaining to cleanup list
        self.created_note_ids.extend(delete_ids)
        return result

    async def benchmark_hard_delete_notes(
        self, client: httpx.AsyncClient, concurrency: int,
    ) -> BenchmarkResult:
        """Benchmark hard deleting notes."""
        # Create fresh notes for deletion
        delete_ids: list[str] = []
        for i in range(self.iterations):
            response = await client.post(
                f"{self.base_url}/notes/",
                json={"title": f"Hard Delete Test {i}", "content": "To be hard deleted"},
            )
            if response.status_code < 400:
                delete_ids.append(response.json()["id"])

        if not delete_ids:
            return self._empty_result("Hard Delete Note", concurrency)

        counter = count(0)

        def make_request() -> tuple[str, str, dict[str, Any] | None, dict[str, Any] | None]:
            n = next(counter)
            note_id = delete_ids[n % len(delete_ids)]
            return ("DELETE", f"/notes/{note_id}", None, {"permanent": "true"})

        return await self._run_concurrent(
            client, "Hard Delete Note", concurrency, make_request,
        )

    # -------------------------------------------------------------------------
    # Bookmark Benchmarks
    # -------------------------------------------------------------------------

    async def benchmark_create_bookmarks(
        self, client: httpx.AsyncClient, concurrency: int,
    ) -> BenchmarkResult:
        """Benchmark bookmark creation."""
        counter = count(1)
        content = self.content

        def make_request() -> tuple[str, str, dict[str, Any] | None, dict[str, Any] | None]:
            n = next(counter)
            return (
                "POST",
                "/bookmarks/",
                {
                    "url": f"https://example-{n}-{time.time_ns()}.com/page",
                    "title": f"Benchmark Bookmark {n}",
                    "description": f"Benchmark Bookmark {n}",
                    "content": content,
                },
                None,
            )

        return await self._run_concurrent(
            client, "Create Bookmark", concurrency, make_request,
            track_created_ids=self.created_bookmark_ids,
        )

    async def benchmark_update_bookmarks(
        self, client: httpx.AsyncClient, concurrency: int,
    ) -> BenchmarkResult:
        """Benchmark bookmark updates."""
        await self._ensure_bookmarks_exist(client)

        if not self.created_bookmark_ids:
            return self._empty_result("Update Bookmark", concurrency)

        bookmark_ids = list(self.created_bookmark_ids)
        counter = count(1)
        content = self.content

        def make_request() -> tuple[str, str, dict[str, Any] | None, dict[str, Any] | None]:
            n = next(counter)
            bookmark_id = bookmark_ids[n % len(bookmark_ids)]
            return (
                "PATCH",
                f"/bookmarks/{bookmark_id}",
                {"content": f"Updated v{n}\n\n{content}"},
                None,
            )

        return await self._run_concurrent(
            client, "Update Bookmark", concurrency, make_request,
        )

    async def benchmark_read_bookmarks(
        self, client: httpx.AsyncClient, concurrency: int,
    ) -> BenchmarkResult:
        """Benchmark reading individual bookmarks."""
        await self._ensure_bookmarks_exist(client)

        if not self.created_bookmark_ids:
            return self._empty_result("Read Bookmark", concurrency)

        bookmark_ids = list(self.created_bookmark_ids)
        counter = count(0)

        def make_request() -> tuple[str, str, dict[str, Any] | None, dict[str, Any] | None]:
            n = next(counter)
            bookmark_id = bookmark_ids[n % len(bookmark_ids)]
            return ("GET", f"/bookmarks/{bookmark_id}", None, None)

        return await self._run_concurrent(
            client, "Read Bookmark", concurrency, make_request,
        )

    async def benchmark_list_bookmarks(
        self, client: httpx.AsyncClient, concurrency: int,
    ) -> BenchmarkResult:
        """Benchmark listing bookmarks."""

        def make_request() -> tuple[str, str, dict[str, Any] | None, dict[str, Any] | None]:
            return ("GET", "/bookmarks/", None, {"limit": 20})

        return await self._run_concurrent(
            client, "List Bookmarks", concurrency, make_request,
        )

    async def benchmark_search_bookmarks(
        self, client: httpx.AsyncClient, concurrency: int,
    ) -> BenchmarkResult:
        """Benchmark searching bookmarks with a query."""

        def make_request() -> tuple[str, str, dict[str, Any] | None, dict[str, Any] | None]:
            return ("GET", "/bookmarks/", None, {"query": "benchmark", "limit": 20})

        return await self._run_concurrent(
            client, "Search Bookmarks", concurrency, make_request,
        )

    async def benchmark_soft_delete_bookmarks(
        self, client: httpx.AsyncClient, concurrency: int,
    ) -> BenchmarkResult:
        """Benchmark soft deleting bookmarks."""
        # Create fresh bookmarks for deletion
        delete_ids: list[str] = []
        for i in range(self.iterations):
            response = await client.post(
                f"{self.base_url}/bookmarks/",
                json={
                    "url": f"https://soft-delete-{i}-{time.time_ns()}.com/page",
                    "title": f"Soft Delete Test {i}",
                },
            )
            if response.status_code < 400:
                delete_ids.append(response.json()["id"])

        if not delete_ids:
            return self._empty_result("Soft Delete Bookmark", concurrency)

        counter = count(0)

        def make_request() -> tuple[str, str, dict[str, Any] | None, dict[str, Any] | None]:
            n = next(counter)
            bookmark_id = delete_ids[n % len(delete_ids)]
            return ("DELETE", f"/bookmarks/{bookmark_id}", None, {"permanent": "false"})

        result = await self._run_concurrent(
            client, "Soft Delete Bookmark", concurrency, make_request,
        )

        # Add remaining to cleanup list
        self.created_bookmark_ids.extend(delete_ids)
        return result

    async def benchmark_hard_delete_bookmarks(
        self, client: httpx.AsyncClient, concurrency: int,
    ) -> BenchmarkResult:
        """Benchmark hard deleting bookmarks."""
        # Create fresh bookmarks for deletion
        delete_ids: list[str] = []
        for i in range(self.iterations):
            response = await client.post(
                f"{self.base_url}/bookmarks/",
                json={
                    "url": f"https://hard-delete-{i}-{time.time_ns()}.com/page",
                    "title": f"Hard Delete Test {i}",
                },
            )
            if response.status_code < 400:
                delete_ids.append(response.json()["id"])

        if not delete_ids:
            return self._empty_result("Hard Delete Bookmark", concurrency)

        counter = count(0)

        def make_request() -> tuple[str, str, dict[str, Any] | None, dict[str, Any] | None]:
            n = next(counter)
            bookmark_id = delete_ids[n % len(delete_ids)]
            return ("DELETE", f"/bookmarks/{bookmark_id}", None, {"permanent": "true"})

        return await self._run_concurrent(
            client, "Hard Delete Bookmark", concurrency, make_request,
        )

    # -------------------------------------------------------------------------
    # Prompt Benchmarks
    # -------------------------------------------------------------------------

    async def benchmark_create_prompts(
        self, client: httpx.AsyncClient, concurrency: int,
    ) -> BenchmarkResult:
        """Benchmark prompt creation with arguments."""
        counter = count(1)
        content = self.content

        def make_request() -> tuple[str, str, dict[str, Any] | None, dict[str, Any] | None]:
            n = next(counter)
            return (
                "POST",
                "/prompts/",
                {
                    "name": f"benchmark-prompt-{n}-{time.time_ns()}",
                    "title": f"Benchmark Prompt {n}",
                    "content": f"Summarize {{{{ topic }}}} in {{{{ style }}}} format.\n\n{content}",
                    "arguments": [
                        {"name": "topic", "description": "The topic to summarize"},
                        {"name": "style", "description": "Writing style"},
                    ],
                },
                None,
            )

        return await self._run_concurrent(
            client, "Create Prompt", concurrency, make_request,
            track_created_ids=self.created_prompt_ids,
        )

    async def benchmark_update_prompts(
        self, client: httpx.AsyncClient, concurrency: int,
    ) -> BenchmarkResult:
        """Benchmark prompt updates."""
        await self._ensure_prompts_exist(client)

        if not self.created_prompt_ids:
            return self._empty_result("Update Prompt", concurrency)

        prompt_ids = list(self.created_prompt_ids)
        counter = count(1)
        content = self.content

        def make_request() -> tuple[str, str, dict[str, Any] | None, dict[str, Any] | None]:
            n = next(counter)
            prompt_id = prompt_ids[n % len(prompt_ids)]
            return (
                "PATCH",
                f"/prompts/{prompt_id}",
                {"content": f"Updated v{n}: Summarize {{{{ topic }}}} in {{{{ style }}}} format.\n\n{content}"},
                None,
            )

        return await self._run_concurrent(client, "Update Prompt", concurrency, make_request)

    async def benchmark_read_prompts(
        self, client: httpx.AsyncClient, concurrency: int,
    ) -> BenchmarkResult:
        """Benchmark reading individual prompts."""
        await self._ensure_prompts_exist(client)

        if not self.created_prompt_ids:
            return self._empty_result("Read Prompt", concurrency)

        prompt_ids = list(self.created_prompt_ids)
        counter = count(0)

        def make_request() -> tuple[str, str, dict[str, Any] | None, dict[str, Any] | None]:
            n = next(counter)
            prompt_id = prompt_ids[n % len(prompt_ids)]
            return ("GET", f"/prompts/{prompt_id}", None, None)

        return await self._run_concurrent(client, "Read Prompt", concurrency, make_request)

    async def benchmark_list_prompts(
        self, client: httpx.AsyncClient, concurrency: int,
    ) -> BenchmarkResult:
        """Benchmark listing prompts."""

        def make_request() -> tuple[str, str, dict[str, Any] | None, dict[str, Any] | None]:
            return ("GET", "/prompts/", None, {"limit": 20})

        return await self._run_concurrent(client, "List Prompts", concurrency, make_request)

    async def benchmark_search_prompts(
        self, client: httpx.AsyncClient, concurrency: int,
    ) -> BenchmarkResult:
        """Benchmark searching prompts with a query."""

        def make_request() -> tuple[str, str, dict[str, Any] | None, dict[str, Any] | None]:
            return ("GET", "/prompts/", None, {"query": "benchmark", "limit": 20})

        return await self._run_concurrent(client, "Search Prompts", concurrency, make_request)

    async def benchmark_soft_delete_prompts(
        self, client: httpx.AsyncClient, concurrency: int,
    ) -> BenchmarkResult:
        """Benchmark soft deleting prompts."""
        # Create fresh prompts for deletion
        delete_ids: list[str] = []
        for i in range(self.iterations):
            response = await client.post(
                f"{self.base_url}/prompts/",
                json={
                    "name": f"soft-delete-prompt-{i}-{time.time_ns()}",
                    "content": "To be soft deleted {{ arg }}",
                    "arguments": [{"name": "arg"}],
                },
            )
            if response.status_code < 400:
                delete_ids.append(response.json()["id"])

        if not delete_ids:
            return self._empty_result("Soft Delete Prompt", concurrency)

        counter = count(0)

        def make_request() -> tuple[str, str, dict[str, Any] | None, dict[str, Any] | None]:
            n = next(counter)
            prompt_id = delete_ids[n % len(delete_ids)]
            return ("DELETE", f"/prompts/{prompt_id}", None, {"permanent": "false"})

        result = await self._run_concurrent(
            client, "Soft Delete Prompt", concurrency, make_request,
        )

        # Add remaining to cleanup list
        self.created_prompt_ids.extend(delete_ids)
        return result

    async def benchmark_hard_delete_prompts(
        self, client: httpx.AsyncClient, concurrency: int,
    ) -> BenchmarkResult:
        """Benchmark hard deleting prompts."""
        # Create fresh prompts for deletion
        delete_ids: list[str] = []
        for i in range(self.iterations):
            response = await client.post(
                f"{self.base_url}/prompts/",
                json={
                    "name": f"hard-delete-prompt-{i}-{time.time_ns()}",
                    "content": "To be hard deleted {{ arg }}",
                    "arguments": [{"name": "arg"}],
                },
            )
            if response.status_code < 400:
                delete_ids.append(response.json()["id"])

        if not delete_ids:
            return self._empty_result("Hard Delete Prompt", concurrency)

        counter = count(0)

        def make_request() -> tuple[str, str, dict[str, Any] | None, dict[str, Any] | None]:
            n = next(counter)
            prompt_id = delete_ids[n % len(delete_ids)]
            return ("DELETE", f"/prompts/{prompt_id}", None, {"permanent": "true"})

        return await self._run_concurrent(
            client, "Hard Delete Prompt", concurrency, make_request,
        )

    # -------------------------------------------------------------------------
    # Helpers
    # -------------------------------------------------------------------------

    def _empty_result(self, operation: str, concurrency: int) -> BenchmarkResult:
        """Return an empty result for when setup fails."""
        return BenchmarkResult(
            operation=operation,
            concurrency=concurrency,
            total_requests=0,
            successful=0,
            failed=0,
            min_ms=0,
            p50_ms=0,
            p95_ms=0,
            p99_ms=0,
            max_ms=0,
            mean_ms=0,
            stddev_ms=0,
            throughput_rps=0,
            error_rate_pct=100,
        )

    async def run_all_benchmarks(  # noqa: PLR0915
        self, concurrency_levels: list[int],
    ) -> list[BenchmarkResult]:
        """Run all benchmarks at specified concurrency levels."""
        results: list[BenchmarkResult] = []

        async with httpx.AsyncClient(timeout=30.0) as client:
            # Verify API is reachable
            try:
                response = await client.get(f"{self.base_url}/health")
                if response.status_code != 200:
                    print(f"Warning: Health check returned {response.status_code}")
            except Exception as e:
                print(f"Error: Cannot reach API at {self.base_url}: {e}")
                print("Make sure the API server is running: make run")
                return results

            # Verify dev mode is enabled (no auth required)
            try:
                response = await client.get(
                    f"{self.base_url}/notes/",
                    params={"limit": 1},
                )
                if response.status_code == 401:
                    print("Error: Authentication required.")
                    print("Start the server with dev mode: VITE_DEV_MODE=true make run")
                    return results
            except Exception as e:
                print(f"Error: API check failed: {e}")
                return results

            # Clean up any leftover items from previous runs
            await self._cleanup_leftover_benchmark_items(client)

            # Warmup phase - use max concurrency to fully warm connection pool
            await self.warmup(client, max_concurrency=max(concurrency_levels))

            try:
                for concurrency in concurrency_levels:
                    print(f"\n--- Concurrency: {concurrency} ---")

                    # Note operations
                    print("  Create Notes...", end=" ", flush=True)
                    result = await self.benchmark_create_notes(client, concurrency)
                    results.append(result)
                    print(f"P95: {result.p95_ms}ms, {result.throughput_rps} req/s")

                    print("  Update Notes...", end=" ", flush=True)
                    result = await self.benchmark_update_notes(client, concurrency)
                    results.append(result)
                    print(f"P95: {result.p95_ms}ms, {result.throughput_rps} req/s")

                    print("  Read Notes...", end=" ", flush=True)
                    result = await self.benchmark_read_notes(client, concurrency)
                    results.append(result)
                    print(f"P95: {result.p95_ms}ms, {result.throughput_rps} req/s")

                    print("  List Notes...", end=" ", flush=True)
                    result = await self.benchmark_list_notes(client, concurrency)
                    results.append(result)
                    print(f"P95: {result.p95_ms}ms, {result.throughput_rps} req/s")

                    print("  Search Notes...", end=" ", flush=True)
                    result = await self.benchmark_search_notes(client, concurrency)
                    results.append(result)
                    print(f"P95: {result.p95_ms}ms, {result.throughput_rps} req/s")

                    print("  Soft Delete Notes...", end=" ", flush=True)
                    result = await self.benchmark_soft_delete_notes(client, concurrency)
                    results.append(result)
                    print(f"P95: {result.p95_ms}ms, {result.throughput_rps} req/s")

                    print("  Hard Delete Notes...", end=" ", flush=True)
                    result = await self.benchmark_hard_delete_notes(client, concurrency)
                    results.append(result)
                    print(f"P95: {result.p95_ms}ms, {result.throughput_rps} req/s")

                    # Bookmark operations
                    print("  Create Bookmarks...", end=" ", flush=True)
                    result = await self.benchmark_create_bookmarks(client, concurrency)
                    results.append(result)
                    print(f"P95: {result.p95_ms}ms, {result.throughput_rps} req/s")

                    print("  Update Bookmarks...", end=" ", flush=True)
                    result = await self.benchmark_update_bookmarks(client, concurrency)
                    results.append(result)
                    print(f"P95: {result.p95_ms}ms, {result.throughput_rps} req/s")

                    print("  Read Bookmarks...", end=" ", flush=True)
                    result = await self.benchmark_read_bookmarks(client, concurrency)
                    results.append(result)
                    print(f"P95: {result.p95_ms}ms, {result.throughput_rps} req/s")

                    print("  List Bookmarks...", end=" ", flush=True)
                    result = await self.benchmark_list_bookmarks(client, concurrency)
                    results.append(result)
                    print(f"P95: {result.p95_ms}ms, {result.throughput_rps} req/s")

                    print("  Search Bookmarks...", end=" ", flush=True)
                    result = await self.benchmark_search_bookmarks(client, concurrency)
                    results.append(result)
                    print(f"P95: {result.p95_ms}ms, {result.throughput_rps} req/s")

                    print("  Soft Delete Bookmarks...", end=" ", flush=True)
                    result = await self.benchmark_soft_delete_bookmarks(client, concurrency)
                    results.append(result)
                    print(f"P95: {result.p95_ms}ms, {result.throughput_rps} req/s")

                    print("  Hard Delete Bookmarks...", end=" ", flush=True)
                    result = await self.benchmark_hard_delete_bookmarks(client, concurrency)
                    results.append(result)
                    print(f"P95: {result.p95_ms}ms, {result.throughput_rps} req/s")

                    # Prompt operations
                    print("  Create Prompts...", end=" ", flush=True)
                    result = await self.benchmark_create_prompts(client, concurrency)
                    results.append(result)
                    print(f"P95: {result.p95_ms}ms, {result.throughput_rps} req/s")

                    print("  Update Prompts...", end=" ", flush=True)
                    result = await self.benchmark_update_prompts(client, concurrency)
                    results.append(result)
                    print(f"P95: {result.p95_ms}ms, {result.throughput_rps} req/s")

                    print("  Read Prompts...", end=" ", flush=True)
                    result = await self.benchmark_read_prompts(client, concurrency)
                    results.append(result)
                    print(f"P95: {result.p95_ms}ms, {result.throughput_rps} req/s")

                    print("  List Prompts...", end=" ", flush=True)
                    result = await self.benchmark_list_prompts(client, concurrency)
                    results.append(result)
                    print(f"P95: {result.p95_ms}ms, {result.throughput_rps} req/s")

                    print("  Search Prompts...", end=" ", flush=True)
                    result = await self.benchmark_search_prompts(client, concurrency)
                    results.append(result)
                    print(f"P95: {result.p95_ms}ms, {result.throughput_rps} req/s")

                    print("  Soft Delete Prompts...", end=" ", flush=True)
                    result = await self.benchmark_soft_delete_prompts(client, concurrency)
                    results.append(result)
                    print(f"P95: {result.p95_ms}ms, {result.throughput_rps} req/s")

                    print("  Hard Delete Prompts...", end=" ", flush=True)
                    result = await self.benchmark_hard_delete_prompts(client, concurrency)
                    results.append(result)
                    print(f"P95: {result.p95_ms}ms, {result.throughput_rps} req/s")

                    # Cleanup after each concurrency level
                    print("  Cleaning up...", end=" ", flush=True)
                    await self._cleanup_notes(client)
                    await self._cleanup_bookmarks(client)
                    await self._cleanup_prompts(client)
                    print("done")
            finally:
                # Ensure cleanup runs even if benchmarks fail
                print("\nFinal cleanup...", end=" ", flush=True)
                await self._cleanup_notes(client)
                await self._cleanup_bookmarks(client)
                await self._cleanup_prompts(client)
                print("done")

        return results


def generate_markdown_report(  # noqa: PLR0915
    results: list[BenchmarkResult],
    base_url: str,
    iterations: int,
    content_size_kb: int,
) -> str:
    """Generate a markdown report from benchmark results."""
    lines: list[str] = []

    lines.append("# API Performance Benchmark Results")
    lines.append("")
    lines.append(f"**Generated:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    lines.append(f"**API URL:** {base_url}")
    lines.append("**Auth Mode:** Dev Mode (no auth)")
    lines.append(f"**Iterations per test:** {iterations}")
    lines.append(f"**Content size:** {content_size_kb}KB")
    lines.append("")

    # Group by operation
    operations = sorted({r.operation for r in results})

    lines.append("## Summary by Operation")
    lines.append("")
    header = "| Operation | Conc | Min | P50 | P95 | P99 | Max | Mean±Std | RPS | Err |"
    lines.append(header)
    lines.append("|-----------|------|-----|-----|-----|-----|-----|----------|-----|-----|")

    for op in operations:
        op_results = [r for r in results if r.operation == op]
        for r in sorted(op_results, key=lambda x: x.concurrency):
            err = f"{r.error_rate_pct}%" if r.error_rate_pct > 0 else "0%"
            mean_std = f"{r.mean_ms}±{r.stddev_ms}"
            rps = r.throughput_rps
            lines.append(
                f"| {r.operation} | {r.concurrency} | {r.min_ms} | {r.p50_ms} | "
                f"{r.p95_ms} | {r.p99_ms} | {r.max_ms} | {mean_std} | {rps} | {err} |",
            )

    lines.append("")

    # Highlight slow operations
    slow_results = [r for r in results if r.p95_ms > 100]
    if slow_results:
        lines.append("## ⚠️ Slow Operations (P95 > 100ms)")
        lines.append("")
        lines.append("| Operation | Concurrency | P50 (ms) | P95 (ms) | Notes |")
        lines.append("|-----------|-------------|----------|----------|-------|")
        for r in sorted(slow_results, key=lambda x: -x.p95_ms):
            severity = "🔴 Very slow" if r.p95_ms > 500 else "🟠 Slow"
            lines.append(
                f"| {r.operation} | {r.concurrency} | {r.p50_ms} | {r.p95_ms} | {severity} |",
            )
        lines.append("")

    # Highlight errors
    error_results = [r for r in results if r.error_rate_pct > 0]
    if error_results:
        lines.append("## ⚠️ Operations with Errors")
        lines.append("")
        lines.append("| Operation | Concurrency | Error Rate | Failed/Total |")
        lines.append("|-----------|-------------|------------|--------------|")
        for r in sorted(error_results, key=lambda x: -x.error_rate_pct):
            failed_total = f"{r.failed}/{r.total_requests}"
            lines.append(
                f"| {r.operation} | {r.concurrency} | {r.error_rate_pct}% | {failed_total} |",
            )
        lines.append("")

    # Scaling analysis
    lines.append("## Scaling Analysis")
    lines.append("")
    lines.append("How latency changes as concurrency increases:")
    lines.append("")

    for op in operations:
        op_results = sorted(
            [r for r in results if r.operation == op], key=lambda x: x.concurrency,
        )
        if len(op_results) >= 2:
            first = op_results[0]
            last = op_results[-1]
            if first.p95_ms > 0:
                increase = round((last.p95_ms / first.p95_ms), 1)
                lines.append(
                    f"- **{op}:** P95 increases {increase}x from "
                    f"{first.concurrency} to {last.concurrency} concurrency",
                )

    lines.append("")

    return "\n".join(lines)


def main() -> None:
    """Run the benchmark suite and generate a performance report."""
    parser = argparse.ArgumentParser(description="Benchmark API performance under load")
    parser.add_argument("--base-url", default="http://localhost:8000", help="API base URL")
    parser.add_argument(
        "--concurrency", default="10,50,100", help="Comma-separated concurrency levels",
    )
    parser.add_argument("--iterations", type=int, default=100, help="Requests per test")
    parser.add_argument(
        "--content-size", type=int, default=50,
        help="Content size in KB for create/update payloads (default: 50)",
    )
    args = parser.parse_args()

    concurrency_levels = [int(x) for x in args.concurrency.split(",")]

    print("=" * 60)
    print("API PERFORMANCE BENCHMARK")
    print("=" * 60)
    print(f"Base URL: {args.base_url}")
    print("Auth Mode: Dev Mode (no auth)")
    print(f"Concurrency levels: {concurrency_levels}")
    print(f"Iterations per test: {args.iterations}")
    print(f"Content size: {args.content_size}KB")

    benchmark = ApiBenchmark(args.base_url, args.iterations, args.content_size)
    results = asyncio.run(benchmark.run_all_benchmarks(concurrency_levels))

    if not results:
        print("\nNo results collected. Check that the API is running.")
        return

    # Generate report
    report = generate_markdown_report(
        results, args.base_url, args.iterations, args.content_size,
    )

    # Write to file
    output_dir = Path(__file__).parent / "results"
    output_dir.mkdir(exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_file = output_dir / f"benchmark_api_{args.content_size}kb_{timestamp}.md"
    output_file.write_text(report)

    print("\n" + "=" * 60)
    print(f"Report saved to: {output_file}")
    print("=" * 60)
    print("\n" + report)


if __name__ == "__main__":
    main()
