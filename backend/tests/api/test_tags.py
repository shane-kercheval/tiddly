"""Tests for tags endpoint."""
from httpx import AsyncClient


async def test_list_tags_empty(client: AsyncClient) -> None:
    """Test listing tags when no bookmarks exist."""
    response = await client.get("/tags/")
    assert response.status_code == 200

    data = response.json()
    assert "tags" in data
    assert data["tags"] == []


async def test_list_tags_single_bookmark(client: AsyncClient) -> None:
    """Test listing tags from a single bookmark."""
    await client.post(
        "/bookmarks/",
        json={"url": "https://example.com", "title": "Test", "tags": ["python", "web"]},
    )

    response = await client.get("/tags/")
    assert response.status_code == 200

    data = response.json()
    assert len(data["tags"]) == 2
    # Tags should have name and count
    tag_names = {tag["name"] for tag in data["tags"]}
    assert tag_names == {"python", "web"}
    # Each tag has count of 1
    for tag in data["tags"]:
        assert tag["content_count"] == 1


async def test_list_tags_multiple_bookmarks(client: AsyncClient) -> None:
    """Test listing tags aggregated across multiple bookmarks."""
    await client.post(
        "/bookmarks/",
        json={"url": "https://example1.com", "tags": ["python", "web"]},
    )
    await client.post(
        "/bookmarks/",
        json={"url": "https://example2.com", "tags": ["python", "api"]},
    )
    await client.post(
        "/bookmarks/",
        json={"url": "https://example3.com", "tags": ["python"]},
    )

    response = await client.get("/tags/")
    assert response.status_code == 200

    data = response.json()
    tag_counts = {tag["name"]: tag["content_count"] for tag in data["tags"]}
    assert tag_counts["python"] == 3
    assert tag_counts["web"] == 1
    assert tag_counts["api"] == 1


async def test_list_tags_sorted_by_content_count(client: AsyncClient) -> None:
    """Test that tags are sorted by content_count descending."""
    await client.post(
        "/bookmarks/",
        json={"url": "https://ex1.com", "tags": ["rare"]},
    )
    await client.post(
        "/bookmarks/",
        json={"url": "https://ex2.com", "tags": ["common", "medium"]},
    )
    await client.post(
        "/bookmarks/",
        json={"url": "https://ex3.com", "tags": ["common", "medium"]},
    )
    await client.post(
        "/bookmarks/",
        json={"url": "https://ex4.com", "tags": ["common"]},
    )

    response = await client.get("/tags/")
    assert response.status_code == 200

    data = response.json()
    tags = data["tags"]

    # Should be sorted by content_count descending (all have filter_count=0)
    assert tags[0]["name"] == "common"
    assert tags[0]["content_count"] == 3
    assert tags[1]["name"] == "medium"
    assert tags[1]["content_count"] == 2
    assert tags[2]["name"] == "rare"
    assert tags[2]["content_count"] == 1


async def test_list_tags_alphabetical_tiebreak(client: AsyncClient) -> None:
    """Test that tags with same count are sorted alphabetically."""
    await client.post(
        "/bookmarks/",
        json={"url": "https://ex1.com", "tags": ["zebra", "apple", "banana"]},
    )

    response = await client.get("/tags/")
    assert response.status_code == 200

    data = response.json()
    tags = data["tags"]

    # All have count 1, should be sorted alphabetically
    tag_names = [tag["name"] for tag in tags]
    assert tag_names == ["apple", "banana", "zebra"]


async def test_list_tags_response_format(client: AsyncClient) -> None:
    """Test that tags response has correct format with content_count and filter_count."""
    await client.post(
        "/bookmarks/",
        json={"url": "https://example.com", "tags": ["test"]},
    )

    response = await client.get("/tags/")
    assert response.status_code == 200

    data = response.json()
    assert "tags" in data
    assert isinstance(data["tags"], list)
    assert len(data["tags"]) == 1
    assert "name" in data["tags"][0]
    assert "content_count" in data["tags"][0]
    assert "filter_count" in data["tags"][0]
    assert data["tags"][0]["name"] == "test"
    assert data["tags"][0]["content_count"] == 1
    assert data["tags"][0]["filter_count"] == 0


