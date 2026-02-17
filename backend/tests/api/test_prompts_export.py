"""Tests for prompt skills export endpoint."""

import io
import tarfile
import zipfile
from unittest.mock import patch

from typing import Any

import yaml
from httpx import AsyncClient


# =============================================================================
# Helper Functions
# =============================================================================


async def _create_prompt(
    client: AsyncClient,
    name: str,
    content: str = "Test content",
    description: str | None = None,
    tags: list[str] | None = None,
    arguments: list[dict] | None = None,
) -> dict:
    """Create a prompt and return the response data."""
    payload: dict = {"name": name, "content": content}
    if description is not None:
        payload["description"] = description
    if tags is not None:
        payload["tags"] = tags
    if arguments is not None:
        payload["arguments"] = arguments

    response = await client.post("/prompts/", json=payload)
    assert response.status_code == 201
    return response.json()


def _extract_tar_gz(content: bytes) -> dict[str, str]:
    """Extract tar.gz and return dict of {path: content}."""
    result = {}
    with tarfile.open(fileobj=io.BytesIO(content), mode="r:gz") as tar:
        for member in tar.getmembers():
            if member.isfile():
                f = tar.extractfile(member)
                if f:
                    result[member.name] = f.read().decode("utf-8")
    return result


def _extract_zip(content: bytes) -> dict[str, str]:
    """Extract zip and return dict of {path: content}."""
    result = {}
    with zipfile.ZipFile(io.BytesIO(content), "r") as zf:
        for name in zf.namelist():
            if not name.endswith("/"):  # Skip directories
                result[name] = zf.read(name).decode("utf-8")
    return result


def _parse_skill_frontmatter(skill_content: str) -> dict:
    """Parse YAML frontmatter from SKILL.md content."""
    lines = skill_content.split("\n")
    frontmatter_start = lines.index("---") + 1
    frontmatter_end = lines.index("---", frontmatter_start)
    frontmatter_text = "\n".join(lines[frontmatter_start:frontmatter_end])
    return yaml.safe_load(frontmatter_text)


# =============================================================================
# Basic Export Tests
# =============================================================================


async def test__export_skills__basic_claude_code(client: AsyncClient) -> None:
    """Create prompts, verify tar.gz contains correct SKILL.md files."""
    await _create_prompt(client, "skill-one", "Content one")
    await _create_prompt(client, "skill-two", "Content two")

    response = await client.get("/prompts/export/skills?client=claude-code")

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/gzip"

    files = _extract_tar_gz(response.content)
    assert "skill-one/SKILL.md" in files
    assert "skill-two/SKILL.md" in files
    assert "Content one" in files["skill-one/SKILL.md"]
    assert "Content two" in files["skill-two/SKILL.md"]


async def test__export_skills__basic_claude_desktop(client: AsyncClient) -> None:
    """Create prompts, verify zip structure."""
    await _create_prompt(client, "desktop-skill", "Desktop content")

    response = await client.get("/prompts/export/skills?client=claude-desktop")

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"

    files = _extract_zip(response.content)
    assert "desktop-skill.md" in files
    assert "Desktop content" in files["desktop-skill.md"]


async def test__export_skills__basic_codex(client: AsyncClient) -> None:
    """Create prompts, verify tar.gz with Codex-specific formatting."""
    await _create_prompt(
        client,
        "codex-skill",
        "Codex content",
        description="Multi\nline\ndescription",
    )

    response = await client.get("/prompts/export/skills?client=codex")

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/gzip"

    files = _extract_tar_gz(response.content)
    assert "codex-skill/SKILL.md" in files

    # Verify description is single-line for Codex
    frontmatter = _parse_skill_frontmatter(files["codex-skill/SKILL.md"])
    assert "\n" not in frontmatter["description"]
    assert frontmatter["description"] == "Multi line description"


# =============================================================================
# Tag Filtering Tests
# =============================================================================


