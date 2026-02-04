#!/usr/bin/env python3
"""Generate HTML profile reports for API endpoints.

Usage:
    uv run python performance/profiling/profile.py
    uv run python performance/profiling/profile.py --content-size 50
    uv run python performance/profiling/profile.py --entity notes
    uv run python performance/profiling/profile.py --entity prompts --content-size 50
"""

import argparse
import asyncio
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

from pyinstrument import Profiler
from httpx import ASGITransport, AsyncClient

PROFILE_DIR = Path(__file__).parent / "results"


async def profile_and_save(
    client: AsyncClient,
    method: str,
    url: str,
    json: dict | None = None,
    params: dict | None = None,
    name: str = "",
    content_size_kb: int = 1,
) -> dict | None:
    """Profile an endpoint and save HTML report. Returns response JSON if successful."""
    profiler = Profiler(async_mode="enabled")

    profiler.start()
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
    profiler.stop()

    # Generate filename with content size
    safe_name = name.replace(" ", "_").replace("/", "_").lower()
    filename = f"{safe_name}_{content_size_kb}kb.html"
    filepath = PROFILE_DIR / filename

    # Save HTML report
    with open(filepath, "w") as f:
        f.write(profiler.output_html())

    duration = profiler.last_session.duration * 1000
    status = "✓" if response.status_code < 400 else "✗"
    print(f"  {status} {name}: {duration:.1f}ms -> {filename}")

    if response.status_code < 400:
        try:
            return response.json()
        except Exception:
            return None
    return None


async def profile_notes(
    client: AsyncClient,
    content_size_kb: int,
    created_ids: list[str],
) -> None:
    """Profile all note operations."""
    content = "x" * (content_size_kb * 1024)

    print("\n--- Notes ---")

    # Create
    result = await profile_and_save(
        client, "POST", "/notes/",
        json={"title": "Profile Test Note", "content": f"Profile content\n\n{content}"},
        name="create_note",
        content_size_kb=content_size_kb,
    )
    note_id = result["id"] if result else None
    if note_id:
        created_ids.append(("note", note_id))

    # List
    await profile_and_save(
        client, "GET", "/notes/",
        name="list_notes",
        content_size_kb=content_size_kb,
    )

    # Search
    await profile_and_save(
        client, "GET", "/notes/",
        params={"query": "profile"},
        name="search_notes",
        content_size_kb=content_size_kb,
    )

    if note_id:
        # Read
        await profile_and_save(
            client, "GET", f"/notes/{note_id}",
            name="read_note",
            content_size_kb=content_size_kb,
        )

        # Update
        await profile_and_save(
            client, "PATCH", f"/notes/{note_id}",
            json={"content": f"Updated content\n\n{content}"},
            name="update_note",
            content_size_kb=content_size_kb,
        )

        # Soft delete
        await profile_and_save(
            client, "DELETE", f"/notes/{note_id}",
            params={"permanent": "false"},
            name="soft_delete_note",
            content_size_kb=content_size_kb,
        )

        # Hard delete
        await profile_and_save(
            client, "DELETE", f"/notes/{note_id}",
            params={"permanent": "true"},
            name="hard_delete_note",
            content_size_kb=content_size_kb,
        )
        # Remove from cleanup list since we already deleted it
        created_ids.remove(("note", note_id))


async def profile_bookmarks(
    client: AsyncClient,
    content_size_kb: int,
    created_ids: list[str],
) -> None:
    """Profile all bookmark operations."""
    content = "x" * (content_size_kb * 1024)
    unique_url = f"https://example-profile-{time.time_ns()}.com/page"

    print("\n--- Bookmarks ---")

    # Create
    result = await profile_and_save(
        client, "POST", "/bookmarks/",
        json={
            "url": unique_url,
            "title": "Profile Test Bookmark",
            "description": "Profile description",
            "content": content,
        },
        name="create_bookmark",
        content_size_kb=content_size_kb,
    )
    bookmark_id = result["id"] if result else None
    if bookmark_id:
        created_ids.append(("bookmark", bookmark_id))

    # List
    await profile_and_save(
        client, "GET", "/bookmarks/",
        name="list_bookmarks",
        content_size_kb=content_size_kb,
    )

    # Search
    await profile_and_save(
        client, "GET", "/bookmarks/",
        params={"query": "profile"},
        name="search_bookmarks",
        content_size_kb=content_size_kb,
    )

    if bookmark_id:
        # Read
        await profile_and_save(
            client, "GET", f"/bookmarks/{bookmark_id}",
            name="read_bookmark",
            content_size_kb=content_size_kb,
        )

        # Update
        await profile_and_save(
            client, "PATCH", f"/bookmarks/{bookmark_id}",
            json={"content": f"Updated content\n\n{content}"},
            name="update_bookmark",
            content_size_kb=content_size_kb,
        )

        # Soft delete
        await profile_and_save(
            client, "DELETE", f"/bookmarks/{bookmark_id}",
            params={"permanent": "false"},
            name="soft_delete_bookmark",
            content_size_kb=content_size_kb,
        )

        # Hard delete
        await profile_and_save(
            client, "DELETE", f"/bookmarks/{bookmark_id}",
            params={"permanent": "true"},
            name="hard_delete_bookmark",
            content_size_kb=content_size_kb,
        )
        created_ids.remove(("bookmark", bookmark_id))


