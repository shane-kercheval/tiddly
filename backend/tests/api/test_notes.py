"""Tests for note CRUD endpoints."""
import asyncio
from datetime import datetime, timedelta, UTC
from uuid import UUID

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.note import Note
from models.user import User
from models.user_consent import UserConsent


async def add_consent_for_user(db_session: AsyncSession, user: User) -> None:
    """Add valid consent record for a user (required for non-dev mode tests)."""
    from core.policy_versions import PRIVACY_POLICY_VERSION, TERMS_OF_SERVICE_VERSION

    consent = UserConsent(
        user_id=user.id,
        consented_at=datetime.now(UTC),
        privacy_policy_version=PRIVACY_POLICY_VERSION,
        terms_of_service_version=TERMS_OF_SERVICE_VERSION,
    )
    db_session.add(consent)
    await db_session.flush()


# =============================================================================
# Create Note Tests
# =============================================================================


async def test_create_note(client: AsyncClient, db_session: AsyncSession) -> None:
    """Test creating a new note with all fields."""
    response = await client.post(
        "/notes/",
        json={
            "title": "My Test Note",
            "description": "A test description",
            "content": "This is the **markdown** content of the note.",
            "tags": ["example", "test"],
        },
    )
    assert response.status_code == 201

    data = response.json()
    # Verify all response fields
    assert data["title"] == "My Test Note"
    assert data["description"] == "A test description"
    assert data["content"] == "This is the **markdown** content of the note."
    assert data["tags"] == ["example", "test"]
    assert data["deleted_at"] is None
    assert data["archived_at"] is None
    assert data["version"] == 1
    assert isinstance(data["id"], str)
    assert "created_at" in data
    assert "updated_at" in data
    assert "last_used_at" in data

    # Verify in database
    result = await db_session.execute(select(Note).where(Note.id == UUID(data["id"])))
    note = result.scalar_one()
    assert note.title == "My Test Note"
    assert note.description == "A test description"
    assert note.content == "This is the **markdown** content of the note."


async def test_create_note_minimal(client: AsyncClient) -> None:
    """Test creating a note with only title (minimal required data)."""
    response = await client.post(
        "/notes/",
        json={"title": "Minimal Note"},
    )
    assert response.status_code == 201

    data = response.json()
    assert data["title"] == "Minimal Note"
    assert data["description"] is None
    assert data["content"] is None
    assert data["tags"] == []


async def test_create_note_requires_title(client: AsyncClient) -> None:
    """Test that creating a note without title fails."""
    response = await client.post(
        "/notes/",
        json={"content": "Some content without a title"},
    )
    assert response.status_code == 422
    assert "title" in response.text.lower()


async def test_create_note_empty_title_rejected(client: AsyncClient) -> None:
    """Test that empty title is rejected."""
    response = await client.post(
        "/notes/",
        json={"title": ""},
    )
    assert response.status_code == 422


async def test_create_note_whitespace_only_title_rejected(client: AsyncClient) -> None:
    """Test that whitespace-only title is rejected."""
    response = await client.post(
        "/notes/",
        json={"title": "   "},
    )
    assert response.status_code == 422


async def test_create_note_with_future_archived_at(client: AsyncClient) -> None:
    """Test creating a note with a scheduled auto-archive date."""
    future_date = (datetime.now(UTC) + timedelta(days=7)).isoformat()

    response = await client.post(
        "/notes/",
        json={
            "title": "Scheduled Note",
            "archived_at": future_date,
        },
    )
    assert response.status_code == 201

    data = response.json()
    assert data["archived_at"] is not None
    # Should appear in active view (not yet archived)
    list_response = await client.get("/notes/", params={"view": "active"})
    assert any(n["id"] == data["id"] for n in list_response.json()["items"])


async def test_create_note_normalizes_tags(client: AsyncClient) -> None:
    """Test that tags are normalized to lowercase."""
    response = await client.post(
        "/notes/",
        json={
            "title": "Tag Normalization Test",
            "tags": ["Python", "FASTAPI", "Web-Dev"],
        },
    )
    assert response.status_code == 201

    data = response.json()
    assert data["tags"] == ["python", "fastapi", "web-dev"]


async def test_create_note_invalid_tag_with_underscore(client: AsyncClient) -> None:
    """Test that tags with underscores are rejected."""
    response = await client.post(
        "/notes/",
        json={
            "title": "Invalid Tag Note",
            "tags": ["invalid_tag"],
        },
    )
    assert response.status_code == 422
    assert "Invalid tag format" in response.text


async def test_create_note_valid_tag_with_numbers(client: AsyncClient) -> None:
    """Test that tags with numbers are valid."""
    response = await client.post(
        "/notes/",
        json={
            "title": "Note with Numbers",
            "tags": ["web-dev-2024", "python3"],
        },
    )
    assert response.status_code == 201
    assert response.json()["tags"] == ["web-dev-2024", "python3"]


# =============================================================================
# List Notes Tests
# =============================================================================


async def test_list_notes(client: AsyncClient) -> None:
    """Test listing notes."""
    # Create some notes first
    for i in range(3):
        await client.post(
            "/notes/",
            json={"title": f"List Note {i}"},
        )

    response = await client.get("/notes/")
    assert response.status_code == 200

    data = response.json()
    assert len(data["items"]) == 3
    assert data["total"] == 3


async def test_list_notes_pagination(client: AsyncClient) -> None:
    """Test note listing with pagination."""
    # Create 5 notes
    for i in range(5):
        await client.post(
            "/notes/",
            json={"title": f"Paginate Note {i}"},
        )

    # Test limit
    response = await client.get("/notes/?limit=2")
    assert response.status_code == 200
    data = response.json()
    assert len(data["items"]) == 2
    assert data["total"] == 5
    assert data["has_more"] is True

    # Test offset
    response = await client.get("/notes/?offset=1&limit=2")
    assert response.status_code == 200
    data = response.json()
    assert len(data["items"]) == 2
    assert data["total"] == 5


async def test_list_notes_excludes_content(client: AsyncClient) -> None:
    """Test that list endpoint doesn't return content field for performance."""
    await client.post(
        "/notes/",
        json={
            "title": "Note with Content",
            "content": "This is a long content that should not be in list",
        },
    )

    response = await client.get("/notes/")
    assert response.status_code == 200
    items = response.json()["items"]
    # List items should not have content field
    for item in items:
        assert "content" not in item


async def test_list_notes_search(client: AsyncClient) -> None:
    """Test note search by query."""
    await client.post("/notes/", json={"title": "Python Tutorial"})
    await client.post("/notes/", json={"title": "JavaScript Guide"})
    await client.post("/notes/", json={"title": "Python Reference", "content": "Python content here"})

    response = await client.get("/notes/", params={"q": "Python"})
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 2
    titles = [item["title"] for item in data["items"]]
    assert "Python Tutorial" in titles
    assert "Python Reference" in titles


async def test_list_notes_filter_by_tags(client: AsyncClient) -> None:
    """Test note filtering by tags."""
    await client.post("/notes/", json={"title": "Tagged Note 1", "tags": ["python", "web"]})
    await client.post("/notes/", json={"title": "Tagged Note 2", "tags": ["python"]})
    await client.post("/notes/", json={"title": "Untagged Note"})

    # Filter by single tag
    response = await client.get("/notes/", params={"tags": ["python"]})
    assert response.status_code == 200
    assert response.json()["total"] == 2

    # Filter by multiple tags (AND mode)
    response = await client.get("/notes/", params={"tags": ["python", "web"]})
    assert response.status_code == 200
    assert response.json()["total"] == 1

    # Filter by multiple tags (OR mode)
    response = await client.get("/notes/", params={"tags": ["python", "web"], "tag_match": "any"})
    assert response.status_code == 200
    assert response.json()["total"] == 2