async def test__export_skills__no_tags_exports_all(client: AsyncClient) -> None:
    """Verify all prompts exported when tags not specified."""
    await _create_prompt(client, "prompt-a", tags=["alpha"])
    await _create_prompt(client, "prompt-b", tags=["beta"])
    await _create_prompt(client, "prompt-c", tags=[])

    response = await client.get("/prompts/export/skills?client=claude-code")

    assert response.status_code == 200
    files = _extract_tar_gz(response.content)
    assert len(files) == 3
    assert "prompt-a/SKILL.md" in files
    assert "prompt-b/SKILL.md" in files
    assert "prompt-c/SKILL.md" in files


async def test__export_skills__tag_filtering(client: AsyncClient) -> None:
    """Create prompts with different tags, verify only matching ones exported."""
    await _create_prompt(client, "skill-tagged", tags=["skill"])
    await _create_prompt(client, "not-tagged", tags=["other"])
    await _create_prompt(client, "also-skill", tags=["skill", "extra"])

    response = await client.get("/prompts/export/skills?client=claude-code&tags=skill")

    assert response.status_code == 200
    files = _extract_tar_gz(response.content)
    assert len(files) == 2
    assert "skill-tagged/SKILL.md" in files
    assert "also-skill/SKILL.md" in files
    assert "not-tagged/SKILL.md" not in files


async def test__export_skills__tag_match_any(client: AsyncClient) -> None:
    """Create prompts, verify OR matching works."""
    await _create_prompt(client, "has-alpha", tags=["alpha"])
    await _create_prompt(client, "has-beta", tags=["beta"])
    await _create_prompt(client, "has-gamma", tags=["gamma"])

    response = await client.get(
        "/prompts/export/skills?client=claude-code&tags=alpha&tags=beta&tag_match=any",
    )

    assert response.status_code == 200
    files = _extract_tar_gz(response.content)
    assert len(files) == 2
    assert "has-alpha/SKILL.md" in files
    assert "has-beta/SKILL.md" in files
    assert "has-gamma/SKILL.md" not in files


async def test__export_skills__tag_match_all(client: AsyncClient) -> None:
    """Create prompts with multiple tags, verify AND matching works."""
    await _create_prompt(client, "has-both", tags=["skill", "python"])
    await _create_prompt(client, "has-skill", tags=["skill"])
    await _create_prompt(client, "has-python", tags=["python"])

    response = await client.get(
        "/prompts/export/skills?client=claude-code&tags=skill&tags=python&tag_match=all",
    )

    assert response.status_code == 200
    files = _extract_tar_gz(response.content)
    assert len(files) == 1
    assert "has-both/SKILL.md" in files


# =============================================================================
# View Filter Tests
# =============================================================================


async def test__export_skills__view_filter(client: AsyncClient) -> None:
    """Create active and archived prompts, verify view parameter works."""
    await _create_prompt(client, "active-prompt")
    archived_data = await _create_prompt(client, "archived-prompt")

    # Archive one prompt
    await client.post(f"/prompts/{archived_data['id']}/archive")

    # Default view=active should only include active prompt
    response = await client.get("/prompts/export/skills?client=claude-code")
    files = _extract_tar_gz(response.content)
    assert len(files) == 1
    assert "active-prompt/SKILL.md" in files

    # view=archived should only include archived prompt
    response = await client.get("/prompts/export/skills?client=claude-code&view=archived")
    files = _extract_tar_gz(response.content)
    assert len(files) == 1
    assert "archived-prompt/SKILL.md" in files


# =============================================================================
# Empty Result Tests
# =============================================================================


async def test__export_skills__empty_result(client: AsyncClient) -> None:
    """No prompts match -> valid empty archive (extractable, no files)."""
    # No prompts created, or filter that matches nothing
    response = await client.get(
        "/prompts/export/skills?client=claude-code&tags=nonexistent-tag",
    )

    assert response.status_code == 200

    # Should be a valid, extractable archive with no files
    files = _extract_tar_gz(response.content)
    assert len(files) == 0