async def profile_prompts(
    client: AsyncClient,
    content_size_kb: int,
    created_ids: list[str],
) -> None:
    """Profile all prompt operations."""
    content = "x" * (content_size_kb * 1024)
    unique_name = f"profile-prompt-{time.time_ns()}"

    print("\n--- Prompts ---")

    # Create
    result = await profile_and_save(
        client, "POST", "/prompts/",
        json={
            "name": unique_name,
            "content": f"Summarize {{{{ topic }}}} in {{{{ style }}}} format.\n\n{content}",
            "arguments": [
                {"name": "topic", "description": "The topic"},
                {"name": "style", "description": "The style"},
            ],
        },
        name="create_prompt",
        content_size_kb=content_size_kb,
    )
    prompt_id = result["id"] if result else None
    if prompt_id:
        created_ids.append(("prompt", prompt_id))

    # List
    await profile_and_save(
        client, "GET", "/prompts/",
        name="list_prompts",
        content_size_kb=content_size_kb,
    )

    # Search
    await profile_and_save(
        client, "GET", "/prompts/",
        params={"query": "profile"},
        name="search_prompts",
        content_size_kb=content_size_kb,
    )

    if prompt_id:
        # Read
        await profile_and_save(
            client, "GET", f"/prompts/{prompt_id}",
            name="read_prompt",
            content_size_kb=content_size_kb,
        )

        # Update
        await profile_and_save(
            client, "PATCH", f"/prompts/{prompt_id}",
            json={"content": f"Updated {{{{ topic }}}} in {{{{ style }}}} format.\n\n{content}"},
            name="update_prompt",
            content_size_kb=content_size_kb,
        )

        # Soft delete
        await profile_and_save(
            client, "DELETE", f"/prompts/{prompt_id}",
            params={"permanent": "false"},
            name="soft_delete_prompt",
            content_size_kb=content_size_kb,
        )

        # Hard delete
        await profile_and_save(
            client, "DELETE", f"/prompts/{prompt_id}",
            params={"permanent": "true"},
            name="hard_delete_prompt",
            content_size_kb=content_size_kb,
        )
        created_ids.remove(("prompt", prompt_id))


async def cleanup(client: AsyncClient, created_ids: list[tuple[str, str]]) -> None:
    """Clean up any created items."""
    if not created_ids:
        return

    print(f"\nCleaning up {len(created_ids)} leftover items...")
    for entity_type, entity_id in created_ids:
        try:
            if entity_type == "note":
                await client.delete(f"/notes/{entity_id}", params={"permanent": "true"})
            elif entity_type == "bookmark":
                await client.delete(f"/bookmarks/{entity_id}", params={"permanent": "true"})
            elif entity_type == "prompt":
                await client.delete(f"/prompts/{entity_id}", params={"permanent": "true"})
        except Exception:
            pass  # Best effort cleanup


async def main(content_size_kb: int, entity: str | None) -> None:
    """Generate profile reports for key endpoints."""
    from api.main import app

    PROFILE_DIR.mkdir(parents=True, exist_ok=True)

    print("=" * 60)
    print("PROFILING API ENDPOINTS")
    print("=" * 60)
    print(f"Content size: {content_size_kb}KB")
    print(f"Entity filter: {entity or 'all'}")
    print(f"Output directory: {PROFILE_DIR}")

    created_ids: list[tuple[str, str]] = []

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        try:
            # Warmup: initialize ORM models for all entity types
            # Without this, the first profiled operation includes ORM initialization
            # overhead (~20-30ms) that skews results
            print("\nWarming up ORM models...", end=" ", flush=True)
            await client.get("/health")
            for endpoint in ["/notes/", "/bookmarks/", "/prompts/"]:
                await client.get(endpoint, params={"limit": 1})
            print("done")

            # Profile each entity type
            if entity is None or entity == "notes":
                await profile_notes(client, content_size_kb, created_ids)

            if entity is None or entity == "bookmarks":
                await profile_bookmarks(client, content_size_kb, created_ids)

            if entity is None or entity == "prompts":
                await profile_prompts(client, content_size_kb, created_ids)

        finally:
            await cleanup(client, created_ids)

    print("\n" + "=" * 60)
    print(f"Results saved to: {PROFILE_DIR}")
    print(f"Open in browser: file://{PROFILE_DIR}")
    print("=" * 60)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Profile API endpoints")
    parser.add_argument(
        "--content-size", type=int, default=1,
        help="Content size in KB (default: 1)",
    )
    parser.add_argument(
        "--entity", choices=["notes", "bookmarks", "prompts"],
        help="Profile only this entity type (default: all)",
    )
    args = parser.parse_args()

    asyncio.run(main(args.content_size, args.entity))