async def test_list_notes_view_active_excludes_deleted_and_archived(
    client: AsyncClient,
) -> None:
    """Test that active view excludes deleted and archived notes."""
    # Create notes in different states
    active_resp = await client.post("/notes/", json={"title": "Active Note"})
    active_id = active_resp.json()["id"]

    archived_resp = await client.post("/notes/", json={"title": "To Archive"})
    archived_id = archived_resp.json()["id"]
    await client.post(f"/notes/{archived_id}/archive")

    deleted_resp = await client.post("/notes/", json={"title": "To Delete"})
    deleted_id = deleted_resp.json()["id"]
    await client.delete(f"/notes/{deleted_id}")

    # Active view should only show active note
    response = await client.get("/notes/", params={"view": "active"})
    assert response.status_code == 200
    items = response.json()["items"]
    ids = [item["id"] for item in items]
    assert active_id in ids
    assert archived_id not in ids
    assert deleted_id not in ids


async def test_list_notes_view_archived(client: AsyncClient) -> None:
    """Test that archived view returns only archived notes."""
    # Create and archive some notes
    for i in range(2):
        response = await client.post("/notes/", json={"title": f"Archive Note {i}"})
        await client.post(f"/notes/{response.json()['id']}/archive")

    # Create an active note
    await client.post("/notes/", json={"title": "Active Note"})

    response = await client.get("/notes/", params={"view": "archived"})
    assert response.status_code == 200
    assert response.json()["total"] == 2
    for item in response.json()["items"]:
        assert item["archived_at"] is not None


async def test_list_notes_view_deleted(client: AsyncClient) -> None:
    """Test that deleted view returns only soft-deleted notes."""
    # Create and delete some notes
    for i in range(2):
        response = await client.post("/notes/", json={"title": f"Delete Note {i}"})
        await client.delete(f"/notes/{response.json()['id']}")

    # Create an active note
    await client.post("/notes/", json={"title": "Active Note"})

    response = await client.get("/notes/", params={"view": "deleted"})
    assert response.status_code == 200
    assert response.json()["total"] == 2
    for item in response.json()["items"]:
        assert item["deleted_at"] is not None


# =============================================================================
# Get Single Note Tests
# =============================================================================


async def test_get_note(client: AsyncClient) -> None:
    """Test getting a single note."""
    # Create a note
    create_response = await client.post(
        "/notes/",
        json={"title": "Get Test", "content": "The full content"},
    )
    note_id = create_response.json()["id"]

    # Get it
    response = await client.get(f"/notes/{note_id}")
    assert response.status_code == 200

    data = response.json()
    assert data["id"] == note_id
    assert data["title"] == "Get Test"
    assert data["content"] == "The full content"


async def test_get_note_not_found(client: AsyncClient) -> None:
    """Test getting a non-existent note returns 404."""
    response = await client.get("/notes/00000000-0000-0000-0000-000000000000")
    assert response.status_code == 404
    assert response.json()["detail"] == "Note not found"


async def test_get_archived_note_by_id(client: AsyncClient) -> None:
    """Test that GET /notes/{id} returns archived notes."""
    # Create and archive a note
    create_response = await client.post(
        "/notes/",
        json={"title": "Archived Note"},
    )
    note_id = create_response.json()["id"]
    await client.post(f"/notes/{note_id}/archive")

    # Fetch the archived note by ID - should succeed
    get_response = await client.get(f"/notes/{note_id}")
    assert get_response.status_code == 200
    assert get_response.json()["id"] == note_id
    assert get_response.json()["archived_at"] is not None


# =============================================================================
# Update Note Tests
# =============================================================================


async def test_update_note(client: AsyncClient) -> None:
    """Test updating a note."""
    # Create a note
    create_response = await client.post(
        "/notes/",
        json={"title": "Original Title", "content": "Original content"},
    )
    note_id = create_response.json()["id"]

    # Update it
    response = await client.patch(
        f"/notes/{note_id}",
        json={"title": "Updated Title", "tags": ["updated"]},
    )
    assert response.status_code == 200

    data = response.json()
    assert data["title"] == "Updated Title"
    assert data["tags"] == ["updated"]
    # Content should remain unchanged
    assert data["content"] == "Original content"


async def test_update_note_partial(client: AsyncClient) -> None:
    """Test partial update only changes specified fields."""
    # Create a note with description
    create_response = await client.post(
        "/notes/",
        json={
            "title": "Original",
            "description": "Original description",
            "content": "Original content",
        },
    )
    note_id = create_response.json()["id"]

    # Update only title
    response = await client.patch(
        f"/notes/{note_id}",
        json={"title": "New Title"},
    )
    assert response.status_code == 200

    data = response.json()
    assert data["title"] == "New Title"
    assert data["description"] == "Original description"  # Unchanged
    assert data["content"] == "Original content"  # Unchanged


async def test_update_note_updates_updated_at(client: AsyncClient) -> None:
    """Test that updating a note updates the updated_at timestamp."""
    # Create a note
    create_response = await client.post(
        "/notes/",
        json={"title": "Timestamp Test"},
    )
    assert create_response.status_code == 201
    original_updated_at = create_response.json()["updated_at"]
    note_id = create_response.json()["id"]

    # Small delay to ensure different timestamp
    await asyncio.sleep(0.01)

    # Update the note
    response = await client.patch(
        f"/notes/{note_id}",
        json={"title": "New Title"},
    )
    assert response.status_code == 200

    data = response.json()
    # updated_at should be newer than the original
    assert data["updated_at"] > original_updated_at