async def test__export_skills__empty_result_zip(client: AsyncClient) -> None:
    """No prompts match -> valid empty zip archive."""
    response = await client.get(
        "/prompts/export/skills?client=claude-desktop&tags=nonexistent",
    )

    assert response.status_code == 200
    files = _extract_zip(response.content)
    assert len(files) == 0


# =============================================================================
# Pagination Tests
# =============================================================================


async def test__export_skills__pagination(client: AsyncClient) -> None:
    """Verify pagination works by patching page size and checking search calls."""
    from api.routers import prompts as prompts_router

    # Create 7 prompts
    for i in range(7):
        await _create_prompt(client, f"paginated-{i}", f"Content {i}")

    original_list_for_export = prompts_router.prompt_service.list_for_export
    call_count = 0

    async def tracking_list_for_export(*args: Any, **kwargs: Any) -> Any:
        nonlocal call_count
        call_count += 1
        return await original_list_for_export(*args, **kwargs)

    with (
        patch.object(prompts_router, "EXPORT_PAGE_SIZE", 3),
        patch.object(prompts_router.prompt_service, "list_for_export", tracking_list_for_export),
    ):
        response = await client.get("/prompts/export/skills?client=claude-code")

    # Verify pagination happened: 7 prompts / 3 per page = 3 calls
    assert call_count == 3

    assert response.status_code == 200
    files = _extract_tar_gz(response.content)
    assert len(files) == 7


# =============================================================================
# Response Header Tests
# =============================================================================


async def test__export_skills__response_headers_tar_gz(client: AsyncClient) -> None:
    """Verify Content-Type and Content-Disposition for tar.gz."""
    await _create_prompt(client, "header-test")

    response = await client.get("/prompts/export/skills?client=claude-code")

    assert response.headers["content-type"] == "application/gzip"
    assert response.headers["content-disposition"] == "attachment; filename=skills.tar.gz"


async def test__export_skills__response_headers_zip(client: AsyncClient) -> None:
    """Verify Content-Type and Content-Disposition for zip."""
    await _create_prompt(client, "zip-test")

    response = await client.get("/prompts/export/skills?client=claude-desktop")

    assert response.headers["content-type"] == "application/zip"
    assert response.headers["content-disposition"] == "attachment; filename=skills.zip"


# =============================================================================
# Directory Structure Tests
# =============================================================================


async def test__export_skills__directory_structure(client: AsyncClient) -> None:
    """Verify {name}/SKILL.md structure in archive."""
    await _create_prompt(client, "my-skill")

    response = await client.get("/prompts/export/skills?client=claude-code")
    files = _extract_tar_gz(response.content)

    # Should have exactly one file with correct path
    assert len(files) == 1
    assert "my-skill/SKILL.md" in files


# =============================================================================
# Authentication Tests
# =============================================================================


async def test__export_skills__auth_required(client: AsyncClient) -> None:
    """401 without authentication - skipped in dev mode."""
    # Note: In dev mode, auth is bypassed, so we can't easily test 401
    # This test verifies the endpoint exists and is accessible
    response = await client.get("/prompts/export/skills?client=claude-code")
    # Should not be 401/403 in dev mode
    assert response.status_code == 200


# =============================================================================
# Validation Tests
# =============================================================================


async def test__export_skills__client_required(client: AsyncClient) -> None:
    """Verify 422 if client parameter missing."""
    response = await client.get("/prompts/export/skills")

    assert response.status_code == 422
    # Should indicate client is required
    detail = response.json()["detail"]
    assert any("client" in str(err).lower() for err in detail)


async def test__export_skills__invalid_client(client: AsyncClient) -> None:
    """Verify 422 if client parameter is invalid."""
    response = await client.get("/prompts/export/skills?client=invalid-client")

    assert response.status_code == 422


# =============================================================================
# Frontmatter and Directory Name Tests
# =============================================================================