async def test_list_tags_bookmark_without_tags(client: AsyncClient) -> None:
    """Test that bookmarks without tags don't affect tag list."""
    await client.post(
        "/bookmarks/",
        json={"url": "https://no-tags.com", "title": "No tags"},
    )
    await client.post(
        "/bookmarks/",
        json={"url": "https://with-tags.com", "tags": ["python"]},
    )

    response = await client.get("/tags/")
    assert response.status_code == 200

    data = response.json()
    assert len(data["tags"]) == 1
    assert data["tags"][0]["name"] == "python"
    assert data["tags"][0]["content_count"] == 1


async def test_list_tags_excludes_archived_and_deleted_bookmarks(client: AsyncClient) -> None:
    """Test that tags from archived and deleted bookmarks are excluded from listing."""
    # Create three bookmarks with different tags
    # Active bookmark - tags should be counted
    await client.post(
        "/bookmarks/",
        json={"url": "https://active.com", "tags": ["active-tag", "shared-tag"]},
    )

    # Bookmark to be archived - tags should NOT be counted
    archived_response = await client.post(
        "/bookmarks/",
        json={"url": "https://archived.com", "tags": ["archived-tag", "shared-tag"]},
    )
    archived_id = archived_response.json()["id"]
    await client.post(f"/bookmarks/{archived_id}/archive")

    # Bookmark to be deleted - tags should NOT be counted
    deleted_response = await client.post(
        "/bookmarks/",
        json={"url": "https://deleted.com", "tags": ["deleted-tag", "shared-tag"]},
    )
    deleted_id = deleted_response.json()["id"]
    await client.delete(f"/bookmarks/{deleted_id}")

    # Get tags - returns only tags with active content
    response = await client.get("/tags/")
    assert response.status_code == 200

    data = response.json()
    tag_counts = {tag["name"]: tag["content_count"] for tag in data["tags"]}

    # Active bookmark's tags should have count of 1
    assert "active-tag" in tag_counts
    assert tag_counts["active-tag"] == 1

    # shared-tag should only have count of 1 (from active bookmark only)
    assert "shared-tag" in tag_counts
    assert tag_counts["shared-tag"] == 1

    # Tags exclusive to archived/deleted bookmarks should NOT appear
    # (they have zero active content, so they're excluded from the API response)
    assert "archived-tag" not in tag_counts
    assert "deleted-tag" not in tag_counts


async def test_list_tags_include_inactive_shows_all_tags(client: AsyncClient) -> None:
    """Test that include_inactive=true returns tags with zero active content."""
    # Create three bookmarks with different tags
    # Active bookmark - tags should be counted
    await client.post(
        "/bookmarks/",
        json={"url": "https://active.com", "tags": ["active-tag", "shared-tag"]},
    )

    # Bookmark to be archived - tags should appear with count 0 when include_inactive=true
    archived_response = await client.post(
        "/bookmarks/",
        json={"url": "https://archived.com", "tags": ["archived-tag", "shared-tag"]},
    )
    archived_id = archived_response.json()["id"]
    await client.post(f"/bookmarks/{archived_id}/archive")

    # Bookmark to be deleted - tags should appear with count 0 when include_inactive=true
    deleted_response = await client.post(
        "/bookmarks/",
        json={"url": "https://deleted.com", "tags": ["deleted-tag", "shared-tag"]},
    )
    deleted_id = deleted_response.json()["id"]
    await client.delete(f"/bookmarks/{deleted_id}")

    # Get tags with include_inactive=true
    response = await client.get("/tags/?include_inactive=true")
    assert response.status_code == 200

    data = response.json()
    tag_counts = {tag["name"]: tag["content_count"] for tag in data["tags"]}

    # All tags should be present
    assert len(tag_counts) == 4

    # Active bookmark's tags should have correct counts
    assert tag_counts["active-tag"] == 1
    assert tag_counts["shared-tag"] == 1

    # Tags exclusive to archived/deleted bookmarks should appear with count 0
    assert tag_counts["archived-tag"] == 0
    assert tag_counts["deleted-tag"] == 0


async def test_list_tags_include_inactive_false_is_default(client: AsyncClient) -> None:
    """Test that include_inactive=false behaves the same as no parameter."""
    # Create bookmark then delete it
    response = await client.post(
        "/bookmarks/",
        json={"url": "https://example.com", "tags": ["orphan-tag"]},
    )
    bookmark_id = response.json()["id"]
    await client.delete(f"/bookmarks/{bookmark_id}")

    # Both requests should return empty list (orphan tag excluded)
    response_default = await client.get("/tags/")
    response_explicit = await client.get("/tags/?include_inactive=false")

    assert response_default.status_code == 200
    assert response_explicit.status_code == 200
    assert response_default.json()["tags"] == []
    assert response_explicit.json()["tags"] == []