async def test_update_note_not_found(client: AsyncClient) -> None:
    """Test updating a non-existent note returns 404."""
    response = await client.patch(
        "/notes/00000000-0000-0000-0000-000000000000",
        json={"title": "Won't Work"},
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Note not found"


async def test_update_note_set_archived_at(client: AsyncClient) -> None:
    """Test updating a note to schedule auto-archive."""
    # Create a note
    create_response = await client.post(
        "/notes/",
        json={"title": "Will Schedule"},
    )
    assert create_response.status_code == 201
    note_id = create_response.json()["id"]

    # Update to add scheduled archive
    future_date = (datetime.now(UTC) + timedelta(days=14)).isoformat()
    update_response = await client.patch(
        f"/notes/{note_id}",
        json={"archived_at": future_date},
    )
    assert update_response.status_code == 200
    assert update_response.json()["archived_at"] is not None


async def test_update_note_clear_archived_at(client: AsyncClient) -> None:
    """Test clearing a scheduled archive date by setting archived_at to null."""
    # Create a note with scheduled archive
    future_date = (datetime.now(UTC) + timedelta(days=7)).isoformat()
    create_response = await client.post(
        "/notes/",
        json={
            "title": "To Clear Schedule",
            "archived_at": future_date,
        },
    )
    assert create_response.status_code == 201
    note_id = create_response.json()["id"]
    assert create_response.json()["archived_at"] is not None

    # Clear the scheduled archive
    update_response = await client.patch(
        f"/notes/{note_id}",
        json={"archived_at": None},
    )
    assert update_response.status_code == 200
    assert update_response.json()["archived_at"] is None


# =============================================================================
# Delete Note Tests
# =============================================================================


async def test_delete_note(client: AsyncClient) -> None:
    """Test soft deleting a note."""
    # Create a note
    create_response = await client.post(
        "/notes/",
        json={"title": "To Delete"},
    )
    note_id = create_response.json()["id"]

    # Delete it (soft delete)
    response = await client.delete(f"/notes/{note_id}")
    assert response.status_code == 204

    # GET by ID still returns the item (for viewing in trash), but with deleted_at set
    get_response = await client.get(f"/notes/{note_id}")
    assert get_response.status_code == 200
    assert get_response.json()["deleted_at"] is not None

    # Verify it's not in the active list view
    list_response = await client.get("/notes/")
    assert all(n["id"] != note_id for n in list_response.json()["items"])


async def test_delete_note_permanent(client: AsyncClient, db_session: AsyncSession) -> None:
    """Test permanently deleting a note."""
    # Create and soft delete a note
    create_response = await client.post(
        "/notes/",
        json={"title": "To Delete Permanently"},
    )
    note_id = create_response.json()["id"]
    await client.delete(f"/notes/{note_id}")

    # Permanently delete
    response = await client.delete(f"/notes/{note_id}", params={"permanent": True})
    assert response.status_code == 204

    # Verify it's gone from database
    result = await db_session.execute(select(Note).where(Note.id == note_id))
    assert result.scalar_one_or_none() is None


async def test_delete_note_not_found(client: AsyncClient) -> None:
    """Test deleting a non-existent note returns 404."""
    response = await client.delete("/notes/00000000-0000-0000-0000-000000000000")
    assert response.status_code == 404
    assert response.json()["detail"] == "Note not found"


# =============================================================================
# Restore Note Tests
# =============================================================================


async def test_restore_note_success(client: AsyncClient) -> None:
    """Test that restore endpoint restores a deleted note."""
    # Create and delete a note
    response = await client.post(
        "/notes/",
        json={"title": "To Restore"},
    )
    assert response.status_code == 201
    note_id = response.json()["id"]

    await client.delete(f"/notes/{note_id}")

    # Restore it
    response = await client.post(f"/notes/{note_id}/restore")
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == note_id
    assert data["deleted_at"] is None

    # Should appear in active list again
    response = await client.get("/notes/")
    assert any(n["id"] == note_id for n in response.json()["items"])


async def test_restore_note_clears_both_timestamps(client: AsyncClient) -> None:
    """Test that restore clears both deleted_at and archived_at."""
    # Create, archive, then delete a note
    response = await client.post(
        "/notes/",
        json={"title": "Archived then Deleted"},
    )
    assert response.status_code == 201
    note_id = response.json()["id"]

    await client.post(f"/notes/{note_id}/archive")
    await client.delete(f"/notes/{note_id}")

    # Restore it
    response = await client.post(f"/notes/{note_id}/restore")
    assert response.status_code == 200
    data = response.json()
    assert data["deleted_at"] is None
    assert data["archived_at"] is None


async def test_restore_note_not_deleted_returns_400(client: AsyncClient) -> None:
    """Test that restoring a non-deleted note returns 400."""
    # Create a note (not deleted)
    response = await client.post(
        "/notes/",
        json={"title": "Not Deleted"},
    )
    assert response.status_code == 201
    note_id = response.json()["id"]

    # Try to restore
    response = await client.post(f"/notes/{note_id}/restore")
    assert response.status_code == 400
    assert "not deleted" in response.json()["detail"]


async def test_restore_note_not_found_returns_404(client: AsyncClient) -> None:
    """Test that restoring a non-existent note returns 404."""
    response = await client.post("/notes/00000000-0000-0000-0000-000000000000/restore")
    assert response.status_code == 404


# =============================================================================
# Archive Note Tests
# =============================================================================


async def test_archive_note_success(client: AsyncClient) -> None:
    """Test that archive endpoint archives a note."""
    # Create a note
    response = await client.post(
        "/notes/",
        json={"title": "To Archive"},
    )
    assert response.status_code == 201
    note_id = response.json()["id"]

    # Archive it
    response = await client.post(f"/notes/{note_id}/archive")
    assert response.status_code == 200
    data = response.json()
    assert data["archived_at"] is not None

    # Should not appear in active list
    response = await client.get("/notes/")
    assert not any(n["id"] == note_id for n in response.json()["items"])


async def test_archive_note_is_idempotent(client: AsyncClient) -> None:
    """Test that archiving an already-archived note returns 200."""
    # Create and archive a note
    response = await client.post(
        "/notes/",
        json={"title": "To Archive"},
    )
    assert response.status_code == 201
    note_id = response.json()["id"]

    await client.post(f"/notes/{note_id}/archive")

    # Archive again - should succeed
    response = await client.post(f"/notes/{note_id}/archive")
    assert response.status_code == 200


async def test_archive_note_not_found_returns_404(client: AsyncClient) -> None:
    """Test that archiving a non-existent note returns 404."""
    response = await client.post("/notes/00000000-0000-0000-0000-000000000000/archive")
    assert response.status_code == 404


# =============================================================================
# Unarchive Note Tests
# =============================================================================


async def test_unarchive_note_success(client: AsyncClient) -> None:
    """Test that unarchive endpoint unarchives a note."""
    # Create and archive a note
    response = await client.post(
        "/notes/",
        json={"title": "To Unarchive"},
    )
    assert response.status_code == 201
    note_id = response.json()["id"]

    await client.post(f"/notes/{note_id}/archive")

    # Unarchive it
    response = await client.post(f"/notes/{note_id}/unarchive")
    assert response.status_code == 200
    data = response.json()
    assert data["archived_at"] is None

    # Should appear in active list again
    response = await client.get("/notes/")
    assert any(n["id"] == note_id for n in response.json()["items"])


async def test_unarchive_note_not_archived_returns_400(client: AsyncClient) -> None:
    """Test that unarchiving a non-archived note returns 400."""
    # Create a note (not archived)
    response = await client.post(
        "/notes/",
        json={"title": "Not Archived"},
    )
    assert response.status_code == 201
    note_id = response.json()["id"]

    # Try to unarchive
    response = await client.post(f"/notes/{note_id}/unarchive")
    assert response.status_code == 400
    assert "not archived" in response.json()["detail"]


async def test_unarchive_note_not_found_returns_404(client: AsyncClient) -> None:
    """Test that unarchiving a non-existent note returns 404."""
    response = await client.post("/notes/00000000-0000-0000-0000-000000000000/unarchive")
    assert response.status_code == 404


# =============================================================================
# Track Usage Tests
# =============================================================================


async def test_track_note_usage_success(client: AsyncClient) -> None:
    """Test that POST /notes/{id}/track-usage returns 204 and updates timestamp."""
    # Create a note
    response = await client.post(
        "/notes/",
        json={"title": "Track Me"},
    )
    assert response.status_code == 201
    note_id = response.json()["id"]
    original_last_used = response.json()["last_used_at"]

    # Small delay to ensure different timestamp
    await asyncio.sleep(0.01)

    # Track usage
    response = await client.post(f"/notes/{note_id}/track-usage")
    assert response.status_code == 204

    # Verify timestamp was updated
    response = await client.get(f"/notes/{note_id}")
    assert response.status_code == 200
    assert response.json()["last_used_at"] > original_last_used


async def test_track_note_usage_not_found(client: AsyncClient) -> None:
    """Test that POST /notes/{id}/track-usage returns 404 for non-existent note."""
    response = await client.post("/notes/00000000-0000-0000-0000-000000000000/track-usage")
    assert response.status_code == 404
    assert response.json()["detail"] == "Note not found"


async def test_track_note_usage_works_on_archived(client: AsyncClient) -> None:
    """Test that track-usage works on archived notes."""
    # Create and archive a note
    response = await client.post(
        "/notes/",
        json={"title": "Archived"},
    )
    assert response.status_code == 201
    note_id = response.json()["id"]

    response = await client.post(f"/notes/{note_id}/archive")
    assert response.status_code == 200
    original_last_used = response.json()["last_used_at"]

    # Small delay to ensure different timestamp
    await asyncio.sleep(0.01)

    # Track usage on archived note
    response = await client.post(f"/notes/{note_id}/track-usage")
    assert response.status_code == 204

    # Verify via archived view
    response = await client.get("/notes/", params={"view": "archived"})
    assert response.status_code == 200
    note = next(n for n in response.json()["items"] if n["id"] == note_id)
    assert note["last_used_at"] > original_last_used


async def test_track_note_usage_works_on_deleted(client: AsyncClient) -> None:
    """Test that track-usage works on soft-deleted notes."""
    # Create and delete a note
    response = await client.post(
        "/notes/",
        json={"title": "Deleted"},
    )
    assert response.status_code == 201
    note_id = response.json()["id"]
    original_last_used = response.json()["last_used_at"]

    response = await client.delete(f"/notes/{note_id}")
    assert response.status_code == 204

    # Small delay to ensure different timestamp
    await asyncio.sleep(0.01)

    # Track usage on deleted note
    response = await client.post(f"/notes/{note_id}/track-usage")
    assert response.status_code == 204

    # Verify via deleted view
    response = await client.get("/notes/", params={"view": "deleted"})
    assert response.status_code == 200
    note = next(n for n in response.json()["items"] if n["id"] == note_id)
    assert note["last_used_at"] > original_last_used


# =============================================================================
# Sort Tests
# =============================================================================


async def test_list_notes_sort_by_title(client: AsyncClient) -> None:
    """Test sorting notes by title."""
    await client.post("/notes/", json={"title": "Banana"})
    await client.post("/notes/", json={"title": "Apple"})
    await client.post("/notes/", json={"title": "Cherry"})

    # Sort ascending
    response = await client.get("/notes/", params={"sort_by": "title", "sort_order": "asc"})
    assert response.status_code == 200
    titles = [item["title"] for item in response.json()["items"]]
    assert titles == ["Apple", "Banana", "Cherry"]

    # Sort descending
    response = await client.get("/notes/", params={"sort_by": "title", "sort_order": "desc"})
    assert response.status_code == 200
    titles = [item["title"] for item in response.json()["items"]]
    assert titles == ["Cherry", "Banana", "Apple"]


async def test_list_notes_sort_by_title_case_insensitive(client: AsyncClient) -> None:
    """Test that title sorting is case-insensitive."""
    await client.post("/notes/", json={"title": "banana"})   # lowercase
    await client.post("/notes/", json={"title": "Apple"})    # capitalized
    await client.post("/notes/", json={"title": "CHERRY"})   # uppercase

    response = await client.get("/notes/", params={"sort_by": "title", "sort_order": "asc"})
    assert response.status_code == 200
    titles = [item["title"] for item in response.json()["items"]]
    # Case-insensitive order: Apple < banana < CHERRY
    assert titles == ["Apple", "banana", "CHERRY"]


async def test_list_notes_sort_by_created_at(client: AsyncClient) -> None:
    """Test sorting notes by created_at (default)."""
    await client.post("/notes/", json={"title": "First"})
    await client.post("/notes/", json={"title": "Second"})
    await client.post("/notes/", json={"title": "Third"})

    # Default is created_at desc (newest first)
    response = await client.get("/notes/")
    assert response.status_code == 200
    titles = [item["title"] for item in response.json()["items"]]
    assert titles == ["Third", "Second", "First"]


# =============================================================================
# Response Format Tests
# =============================================================================


async def test_note_response_includes_all_fields(client: AsyncClient) -> None:
    """Test that note response includes all expected fields."""
    response = await client.post(
        "/notes/",
        json={
            "title": "Complete Note",
            "description": "Description",
            "content": "Content",
            "tags": ["test"],
        },
    )
    assert response.status_code == 201
    data = response.json()

    expected_fields = [
        "id", "title", "description", "content", "tags",
        "created_at", "updated_at", "last_used_at",
        "deleted_at", "archived_at", "version",
    ]
    for field in expected_fields:
        assert field in data, f"Missing field: {field}"


async def test_note_list_item_excludes_content(client: AsyncClient) -> None:
    """Test that list item response excludes content field."""
    await client.post(
        "/notes/",
        json={"title": "Has Content", "content": "Lots of content here"},
    )

    response = await client.get("/notes/")
    assert response.status_code == 200

    for item in response.json()["items"]:
        assert "content" not in item


# =============================================================================
# List ID Filter Tests (ContentList integration)
# =============================================================================


async def test_list_notes_with_filter_id(client: AsyncClient) -> None:
    """Test filtering notes by filter_id parameter."""
    # Create notes with different tags
    await client.post(
        "/notes/",
        json={"title": "Work Priority", "content": "Content", "tags": ["work", "priority"]},
    )
    await client.post(
        "/notes/",
        json={"title": "Work Only", "content": "Content", "tags": ["work"]},
    )
    await client.post(
        "/notes/",
        json={"title": "Personal", "content": "Content", "tags": ["personal"]},
    )

    # Create a list that filters for work AND priority
    response = await client.post(
        "/filters/",
        json={
            "name": "Work Priority List",
            "filter_expression": {
                "groups": [{"tags": ["work", "priority"]}],
                "group_operator": "OR",
            },
        },
    )
    assert response.status_code == 201
    filter_id = response.json()["id"]

    # Filter notes by filter_id
    response = await client.get(f"/notes/?filter_id={filter_id}")
    assert response.status_code == 200

    data = response.json()
    assert data["total"] == 1
    assert data["items"][0]["title"] == "Work Priority"


async def test_list_notes_with_filter_id_complex_filter(client: AsyncClient) -> None:
    """Test filtering with complex list expression: (work AND priority) OR (urgent)."""
    # Create notes
    await client.post(
        "/notes/",
        json={"title": "Work Priority", "content": "Content", "tags": ["work", "priority"]},
    )
    await client.post(
        "/notes/",
        json={"title": "Urgent", "content": "Content", "tags": ["urgent"]},
    )
    await client.post(
        "/notes/",
        json={"title": "Personal", "content": "Content", "tags": ["personal"]},
    )

    # Create a list with complex filter
    response = await client.post(
        "/filters/",
        json={
            "name": "Priority Tasks",
            "filter_expression": {
                "groups": [
                    {"tags": ["work", "priority"]},
                    {"tags": ["urgent"]},
                ],
                "group_operator": "OR",
            },
        },
    )
    assert response.status_code == 201
    filter_id = response.json()["id"]

    # Filter notes by filter_id
    response = await client.get(f"/notes/?filter_id={filter_id}")
    assert response.status_code == 200

    data = response.json()
    assert data["total"] == 2
    titles = [n["title"] for n in data["items"]]
    assert "Work Priority" in titles
    assert "Urgent" in titles
    assert "Personal" not in titles


async def test_list_notes_with_filter_id_not_found(client: AsyncClient) -> None:
    """Test that non-existent filter_id returns 404."""
    response = await client.get("/notes/?filter_id=00000000-0000-0000-0000-000000000000")
    assert response.status_code == 404
    assert response.json()["detail"] == "Filter not found"


async def test_list_notes_with_filter_id_and_search(client: AsyncClient) -> None:
    """Test combining filter_id filter with text search."""
    # Create notes
    await client.post(
        "/notes/",
        json={"title": "Python Work", "content": "Content", "tags": ["work", "coding"]},
    )
    await client.post(
        "/notes/",
        json={"title": "JavaScript Work", "content": "Content", "tags": ["work", "coding"]},
    )
    await client.post(
        "/notes/",
        json={"title": "Python Personal", "content": "Content", "tags": ["personal", "coding"]},
    )

    # Create a list for work+coding
    response = await client.post(
        "/filters/",
        json={
            "name": "Work Coding",
            "filter_expression": {
                "groups": [{"tags": ["work", "coding"]}],
                "group_operator": "OR",
            },
        },
    )
    assert response.status_code == 201
    filter_id = response.json()["id"]

    # Filter by list AND search for "Python"
    response = await client.get(f"/notes/?filter_id={filter_id}&q=python")
    assert response.status_code == 200

    data = response.json()
    assert data["total"] == 1
    assert data["items"][0]["title"] == "Python Work"


async def test_list_notes_filter_id_combines_with_tags(client: AsyncClient) -> None:
    """Test that filter_id filter and tags parameter are combined with AND logic."""
    # Create notes
    await client.post(
        "/notes/",
        json={"title": "Work", "content": "Content", "tags": ["work"]},
    )
    await client.post(
        "/notes/",
        json={"title": "Work Urgent", "content": "Content", "tags": ["work", "urgent"]},
    )
    await client.post(
        "/notes/",
        json={"title": "Personal", "content": "Content", "tags": ["personal"]},
    )

    # Create a list for work
    response = await client.post(
        "/filters/",
        json={
            "name": "Work List",
            "filter_expression": {
                "groups": [{"tags": ["work"]}],
                "group_operator": "OR",
            },
        },
    )
    assert response.status_code == 201
    filter_id = response.json()["id"]

    # Pass both filter_id AND tags - should combine with AND logic
    response = await client.get(f"/notes/?filter_id={filter_id}&tags=urgent")
    assert response.status_code == 200

    data = response.json()
    # Should return only notes matching BOTH work list AND urgent tag
    assert data["total"] == 1
    assert data["items"][0]["title"] == "Work Urgent"


async def test_list_notes_filter_id_and_tags_no_overlap(client: AsyncClient) -> None:
    """Test that combining list filter and tags with no overlap returns empty."""
    # Note in work list
    await client.post(
        "/notes/",
        json={"title": "Work", "content": "Content", "tags": ["work"]},
    )
    # Note with personal tag (not in work list)
    await client.post(
        "/notes/",
        json={"title": "Personal", "content": "Content", "tags": ["personal"]},
    )

    # Create work list
    response = await client.post(
        "/filters/",
        json={
            "name": "Work",
            "filter_expression": {"groups": [{"tags": ["work"]}], "group_operator": "OR"},
        },
    )
    assert response.status_code == 201
    filter_id = response.json()["id"]

    # Filter work list by 'personal' tag - no note has both
    response = await client.get(f"/notes/?filter_id={filter_id}&tags=personal")
    assert response.status_code == 200
    assert response.json()["total"] == 0


async def test_list_notes_filter_id_empty_results(client: AsyncClient) -> None:
    """Test filter_id filter with no matching notes."""
    # Create a note
    await client.post(
        "/notes/",
        json={"title": "Something", "content": "Content", "tags": ["other"]},
    )

    # Create a list for non-existent tags
    response = await client.post(
        "/filters/",
        json={
            "name": "Empty List",
            "filter_expression": {
                "groups": [{"tags": ["nonexistent"]}],
                "group_operator": "OR",
            },
        },
    )
    assert response.status_code == 201
    filter_id = response.json()["id"]

    # Filter by list - should return empty
    response = await client.get(f"/notes/?filter_id={filter_id}")
    assert response.status_code == 200

    data = response.json()
    assert data["total"] == 0
    assert data["items"] == []


# =============================================================================
# Partial Read Tests
# =============================================================================


async def test__get_note__full_read_includes_content_metadata(client: AsyncClient) -> None:
    """Test that full read includes content_metadata with is_partial=false."""
    response = await client.post(
        "/notes/",
        json={"title": "Test", "content": "line 1\nline 2\nline 3"},
    )
    note_id = response.json()["id"]

    response = await client.get(f"/notes/{note_id}")
    assert response.status_code == 200

    data = response.json()
    assert data["content"] == "line 1\nline 2\nline 3"
    assert data["content_metadata"] is not None
    assert data["content_metadata"]["total_lines"] == 3
    assert data["content_metadata"]["start_line"] == 1
    assert data["content_metadata"]["end_line"] == 3
    assert data["content_metadata"]["is_partial"] is False


async def test__get_note__partial_read_with_both_params(client: AsyncClient) -> None:
    """Test partial read with start_line and end_line."""
    response = await client.post(
        "/notes/",
        json={"title": "Test", "content": "line 1\nline 2\nline 3\nline 4\nline 5"},
    )
    note_id = response.json()["id"]

    response = await client.get(f"/notes/{note_id}", params={"start_line": 2, "end_line": 4})
    assert response.status_code == 200

    data = response.json()
    assert data["content"] == "line 2\nline 3\nline 4"
    assert data["content_metadata"]["total_lines"] == 5
    assert data["content_metadata"]["start_line"] == 2
    assert data["content_metadata"]["end_line"] == 4
    assert data["content_metadata"]["is_partial"] is True


async def test__get_note__partial_read_start_line_only(client: AsyncClient) -> None:
    """Test partial read with only start_line (reads to end)."""
    response = await client.post(
        "/notes/",
        json={"title": "Test", "content": "line 1\nline 2\nline 3"},
    )
    note_id = response.json()["id"]

    response = await client.get(f"/notes/{note_id}", params={"start_line": 2})
    assert response.status_code == 200

    data = response.json()
    assert data["content"] == "line 2\nline 3"
    assert data["content_metadata"]["total_lines"] == 3
    assert data["content_metadata"]["start_line"] == 2
    assert data["content_metadata"]["end_line"] == 3
    assert data["content_metadata"]["is_partial"] is True


async def test__get_note__partial_read_end_line_only(client: AsyncClient) -> None:
    """Test partial read with only end_line (reads from line 1)."""
    response = await client.post(
        "/notes/",
        json={"title": "Test", "content": "line 1\nline 2\nline 3"},
    )
    note_id = response.json()["id"]

    response = await client.get(f"/notes/{note_id}", params={"end_line": 2})
    assert response.status_code == 200

    data = response.json()
    assert data["content"] == "line 1\nline 2"
    assert data["content_metadata"]["total_lines"] == 3
    assert data["content_metadata"]["start_line"] == 1
    assert data["content_metadata"]["end_line"] == 2
    assert data["content_metadata"]["is_partial"] is True


async def test__get_note__start_line_exceeds_total_returns_400(client: AsyncClient) -> None:
    """Test that start_line > total_lines returns 400."""
    response = await client.post(
        "/notes/",
        json={"title": "Test", "content": "line 1\nline 2"},
    )
    note_id = response.json()["id"]

    response = await client.get(f"/notes/{note_id}", params={"start_line": 10})
    assert response.status_code == 400
    assert "exceeds total lines" in response.json()["detail"]


async def test__get_note__end_line_clamped_to_total(client: AsyncClient) -> None:
    """Test that end_line > total_lines is clamped (no error)."""
    response = await client.post(
        "/notes/",
        json={"title": "Test", "content": "line 1\nline 2"},
    )
    note_id = response.json()["id"]

    response = await client.get(f"/notes/{note_id}", params={"start_line": 1, "end_line": 100})
    assert response.status_code == 200

    data = response.json()
    assert data["content"] == "line 1\nline 2"
    assert data["content_metadata"]["end_line"] == 2  # Clamped to total


async def test__get_note__start_greater_than_end_returns_400(client: AsyncClient) -> None:
    """Test that start_line > end_line returns 400."""
    response = await client.post(
        "/notes/",
        json={"title": "Test", "content": "line 1\nline 2\nline 3"},
    )
    note_id = response.json()["id"]

    response = await client.get(f"/notes/{note_id}", params={"start_line": 3, "end_line": 2})
    assert response.status_code == 400
    assert "must be <=" in response.json()["detail"]


async def test__get_note__null_content_no_params_omits_metadata(client: AsyncClient) -> None:
    """Test that null content with no line params omits content_metadata."""
    response = await client.post(
        "/notes/",
        json={"title": "No Content Note"},  # No content
    )
    note_id = response.json()["id"]

    response = await client.get(f"/notes/{note_id}")
    assert response.status_code == 200

    data = response.json()
    assert data["content"] is None
    assert data["content_metadata"] is None


async def test__get_note__null_content_with_line_params_returns_400(client: AsyncClient) -> None:
    """Test that null content with line params returns 400."""
    response = await client.post(
        "/notes/",
        json={"title": "No Content Note"},  # No content
    )
    note_id = response.json()["id"]

    response = await client.get(f"/notes/{note_id}", params={"start_line": 1})
    assert response.status_code == 400
    assert "Content is empty" in response.json()["detail"]


async def test__get_note__empty_string_content_is_valid(client: AsyncClient) -> None:
    """Test that empty string content with no params shows 1 line."""
    response = await client.post(
        "/notes/",
        json={"title": "Empty Content", "content": ""},
    )
    note_id = response.json()["id"]

    response = await client.get(f"/notes/{note_id}")
    assert response.status_code == 200

    data = response.json()
    assert data["content"] == ""
    assert data["content_metadata"]["total_lines"] == 1
    assert data["content_metadata"]["is_partial"] is False


async def test__get_note__empty_string_content_with_start_line(client: AsyncClient) -> None:
    """Test that empty string content with start_line=1 succeeds."""
    response = await client.post(
        "/notes/",
        json={"title": "Empty Content", "content": ""},
    )
    note_id = response.json()["id"]

    response = await client.get(f"/notes/{note_id}", params={"start_line": 1})
    assert response.status_code == 200

    data = response.json()
    assert data["content"] == ""
    assert data["content_metadata"]["total_lines"] == 1
    assert data["content_metadata"]["is_partial"] is True


async def test__get_note__trailing_newline_line_count(client: AsyncClient) -> None:
    """Test that trailing newline is counted correctly (hello\\n = 2 lines)."""
    response = await client.post(
        "/notes/",
        json={"title": "Trailing Newline", "content": "hello\n"},
    )
    note_id = response.json()["id"]

    response = await client.get(f"/notes/{note_id}")
    assert response.status_code == 200

    data = response.json()
    assert data["content_metadata"]["total_lines"] == 2


async def test__get_note__other_fields_unaffected_by_line_params(client: AsyncClient) -> None:
    """Test that title, description, tags are returned in full regardless of line params."""
    response = await client.post(
        "/notes/",
        json={
            "title": "Full Title Here",
            "description": "Full description text",
            "content": "line 1\nline 2\nline 3",
            "tags": ["tag1", "tag2"],
        },
    )
    note_id = response.json()["id"]

    response = await client.get(f"/notes/{note_id}", params={"start_line": 2, "end_line": 2})
    assert response.status_code == 200

    data = response.json()
    # Content is partial
    assert data["content"] == "line 2"
    assert data["content_metadata"]["is_partial"] is True
    # Other fields are complete
    assert data["title"] == "Full Title Here"
    assert data["description"] == "Full description text"
    assert data["tags"] == ["tag1", "tag2"]


# =============================================================================
# Within-Content Search Tests
# =============================================================================


async def test_search_in_note_basic(client: AsyncClient) -> None:
    """Test basic search within a note's content."""
    response = await client.post(
        "/notes/",
        json={
            "title": "Test Note",
            "content": "line 1\nline 2 with target\nline 3",
        },
    )
    assert response.status_code == 201
    note_id = response.json()["id"]

    response = await client.get(f"/notes/{note_id}/search", params={"q": "target"})
    assert response.status_code == 200

    data = response.json()
    assert data["total_matches"] == 1
    assert len(data["matches"]) == 1
    assert data["matches"][0]["field"] == "content"
    assert data["matches"][0]["line"] == 2
    assert "target" in data["matches"][0]["context"]


async def test_search_in_note_no_matches_returns_empty(client: AsyncClient) -> None:
    """Test that no matches returns empty array (not error)."""
    response = await client.post(
        "/notes/",
        json={"title": "Test Note", "content": "some content here"},
    )
    assert response.status_code == 201
    note_id = response.json()["id"]

    response = await client.get(f"/notes/{note_id}/search", params={"q": "nonexistent"})
    assert response.status_code == 200

    data = response.json()
    assert data["total_matches"] == 0
    assert data["matches"] == []


async def test_search_in_note_title_field(client: AsyncClient) -> None:
    """Test searching in title field returns full title as context."""
    response = await client.post(
        "/notes/",
        json={"title": "Important Meeting Notes", "content": "content here"},
    )
    assert response.status_code == 201
    note_id = response.json()["id"]

    response = await client.get(
        f"/notes/{note_id}/search",
        params={"q": "meeting", "fields": "title"},
    )
    assert response.status_code == 200

    data = response.json()
    assert data["total_matches"] == 1
    assert data["matches"][0]["field"] == "title"
    assert data["matches"][0]["line"] is None
    assert data["matches"][0]["context"] == "Important Meeting Notes"


async def test_search_in_note_description_field(client: AsyncClient) -> None:
    """Test searching in description field."""
    response = await client.post(
        "/notes/",
        json={
            "title": "Test Note",
            "description": "A detailed description for searching",
            "content": "content",
        },
    )
    assert response.status_code == 201
    note_id = response.json()["id"]

    response = await client.get(
        f"/notes/{note_id}/search",
        params={"q": "detailed", "fields": "description"},
    )
    assert response.status_code == 200

    data = response.json()
    assert data["total_matches"] == 1
    assert data["matches"][0]["field"] == "description"
    assert data["matches"][0]["line"] is None
    assert data["matches"][0]["context"] == "A detailed description for searching"


async def test_search_in_note_multiple_fields(client: AsyncClient) -> None:
    """Test searching across multiple fields."""
    response = await client.post(
        "/notes/",
        json={
            "title": "Python Tutorial",
            "description": "Learn Python basics",
            "content": "Python is a programming language",
        },
    )
    assert response.status_code == 201
    note_id = response.json()["id"]

    response = await client.get(
        f"/notes/{note_id}/search",
        params={"q": "python", "fields": "content,title,description"},
    )
    assert response.status_code == 200

    data = response.json()
    assert data["total_matches"] == 3
    fields = {m["field"] for m in data["matches"]}
    assert fields == {"content", "title", "description"}


async def test_search_in_note_case_insensitive_default(client: AsyncClient) -> None:
    """Test that search is case-insensitive by default."""
    response = await client.post(
        "/notes/",
        json={"title": "Test", "content": "Hello World"},
    )
    assert response.status_code == 201
    note_id = response.json()["id"]

    response = await client.get(f"/notes/{note_id}/search", params={"q": "WORLD"})
    assert response.status_code == 200
    assert response.json()["total_matches"] == 1


async def test_search_in_note_case_sensitive(client: AsyncClient) -> None:
    """Test case-sensitive search."""
    response = await client.post(
        "/notes/",
        json={"title": "Test", "content": "Hello World"},
    )
    assert response.status_code == 201
    note_id = response.json()["id"]

    # Case-sensitive search should not match
    response = await client.get(
        f"/notes/{note_id}/search",
        params={"q": "WORLD", "case_sensitive": True},
    )
    assert response.status_code == 200
    assert response.json()["total_matches"] == 0

    # Exact case should match
    response = await client.get(
        f"/notes/{note_id}/search",
        params={"q": "World", "case_sensitive": True},
    )
    assert response.status_code == 200
    assert response.json()["total_matches"] == 1


async def test_search_in_note_context_lines(client: AsyncClient) -> None:
    """Test context_lines parameter."""
    content = "line 1\nline 2\nline 3 target\nline 4\nline 5"
    response = await client.post(
        "/notes/",
        json={"title": "Test", "content": content},
    )
    assert response.status_code == 201
    note_id = response.json()["id"]

    # With context_lines=1
    response = await client.get(
        f"/notes/{note_id}/search",
        params={"q": "target", "context_lines": 1},
    )
    assert response.status_code == 200
    context = response.json()["matches"][0]["context"]
    assert "line 2" in context
    assert "line 3 target" in context
    assert "line 4" in context
    # Should not include line 1 or line 5
    assert "line 1" not in context
    assert "line 5" not in context


async def test_search_in_note_multiple_matches_in_content(client: AsyncClient) -> None:
    """Test multiple matches in content field."""
    response = await client.post(
        "/notes/",
        json={"title": "Test", "content": "foo bar\nbar baz\nqux bar"},
    )
    assert response.status_code == 201
    note_id = response.json()["id"]

    response = await client.get(
        f"/notes/{note_id}/search",
        params={"q": "bar", "context_lines": 0},
    )
    assert response.status_code == 200

    data = response.json()
    assert data["total_matches"] == 3
    lines = [m["line"] for m in data["matches"]]
    assert lines == [1, 2, 3]


async def test_search_in_note_not_found(client: AsyncClient) -> None:
    """Test 404 when note doesn't exist."""
    response = await client.get(
        "/notes/00000000-0000-0000-0000-000000000000/search",
        params={"q": "test"},
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Note not found"


async def test_search_in_note_invalid_field(client: AsyncClient) -> None:
    """Test 400 when invalid field is specified."""
    response = await client.post(
        "/notes/",
        json={"title": "Test", "content": "content"},
    )
    assert response.status_code == 201
    note_id = response.json()["id"]

    response = await client.get(
        f"/notes/{note_id}/search",
        params={"q": "test", "fields": "content,invalid"},
    )
    assert response.status_code == 400
    assert "Invalid fields" in response.json()["detail"]


async def test_search_in_note_works_on_archived(client: AsyncClient) -> None:
    """Test that search works on archived notes."""
    response = await client.post(
        "/notes/",
        json={"title": "Test", "content": "search target here"},
    )
    assert response.status_code == 201
    note_id = response.json()["id"]

    # Archive the note
    await client.post(f"/notes/{note_id}/archive")

    # Search should still work
    response = await client.get(f"/notes/{note_id}/search", params={"q": "target"})
    assert response.status_code == 200
    assert response.json()["total_matches"] == 1


async def test_search_in_note_works_on_deleted(client: AsyncClient) -> None:
    """Test that search works on soft-deleted notes."""
    response = await client.post(
        "/notes/",
        json={"title": "Test", "content": "search target here"},
    )
    assert response.status_code == 201
    note_id = response.json()["id"]

    # Delete the note
    await client.delete(f"/notes/{note_id}")

    # Search should still work
    response = await client.get(f"/notes/{note_id}/search", params={"q": "target"})
    assert response.status_code == 200
    assert response.json()["total_matches"] == 1


async def test_search_in_note_empty_content(client: AsyncClient) -> None:
    """Test searching in note with empty/null content."""
    response = await client.post(
        "/notes/",
        json={"title": "No Content Note"},
    )
    assert response.status_code == 201
    note_id = response.json()["id"]

    response = await client.get(f"/notes/{note_id}/search", params={"q": "anything"})
    assert response.status_code == 200
    assert response.json()["total_matches"] == 0
    assert response.json()["matches"] == []


# =============================================================================
# String Replace Tests
# =============================================================================


async def test_str_replace_note_success(client: AsyncClient) -> None:
    """Test successful string replacement in note content."""
    response = await client.post(
        "/notes/",
        json={"title": "Test Note", "content": "Hello world"},
    )
    assert response.status_code == 201
    note_id = response.json()["id"]

    response = await client.patch(
        f"/notes/{note_id}/str-replace",
        json={"old_str": "world", "new_str": "universe"},
    )
    assert response.status_code == 200

    data = response.json()
    assert data["match_type"] == "exact"
    assert data["line"] == 1
    assert data["data"]["content"] == "Hello universe"
    assert data["data"]["id"] == note_id


async def test_str_replace_note_multiline(client: AsyncClient) -> None:
    """Test string replacement with multiline content."""
    response = await client.post(
        "/notes/",
        json={"title": "Test", "content": "line 1\nline 2 target\nline 3"},
    )
    assert response.status_code == 201
    note_id = response.json()["id"]

    response = await client.patch(
        f"/notes/{note_id}/str-replace",
        json={"old_str": "target", "new_str": "replaced"},
    )
    assert response.status_code == 200

    data = response.json()
    assert data["match_type"] == "exact"
    assert data["line"] == 2
    assert data["data"]["content"] == "line 1\nline 2 replaced\nline 3"


async def test_str_replace_note_multiline_old_str(client: AsyncClient) -> None:
    """Test replacement with multiline old_str."""
    response = await client.post(
        "/notes/",
        json={"title": "Test", "content": "line 1\nline 2\nline 3\nline 4"},
    )
    assert response.status_code == 201
    note_id = response.json()["id"]

    response = await client.patch(
        f"/notes/{note_id}/str-replace",
        json={"old_str": "line 2\nline 3", "new_str": "replaced"},
    )
    assert response.status_code == 200

    data = response.json()
    assert data["data"]["content"] == "line 1\nreplaced\nline 4"
    assert data["line"] == 2


async def test_str_replace_note_no_match(client: AsyncClient) -> None:
    """Test string replacement when old_str is not found."""
    response = await client.post(
        "/notes/",
        json={"title": "Test", "content": "Hello world"},
    )
    assert response.status_code == 201
    note_id = response.json()["id"]

    response = await client.patch(
        f"/notes/{note_id}/str-replace",
        json={"old_str": "nonexistent", "new_str": "replaced"},
    )
    assert response.status_code == 400

    data = response.json()["detail"]
    assert data["error"] == "no_match"
    assert "not found" in data["message"]


async def test_str_replace_note_multiple_matches(client: AsyncClient) -> None:
    """Test string replacement when old_str matches multiple locations."""
    response = await client.post(
        "/notes/",
        json={"title": "Test", "content": "foo here\nbar baz\nfoo again"},
    )
    assert response.status_code == 201
    note_id = response.json()["id"]

    response = await client.patch(
        f"/notes/{note_id}/str-replace",
        json={"old_str": "foo", "new_str": "replaced"},
    )
    assert response.status_code == 400

    data = response.json()["detail"]
    assert data["error"] == "multiple_matches"
    assert len(data["matches"]) == 2
    assert data["matches"][0]["line"] == 1
    assert data["matches"][1]["line"] == 3
    # Check context is provided
    assert "foo here" in data["matches"][0]["context"]
    assert "foo again" in data["matches"][1]["context"]


async def test_str_replace_note_deletion(client: AsyncClient) -> None:
    """Test deletion using empty new_str."""
    response = await client.post(
        "/notes/",
        json={"title": "Test", "content": "Hello world"},
    )
    assert response.status_code == 201
    note_id = response.json()["id"]

    response = await client.patch(
        f"/notes/{note_id}/str-replace",
        json={"old_str": " world", "new_str": ""},
    )
    assert response.status_code == 200
    assert response.json()["data"]["content"] == "Hello"


async def test_str_replace_note_whitespace_normalized(client: AsyncClient) -> None:
    """Test whitespace-normalized matching."""
    # Content has trailing spaces on line 1
    response = await client.post(
        "/notes/",
        json={"title": "Test", "content": "line 1  \nline 2"},
    )
    assert response.status_code == 201
    note_id = response.json()["id"]

    # old_str without trailing spaces
    response = await client.patch(
        f"/notes/{note_id}/str-replace",
        json={"old_str": "line 1\nline 2", "new_str": "replaced"},
    )
    assert response.status_code == 200

    data = response.json()
    assert data["match_type"] == "whitespace_normalized"


async def test_str_replace_note_null_content(client: AsyncClient) -> None:
    """Test str-replace on note with null content returns content_empty error."""
    response = await client.post(
        "/notes/",
        json={"title": "No Content Note"},
    )
    assert response.status_code == 201
    note_id = response.json()["id"]

    response = await client.patch(
        f"/notes/{note_id}/str-replace",
        json={"old_str": "anything", "new_str": "replaced"},
    )
    assert response.status_code == 400

    data = response.json()["detail"]
    assert data["error"] == "content_empty"
    assert "no content" in data["message"].lower()
    assert "suggestion" in data


async def test_str_replace_note_not_found(client: AsyncClient) -> None:
    """Test str-replace on non-existent note."""
    response = await client.patch(
        "/notes/00000000-0000-0000-0000-000000000000/str-replace",
        json={"old_str": "anything", "new_str": "replaced"},
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Note not found"


async def test_str_replace_note_updates_updated_at(client: AsyncClient) -> None:
    """Test that str-replace updates the updated_at timestamp."""
    response = await client.post(
        "/notes/",
        json={"title": "Test", "content": "Hello world"},
    )
    assert response.status_code == 201
    original_updated_at = response.json()["updated_at"]
    note_id = response.json()["id"]

    await asyncio.sleep(0.01)

    response = await client.patch(
        f"/notes/{note_id}/str-replace",
        json={"old_str": "world", "new_str": "universe"},
    )
    assert response.status_code == 200
    assert response.json()["data"]["updated_at"] > original_updated_at


async def test_str_replace_note_works_on_archived(client: AsyncClient) -> None:
    """Test that str-replace works on archived notes."""
    response = await client.post(
        "/notes/",
        json={"title": "Test", "content": "Hello world"},
    )
    assert response.status_code == 201
    note_id = response.json()["id"]

    # Archive the note
    await client.post(f"/notes/{note_id}/archive")

    # str-replace should still work
    response = await client.patch(
        f"/notes/{note_id}/str-replace",
        json={"old_str": "world", "new_str": "universe"},
    )
    assert response.status_code == 200
    assert response.json()["data"]["content"] == "Hello universe"


async def test_str_replace_note_not_on_deleted(client: AsyncClient) -> None:
    """Test that str-replace does not work on soft-deleted notes."""
    response = await client.post(
        "/notes/",
        json={"title": "Test", "content": "Hello world"},
    )
    assert response.status_code == 201
    note_id = response.json()["id"]

    # Delete the note
    await client.delete(f"/notes/{note_id}")

    # str-replace should return 404
    response = await client.patch(
        f"/notes/{note_id}/str-replace",
        json={"old_str": "world", "new_str": "universe"},
    )
    assert response.status_code == 404


async def test_str_replace_note_preserves_other_fields(client: AsyncClient) -> None:
    """Test that str-replace preserves title, description, tags."""
    response = await client.post(
        "/notes/",
        json={
            "title": "My Title",
            "description": "My Description",
            "content": "Hello world",
            "tags": ["tag1", "tag2"],
        },
    )
    assert response.status_code == 201
    note_id = response.json()["id"]

    response = await client.patch(
        f"/notes/{note_id}/str-replace",
        json={"old_str": "world", "new_str": "universe"},
    )
    assert response.status_code == 200

    data = response.json()["data"]
    assert data["title"] == "My Title"
    assert data["description"] == "My Description"
    assert data["tags"] == ["tag1", "tag2"]
    assert data["content"] == "Hello universe"


# =============================================================================
# Cross-User Isolation (IDOR) Tests
# =============================================================================


async def test_user_cannot_str_replace_other_users_note(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """Test that a user cannot str-replace another user's note (returns 404)."""
    from collections.abc import AsyncGenerator

    from httpx import ASGITransport

    from api.main import app
    from core.config import Settings, get_settings
    from db.session import get_async_session
    from services.token_service import create_token
    from schemas.token import TokenCreate

    # Create a note as the dev user with content
    response = await client.post(
        "/notes/",
        json={
            "title": "Test",
            "content": "Original content that should not be modified",
        },
    )
    assert response.status_code == 201
    user1_note_id = response.json()["id"]

    # Create a second user and a PAT for them
    user2 = User(auth0_id="auth0|user2-note-str-replace-test", email="user2-note-str-replace@example.com")
    db_session.add(user2)
    await db_session.flush()

    # Add consent for user2 (required when dev_mode=False)
    await add_consent_for_user(db_session, user2)

    _, user2_token = await create_token(
        db_session, user2.id, TokenCreate(name="Test Token"),
    )
    await db_session.flush()

    get_settings.cache_clear()

    async def override_get_async_session() -> AsyncGenerator[AsyncSession]:
        yield db_session

    def override_get_settings() -> Settings:
        return Settings(database_url="postgresql://test", dev_mode=False)

    app.dependency_overrides[get_async_session] = override_get_async_session
    app.dependency_overrides[get_settings] = override_get_settings

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        headers={"Authorization": f"Bearer {user2_token}"},
    ) as user2_client:
        # Try to str-replace user1's note - should get 404
        response = await user2_client.patch(
            f"/notes/{user1_note_id}/str-replace",
            json={"old_str": "Original", "new_str": "HACKED"},
        )
        assert response.status_code == 404
        assert response.json()["detail"] == "Note not found"

    app.dependency_overrides.clear()

    # Verify the note content was not modified via database query
    result = await db_session.execute(
        select(Note).where(Note.id == user1_note_id),
    )
    note = result.scalar_one()
    assert note.content == "Original content that should not be modified"