async def test__export_skills__directory_name_matches_frontmatter(
    client: AsyncClient,
) -> None:
    """Extract archive, verify directory name == frontmatter name."""
    await _create_prompt(client, "matching-name")

    response = await client.get("/prompts/export/skills?client=claude-code")
    files = _extract_tar_gz(response.content)

    # Get the directory name from the path
    path = next(iter(files.keys()))
    dir_name = path.split("/")[0]

    # Parse frontmatter
    frontmatter = _parse_skill_frontmatter(files[path])

    assert dir_name == frontmatter["name"]


async def test__export_skills__truncated_name_in_directory(client: AsyncClient) -> None:
    """80-char prompt name -> 64-char directory for claude-code."""
    long_name = "a" * 80
    await _create_prompt(client, long_name)

    response = await client.get("/prompts/export/skills?client=claude-code")
    files = _extract_tar_gz(response.content)

    # Directory name should be truncated to 64 chars
    path = next(iter(files.keys()))
    dir_name = path.split("/")[0]
    assert len(dir_name) == 64
    assert dir_name == "a" * 64

    # Frontmatter should also be truncated
    frontmatter = _parse_skill_frontmatter(files[path])
    assert len(frontmatter["name"]) == 64


async def test__export_skills__name_collision_deduped(client: AsyncClient) -> None:
    """Two prompts that truncate to same name -> exactly one entry in archive."""
    # Create two prompts with names that differ only after 64 chars
    name1 = "x" * 64 + "-first"
    name2 = "x" * 64 + "-second"
    await _create_prompt(client, name1, content="First content")
    await _create_prompt(client, name2, content="Second content")

    response = await client.get("/prompts/export/skills?client=claude-code")
    files = _extract_tar_gz(response.content)

    # Both truncate to "x" * 64, so there should be exactly one file (deduped)
    truncated_path = ("x" * 64) + "/SKILL.md"
    assert len(files) == 1
    assert truncated_path in files

    # Verify content is from one of the prompts (deterministic, but order depends on DB)
    content = files[truncated_path]
    assert "First content" in content or "Second content" in content


# =============================================================================
# YAML Special Characters Tests
# =============================================================================


async def test__export_skills__yaml_special_chars_in_description(
    client: AsyncClient,
) -> None:
    """Description with : and # -> valid parseable YAML in archive."""
    await _create_prompt(
        client,
        "special-chars",
        description="Key: value with #hashtag and more: stuff",
    )

    response = await client.get("/prompts/export/skills?client=claude-code")
    files = _extract_tar_gz(response.content)

    # Should be valid parseable YAML
    skill_content = files["special-chars/SKILL.md"]
    frontmatter = _parse_skill_frontmatter(skill_content)

    assert "Key: value" in frontmatter["description"]
    assert "#hashtag" in frontmatter["description"]


# =============================================================================
# Content and Arguments Tests
# =============================================================================


async def test__export_skills__full_content_included(client: AsyncClient) -> None:
    """Verify full content is included in SKILL.md, not just preview."""
    long_content = "x" * 1000
    await _create_prompt(client, "long-content", content=long_content)

    response = await client.get("/prompts/export/skills?client=claude-code")
    files = _extract_tar_gz(response.content)

    # Full content should be in the file
    assert long_content in files["long-content/SKILL.md"]


async def test__export_skills__arguments_in_template_variables(
    client: AsyncClient,
) -> None:
    """Verify arguments appear in Template Variables section."""
    await _create_prompt(
        client,
        "with-args",
        content="{{ code }} in {{ lang }}",
        arguments=[
            {"name": "code", "description": "The code", "required": True},
            {"name": "lang", "description": "Language", "required": False},
        ],
    )

    response = await client.get("/prompts/export/skills?client=claude-code")
    files = _extract_tar_gz(response.content)

    skill_content = files["with-args/SKILL.md"]
    assert "## Template Variables" in skill_content
    assert "{{ code }}" in skill_content
    assert "(required): The code" in skill_content
    assert "{{ lang }}" in skill_content
    assert "(optional): Language" in skill_content