async def test_list_tags_include_inactive_with_mixed_content_types(client: AsyncClient) -> None:
    """Test include_inactive works across bookmarks, notes, and prompts."""
    # Create active bookmark with tag
    await client.post(
        "/bookmarks/",
        json={"url": "https://example.com", "tags": ["bookmark-tag"]},
    )

    # Create note then delete it
    note_response = await client.post(
        "/notes/",
        json={"title": "Test Note", "content": "Content", "tags": ["note-tag"]},
    )
    note_id = note_response.json()["id"]
    await client.delete(f"/notes/{note_id}")

    # Create prompt then archive it
    prompt_response = await client.post(
        "/prompts/",
        json={"name": "test-prompt", "content": "Hello world", "tags": ["prompt-tag"]},
    )
    assert prompt_response.status_code == 201, f"Failed to create prompt: {prompt_response.text}"
    prompt_id = prompt_response.json()["id"]
    await client.post(f"/prompts/{prompt_id}/archive")

    # Without include_inactive: only bookmark-tag
    response_default = await client.get("/tags/")
    assert response_default.status_code == 200
    tag_names = [t["name"] for t in response_default.json()["tags"]]
    assert tag_names == ["bookmark-tag"]

    # With include_inactive: all three tags
    response_with_inactive = await client.get("/tags/?include_inactive=true")
    assert response_with_inactive.status_code == 200
    tag_counts = {t["name"]: t["content_count"] for t in response_with_inactive.json()["tags"]}
    assert len(tag_counts) == 3
    assert tag_counts["bookmark-tag"] == 1
    assert tag_counts["note-tag"] == 0
    assert tag_counts["prompt-tag"] == 0


async def test_rename_tag_success(client: AsyncClient) -> None:
    """Test successful tag rename."""
    # Create bookmark with tag
    await client.post(
        "/bookmarks/",
        json={"url": "https://example.com", "tags": ["old-name"]},
    )

    # Rename the tag
    response = await client.patch(
        "/tags/old-name",
        json={"new_name": "new-name"},
    )
    assert response.status_code == 200

    data = response.json()
    assert data["name"] == "new-name"
    assert "id" in data
    assert "created_at" in data

    # Verify tag list shows new name
    tags_response = await client.get("/tags/")
    tag_names = [tag["name"] for tag in tags_response.json()["tags"]]
    assert "new-name" in tag_names
    assert "old-name" not in tag_names


async def test_rename_tag_not_found(client: AsyncClient) -> None:
    """Test renaming a non-existent tag returns 404."""
    response = await client.patch(
        "/tags/nonexistent",
        json={"new_name": "new-name"},
    )
    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


async def test_rename_tag_conflict(client: AsyncClient) -> None:
    """Test renaming a tag to an existing name returns 409."""
    # Create two bookmarks with different tags
    await client.post(
        "/bookmarks/",
        json={"url": "https://ex1.com", "tags": ["tag-a"]},
    )
    await client.post(
        "/bookmarks/",
        json={"url": "https://ex2.com", "tags": ["tag-b"]},
    )

    # Try to rename tag-a to tag-b
    response = await client.patch(
        "/tags/tag-a",
        json={"new_name": "tag-b"},
    )
    assert response.status_code == 409
    assert "already exists" in response.json()["detail"].lower()


async def test_rename_tag_validates_format(client: AsyncClient) -> None:
    """Test renaming tag validates new name format."""
    await client.post(
        "/bookmarks/",
        json={"url": "https://example.com", "tags": ["valid-tag"]},
    )

    # Invalid format: contains spaces (not normalized away)
    response = await client.patch(
        "/tags/valid-tag",
        json={"new_name": "invalid name"},
    )
    assert response.status_code == 422


async def test_rename_tag_normalizes_name(client: AsyncClient) -> None:
    """Test renaming tag normalizes the new name."""
    await client.post(
        "/bookmarks/",
        json={"url": "https://example.com", "tags": ["old-tag"]},
    )

    # Mixed case should be normalized to lowercase
    response = await client.patch(
        "/tags/old-tag",
        json={"new_name": "  New-Tag  "},
    )
    assert response.status_code == 200
    assert response.json()["name"] == "new-tag"


async def test_delete_tag_success(client: AsyncClient) -> None:
    """Test successful tag deletion."""
    # Create bookmark with tag
    await client.post(
        "/bookmarks/",
        json={"url": "https://example.com", "tags": ["to-delete", "keep-me"]},
    )

    # Delete the tag
    response = await client.delete("/tags/to-delete")
    assert response.status_code == 204

    # Verify tag list no longer includes deleted tag
    tags_response = await client.get("/tags/")
    tag_names = [tag["name"] for tag in tags_response.json()["tags"]]
    assert "to-delete" not in tag_names
    assert "keep-me" in tag_names


async def test_delete_tag_not_found(client: AsyncClient) -> None:
    """Test deleting a non-existent tag returns 404."""
    response = await client.delete("/tags/nonexistent")
    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


async def test_delete_tag_removes_from_bookmarks(client: AsyncClient) -> None:
    """Test deleting a tag removes it from all associated bookmarks."""
    # Create multiple bookmarks with the same tag
    await client.post(
        "/bookmarks/",
        json={"url": "https://ex1.com", "tags": ["shared", "unique-1"]},
    )
    await client.post(
        "/bookmarks/",
        json={"url": "https://ex2.com", "tags": ["shared", "unique-2"]},
    )

    # Delete the shared tag
    response = await client.delete("/tags/shared")
    assert response.status_code == 204

    # Verify tag list
    tags_response = await client.get("/tags/")
    tag_names = [tag["name"] for tag in tags_response.json()["tags"]]
    assert "shared" not in tag_names
    assert "unique-1" in tag_names
    assert "unique-2" in tag_names


# ============================================================================
# Filter count tests
# ============================================================================


async def test__list_tags__includes_tags_from_filters(client: AsyncClient) -> None:
    """Test that tags used only in filters appear in the tag list."""
    # Create a filter with a tag that is not used in any content
    response = await client.post(
        "/filters/",
        json={
            "name": "Work Filter",
            "content_types": ["bookmark"],
            "filter_expression": {
                "groups": [{"tags": ["filter-only-tag"], "operator": "AND"}],
                "group_operator": "OR",
            },
        },
    )
    assert response.status_code == 201

    # Get tags - should include the filter-only tag
    tags_response = await client.get("/tags/")
    assert tags_response.status_code == 200

    tags = tags_response.json()["tags"]
    tag_names = [t["name"] for t in tags]
    assert "filter-only-tag" in tag_names


async def test__list_tags__filter_only_tag_has_zero_content_count(
    client: AsyncClient,
) -> None:
    """Test that tags used only in filters have content_count: 0, filter_count: N."""
    # Create a filter with a tag
    response = await client.post(
        "/filters/",
        json={
            "name": "Work Filter",
            "content_types": ["bookmark"],
            "filter_expression": {
                "groups": [{"tags": ["filter-only"], "operator": "AND"}],
                "group_operator": "OR",
            },
        },
    )
    assert response.status_code == 201

    # Get tags
    tags_response = await client.get("/tags/")
    tags_dict = {t["name"]: t for t in tags_response.json()["tags"]}

    assert "filter-only" in tags_dict
    assert tags_dict["filter-only"]["content_count"] == 0
    assert tags_dict["filter-only"]["filter_count"] == 1


async def test__list_tags__content_only_tag_has_zero_filter_count(
    client: AsyncClient,
) -> None:
    """Test that tags used only in content have content_count: N, filter_count: 0."""
    # Create a bookmark with a tag
    await client.post(
        "/bookmarks/",
        json={"url": "https://example.com", "tags": ["content-only"]},
    )

    # Get tags
    tags_response = await client.get("/tags/")
    tags_dict = {t["name"]: t for t in tags_response.json()["tags"]}

    assert "content-only" in tags_dict
    assert tags_dict["content-only"]["content_count"] == 1
    assert tags_dict["content-only"]["filter_count"] == 0


async def test__list_tags__tag_in_filter_and_content_has_both_counts(
    client: AsyncClient,
) -> None:
    """Test that tags used in both filters and content have correct counts."""
    # Create a bookmark with a tag
    await client.post(
        "/bookmarks/",
        json={"url": "https://example.com", "tags": ["shared-tag"]},
    )
    await client.post(
        "/bookmarks/",
        json={"url": "https://example2.com", "tags": ["shared-tag"]},
    )

    # Create a filter with the same tag
    response = await client.post(
        "/filters/",
        json={
            "name": "Shared Filter",
            "content_types": ["bookmark"],
            "filter_expression": {
                "groups": [{"tags": ["shared-tag"], "operator": "AND"}],
                "group_operator": "OR",
            },
        },
    )
    assert response.status_code == 201

    # Get tags
    tags_response = await client.get("/tags/")
    tags_dict = {t["name"]: t for t in tags_response.json()["tags"]}

    assert "shared-tag" in tags_dict
    assert tags_dict["shared-tag"]["content_count"] == 2
    assert tags_dict["shared-tag"]["filter_count"] == 1


async def test__list_tags__filter_deleted_updates_filter_count(
    client: AsyncClient,
) -> None:
    """Test that filter_count decreases when a filter is deleted."""
    # Create a filter with a tag
    response = await client.post(
        "/filters/",
        json={
            "name": "Work Filter",
            "content_types": ["bookmark"],
            "filter_expression": {
                "groups": [{"tags": ["filter-tag"], "operator": "AND"}],
                "group_operator": "OR",
            },
        },
    )
    assert response.status_code == 201
    filter_id = response.json()["id"]

    # Verify filter_count is 1
    tags_response = await client.get("/tags/")
    tags_dict = {t["name"]: t for t in tags_response.json()["tags"]}
    assert tags_dict["filter-tag"]["filter_count"] == 1

    # Delete the filter
    delete_response = await client.delete(f"/filters/{filter_id}")
    assert delete_response.status_code == 204

    # Get tags - tag should no longer appear (no content and no filters)
    tags_response = await client.get("/tags/")
    tag_names = [t["name"] for t in tags_response.json()["tags"]]
    assert "filter-tag" not in tag_names


async def test__list_tags__tag_in_multiple_filters_counted_correctly(
    client: AsyncClient,
) -> None:
    """Test that a tag in 3 filters has filter_count: 3."""
    # Create 3 filters with the same tag
    for i in range(3):
        response = await client.post(
            "/filters/",
            json={
                "name": f"Filter {i}",
                "content_types": ["bookmark"],
                "filter_expression": {
                    "groups": [{"tags": ["multi-filter-tag"], "operator": "AND"}],
                    "group_operator": "OR",
                },
            },
        )
        assert response.status_code == 201

    # Get tags
    tags_response = await client.get("/tags/")
    tags_dict = {t["name"]: t for t in tags_response.json()["tags"]}

    assert "multi-filter-tag" in tags_dict
    assert tags_dict["multi-filter-tag"]["filter_count"] == 3
    assert tags_dict["multi-filter-tag"]["content_count"] == 0


async def test__list_tags__sorted_by_filter_count_then_content_count(
    client: AsyncClient,
) -> None:
    """Test sorting: filter_count DESC, then content_count DESC, then name ASC."""
    # Create tags with different combinations of counts:
    # - "high-filter": filter_count=2, content_count=0
    # - "low-filter-high-content": filter_count=1, content_count=3
    # - "no-filter-high-content": filter_count=0, content_count=5
    # - "no-filter-low-content": filter_count=0, content_count=1
    # - "alpha-tag": filter_count=0, content_count=1 (same as above, but alphabetically first)

    # Create 2 filters with "high-filter"
    for i in range(2):
        await client.post(
            "/filters/",
            json={
                "name": f"Filter HF {i}",
                "content_types": ["bookmark"],
                "filter_expression": {
                    "groups": [{"tags": ["high-filter"], "operator": "AND"}],
                    "group_operator": "OR",
                },
            },
        )

    # Create 1 filter with "low-filter-high-content" and 3 bookmarks
    await client.post(
        "/filters/",
        json={
            "name": "Filter LF",
            "content_types": ["bookmark"],
            "filter_expression": {
                "groups": [{"tags": ["low-filter-high-content"], "operator": "AND"}],
                "group_operator": "OR",
            },
        },
    )
    for i in range(3):
        await client.post(
            "/bookmarks/",
            json={"url": f"https://lf{i}.com", "tags": ["low-filter-high-content"]},
        )

    # Create 5 bookmarks with "no-filter-high-content"
    for i in range(5):
        await client.post(
            "/bookmarks/",
            json={"url": f"https://nfhc{i}.com", "tags": ["no-filter-high-content"]},
        )

    # Create 1 bookmark with "no-filter-low-content"
    await client.post(
        "/bookmarks/",
        json={"url": "https://nflc.com", "tags": ["no-filter-low-content"]},
    )

    # Create 1 bookmark with "alpha-tag" (alphabetically before "no-filter-low-content")
    await client.post(
        "/bookmarks/",
        json={"url": "https://alpha.com", "tags": ["alpha-tag"]},
    )

    # Get tags
    tags_response = await client.get("/tags/")
    tags = tags_response.json()["tags"]
    tag_order = [t["name"] for t in tags]

    # Expected order:
    # 1. high-filter (filter_count=2)
    # 2. low-filter-high-content (filter_count=1)
    # 3. no-filter-high-content (filter_count=0, content_count=5)
    # 4. low-filter-high-content already listed above
    # 5. alpha-tag (filter_count=0, content_count=1, alphabetically before no-filter-low-content)
    # 6. no-filter-low-content (filter_count=0, content_count=1)

    assert tag_order[0] == "high-filter"
    assert tag_order[1] == "low-filter-high-content"
    assert tag_order[2] == "no-filter-high-content"
    # Last two should be alphabetically sorted since both have filter_count=0, content_count=1
    assert tag_order[3] == "alpha-tag"
    assert tag_order[4] == "no-filter-low-content"


# ============================================================================
# Tag rename cascade tests
# ============================================================================


async def test__rename_tag__filter_uses_new_name(client: AsyncClient) -> None:
    """Test that renaming a tag updates the filter expression to show the new name."""
    # Create a bookmark with a tag (creates the tag)
    await client.post(
        "/bookmarks/",
        json={"url": "https://example.com", "tags": ["old-tag-name"]},
    )

    # Create a filter using the tag
    filter_response = await client.post(
        "/filters/",
        json={
            "name": "Test Filter",
            "content_types": ["bookmark"],
            "filter_expression": {
                "groups": [{"tags": ["old-tag-name"], "operator": "AND"}],
                "group_operator": "OR",
            },
        },
    )
    assert filter_response.status_code == 201
    filter_id = filter_response.json()["id"]

    # Rename the tag
    rename_response = await client.patch(
        "/tags/old-tag-name",
        json={"new_name": "new-tag-name"},
    )
    assert rename_response.status_code == 200

    # Get the filter and verify it shows the new tag name
    get_filter_response = await client.get(f"/filters/{filter_id}")
    assert get_filter_response.status_code == 200
    filter_data = get_filter_response.json()

    # The filter expression should now contain the new tag name
    tags_in_filter = filter_data["filter_expression"]["groups"][0]["tags"]
    assert "new-tag-name" in tags_in_filter
    assert "old-tag-name" not in tags_in_filter


async def test__rename_tag__filter_still_matches_content(client: AsyncClient) -> None:
    """Test that renaming a tag doesn't break filter functionality."""
    # Create a bookmark with a tag
    bookmark_response = await client.post(
        "/bookmarks/",
        json={"url": "https://example.com", "title": "Tagged Bookmark", "tags": ["work"]},
    )
    assert bookmark_response.status_code == 201

    # Create a filter using the tag
    filter_response = await client.post(
        "/filters/",
        json={
            "name": "Work Filter",
            "content_types": ["bookmark"],
            "filter_expression": {
                "groups": [{"tags": ["work"], "operator": "AND"}],
                "group_operator": "OR",
            },
        },
    )
    assert filter_response.status_code == 201
    filter_id = filter_response.json()["id"]

    # Verify filter matches the bookmark before rename
    list_response = await client.get(f"/bookmarks/?filter_id={filter_id}")
    assert list_response.status_code == 200
    assert list_response.json()["total"] == 1

    # Rename the tag
    rename_response = await client.patch(
        "/tags/work",
        json={"new_name": "job"},
    )
    assert rename_response.status_code == 200

    # Verify filter still matches the bookmark after rename
    list_response = await client.get(f"/bookmarks/?filter_id={filter_id}")
    assert list_response.status_code == 200
    assert list_response.json()["total"] == 1
    assert list_response.json()["items"][0]["title"] == "Tagged Bookmark"


# ============================================================================
# Tag delete blocking tests
# ============================================================================


async def test__delete_tag__blocked_when_used_in_filter(client: AsyncClient) -> None:
    """Test that deleting a tag used in a filter returns 409 with filter info."""
    # Create a bookmark with a tag (creates the tag)
    await client.post(
        "/bookmarks/",
        json={"url": "https://example.com", "tags": ["protected-tag"]},
    )

    # Create a filter using the tag
    filter_response = await client.post(
        "/filters/",
        json={
            "name": "My Filter",
            "content_types": ["bookmark"],
            "filter_expression": {
                "groups": [{"tags": ["protected-tag"], "operator": "AND"}],
                "group_operator": "OR",
            },
        },
    )
    filter_id = filter_response.json()["id"]

    # Try to delete the tag - should fail with 409
    delete_response = await client.delete("/tags/protected-tag")
    assert delete_response.status_code == 409

    data = delete_response.json()
    assert "detail" in data
    assert data["detail"]["message"] == "Cannot delete tag 'protected-tag' because it is used in filters"
    # Filters include both id and name
    assert len(data["detail"]["filters"]) == 1
    assert data["detail"]["filters"][0]["id"] == filter_id
    assert data["detail"]["filters"][0]["name"] == "My Filter"


async def test__delete_tag__blocked_lists_multiple_filters(client: AsyncClient) -> None:
    """Test that 409 response lists all filters using the tag, ordered by name."""
    # Create a bookmark with a tag (creates the tag)
    await client.post(
        "/bookmarks/",
        json={"url": "https://example.com", "tags": ["shared-filter-tag"]},
    )

    # Create multiple filters using the same tag (in non-alphabetical order)
    filter_ids = {}
    for name in ["Filter C", "Filter A", "Filter B"]:
        response = await client.post(
            "/filters/",
            json={
                "name": name,
                "content_types": ["bookmark"],
                "filter_expression": {
                    "groups": [{"tags": ["shared-filter-tag"], "operator": "AND"}],
                    "group_operator": "OR",
                },
            },
        )
        filter_ids[name] = response.json()["id"]

    # Try to delete the tag - should fail with 409 listing all filters
    delete_response = await client.delete("/tags/shared-filter-tag")
    assert delete_response.status_code == 409

    data = delete_response.json()
    filters = data["detail"]["filters"]
    assert len(filters) == 3

    # Filters should be ordered alphabetically by name
    assert filters[0]["name"] == "Filter A"
    assert filters[0]["id"] == filter_ids["Filter A"]
    assert filters[1]["name"] == "Filter B"
    assert filters[1]["id"] == filter_ids["Filter B"]
    assert filters[2]["name"] == "Filter C"
    assert filters[2]["id"] == filter_ids["Filter C"]


async def test__delete_tag__succeeds_when_not_in_filters(client: AsyncClient) -> None:
    """Test that tags not used in filters can be deleted normally."""
    # Create a bookmark with a tag
    await client.post(
        "/bookmarks/",
        json={"url": "https://example.com", "tags": ["deletable-tag"]},
    )

    # Delete the tag - should succeed (no filters use it)
    delete_response = await client.delete("/tags/deletable-tag")
    assert delete_response.status_code == 204

    # Verify tag is gone
    tags_response = await client.get("/tags/?include_inactive=true")
    tag_names = [t["name"] for t in tags_response.json()["tags"]]
    assert "deletable-tag" not in tag_names


async def test__delete_tag__succeeds_after_removing_from_filter(
    client: AsyncClient,
) -> None:
    """Test that a tag can be deleted after being removed from all filters."""
    # Create a bookmark with a tag
    await client.post(
        "/bookmarks/",
        json={"url": "https://example.com", "tags": ["removable-tag", "other-tag"]},
    )

    # Create a filter using the tag
    filter_response = await client.post(
        "/filters/",
        json={
            "name": "Test Filter",
            "content_types": ["bookmark"],
            "filter_expression": {
                "groups": [{"tags": ["removable-tag"], "operator": "AND"}],
                "group_operator": "OR",
            },
        },
    )
    filter_id = filter_response.json()["id"]

    # Try to delete - should fail
    delete_response = await client.delete("/tags/removable-tag")
    assert delete_response.status_code == 409

    # Update filter to use a different tag
    await client.patch(
        f"/filters/{filter_id}",
        json={
            "filter_expression": {
                "groups": [{"tags": ["other-tag"], "operator": "AND"}],
                "group_operator": "OR",
            },
        },
    )

    # Now delete should succeed
    delete_response = await client.delete("/tags/removable-tag")
    assert delete_response.status_code == 204
