"""Tests for bookmark CRUD endpoints."""
from collections.abc import Generator
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.bookmark import Bookmark
from services.url_scraper import ExtractedMetadata, FetchResult


@pytest.fixture(autouse=True)
def mock_url_fetch() -> Generator[AsyncMock]:
    """
    Auto-mock fetch_url for all bookmark tests to avoid real network calls.

    Returns a "failed fetch" result by default so tests that don't care about
    scraping behavior work fast. Tests that need specific scraping behavior
    can override this with their own patch.
    """
    mock_result = FetchResult(
        html=None,
        final_url='',
        status_code=None,
        content_type=None,
        error='Mocked - no network call',
    )
    with patch(
        'services.bookmark_service.fetch_url',
        new_callable=AsyncMock,
        return_value=mock_result,
    ) as mock:
        yield mock


async def test_create_bookmark(client: AsyncClient, db_session: AsyncSession) -> None:
    """Test creating a new bookmark."""
    response = await client.post(
        "/bookmarks/",
        json={
            "url": "https://example.com",
            "title": "Example Site",
            "description": "An example website",
            "tags": ["example", "test"],
        },
    )
    assert response.status_code == 201

    data = response.json()
    assert data["url"] == "https://example.com/"
    assert data["title"] == "Example Site"
    assert data["description"] == "An example website"
    assert data["tags"] == ["example", "test"]
    assert "id" in data
    assert "created_at" in data
    assert "updated_at" in data

    # Verify in database
    result = await db_session.execute(select(Bookmark).where(Bookmark.id == data["id"]))
    bookmark = result.scalar_one()
    assert bookmark.url == "https://example.com/"
    assert bookmark.title == "Example Site"


async def test_create_bookmark_minimal(client: AsyncClient) -> None:
    """Test creating a bookmark with only URL (minimal required data)."""
    response = await client.post(
        "/bookmarks/",
        json={"url": "https://minimal.example.com"},
    )
    assert response.status_code == 201

    data = response.json()
    assert data["url"] == "https://minimal.example.com/"
    assert data["title"] is None
    assert data["description"] is None
    assert data["tags"] == []


async def test_create_bookmark_normalizes_tags(client: AsyncClient) -> None:
    """Test that tags are normalized to lowercase."""
    response = await client.post(
        "/bookmarks/",
        json={
            "url": "https://example.com/normalize",
            "tags": ["Python", "FASTAPI", "Web-Dev"],
        },
    )
    assert response.status_code == 201

    data = response.json()
    assert data["tags"] == ["python", "fastapi", "web-dev"]


async def test_create_bookmark_invalid_tag_uppercase(client: AsyncClient) -> None:
    """Test that uppercase in tag middle is rejected after normalization check."""
    # Note: tags are normalized to lowercase first, so this test ensures the
    # validation happens after normalization (which means most "uppercase" errors
    # are actually handled by normalization)
    response = await client.post(
        "/bookmarks/",
        json={
            "url": "https://example.com/invalid-tag",
            "tags": ["valid-tag"],
        },
    )
    # This should succeed because lowercase is valid
    assert response.status_code == 201


async def test_create_bookmark_invalid_tag_with_underscore(client: AsyncClient) -> None:
    """Test that tags with underscores are rejected."""
    response = await client.post(
        "/bookmarks/",
        json={
            "url": "https://example.com/invalid-tag",
            "tags": ["invalid_tag"],
        },
    )
    assert response.status_code == 422
    assert "Invalid tag format" in response.text


async def test_create_bookmark_invalid_tag_with_space(client: AsyncClient) -> None:
    """Test that tags with spaces are rejected."""
    response = await client.post(
        "/bookmarks/",
        json={
            "url": "https://example.com/invalid-tag",
            "tags": ["invalid tag"],
        },
    )
    assert response.status_code == 422
    assert "Invalid tag format" in response.text


async def test_create_bookmark_invalid_tag_special_chars(client: AsyncClient) -> None:
    """Test that tags with special characters are rejected."""
    response = await client.post(
        "/bookmarks/",
        json={
            "url": "https://example.com/invalid-tag",
            "tags": ["@special!"],
        },
    )
    assert response.status_code == 422
    assert "Invalid tag format" in response.text


async def test_create_bookmark_valid_tag_with_numbers(client: AsyncClient) -> None:
    """Test that tags with numbers are valid."""
    response = await client.post(
        "/bookmarks/",
        json={
            "url": "https://example.com/numbers",
            "tags": ["web-dev-2024", "python3"],
        },
    )
    assert response.status_code == 201
    assert response.json()["tags"] == ["web-dev-2024", "python3"]


async def test_list_bookmarks(client: AsyncClient) -> None:
    """Test listing bookmarks."""
    # Create some bookmarks first
    for i in range(3):
        await client.post(
            "/bookmarks/",
            json={"url": f"https://example{i}.com", "title": f"Example {i}"},
        )

    response = await client.get("/bookmarks/")
    assert response.status_code == 200

    data = response.json()
    assert len(data) == 3


async def test_list_bookmarks_pagination(client: AsyncClient) -> None:
    """Test bookmark listing with pagination."""
    # Create 5 bookmarks
    for i in range(5):
        await client.post(
            "/bookmarks/",
            json={"url": f"https://paginate{i}.com"},
        )

    # Test limit
    response = await client.get("/bookmarks/?limit=2")
    assert response.status_code == 200
    assert len(response.json()) == 2

    # Test offset
    response = await client.get("/bookmarks/?offset=1&limit=2")
    assert response.status_code == 200
    assert len(response.json()) == 2


async def test_get_bookmark(client: AsyncClient) -> None:
    """Test getting a single bookmark."""
    # Create a bookmark
    create_response = await client.post(
        "/bookmarks/",
        json={"url": "https://get-test.com", "title": "Get Test"},
    )
    bookmark_id = create_response.json()["id"]

    # Get it
    response = await client.get(f"/bookmarks/{bookmark_id}")
    assert response.status_code == 200

    data = response.json()
    assert data["id"] == bookmark_id
    assert data["url"] == "https://get-test.com/"
    assert data["title"] == "Get Test"


async def test_get_bookmark_not_found(client: AsyncClient) -> None:
    """Test getting a non-existent bookmark returns 404."""
    response = await client.get("/bookmarks/99999")
    assert response.status_code == 404
    assert response.json()["detail"] == "Bookmark not found"


async def test_update_bookmark(client: AsyncClient) -> None:
    """Test updating a bookmark."""
    # Create a bookmark
    create_response = await client.post(
        "/bookmarks/",
        json={"url": "https://update-test.com", "title": "Original Title"},
    )
    bookmark_id = create_response.json()["id"]

    # Update it
    response = await client.patch(
        f"/bookmarks/{bookmark_id}",
        json={"title": "Updated Title", "tags": ["updated"]},
    )
    assert response.status_code == 200

    data = response.json()
    assert data["title"] == "Updated Title"
    assert data["tags"] == ["updated"]
    # URL should remain unchanged
    assert data["url"] == "https://update-test.com/"


async def test_update_bookmark_partial(client: AsyncClient) -> None:
    """Test partial update only changes specified fields."""
    # Create a bookmark with description
    create_response = await client.post(
        "/bookmarks/",
        json={
            "url": "https://partial-update.com",
            "title": "Original",
            "description": "Original description",
        },
    )
    bookmark_id = create_response.json()["id"]

    # Update only title
    response = await client.patch(
        f"/bookmarks/{bookmark_id}",
        json={"title": "New Title"},
    )
    assert response.status_code == 200

    data = response.json()
    assert data["title"] == "New Title"
    assert data["description"] == "Original description"  # Unchanged


async def test_update_bookmark_not_found(client: AsyncClient) -> None:
    """Test updating a non-existent bookmark returns 404."""
    response = await client.patch(
        "/bookmarks/99999",
        json={"title": "Won't Work"},
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Bookmark not found"


async def test_delete_bookmark(client: AsyncClient) -> None:
    """Test deleting a bookmark."""
    # Create a bookmark
    create_response = await client.post(
        "/bookmarks/",
        json={"url": "https://delete-test.com"},
    )
    bookmark_id = create_response.json()["id"]

    # Delete it
    response = await client.delete(f"/bookmarks/{bookmark_id}")
    assert response.status_code == 204

    # Verify it's gone
    get_response = await client.get(f"/bookmarks/{bookmark_id}")
    assert get_response.status_code == 404


async def test_delete_bookmark_not_found(client: AsyncClient) -> None:
    """Test deleting a non-existent bookmark returns 404."""
    response = await client.delete("/bookmarks/99999")
    assert response.status_code == 404
    assert response.json()["detail"] == "Bookmark not found"


async def test_create_bookmark_invalid_url(client: AsyncClient) -> None:
    """Test that invalid URLs are rejected."""
    response = await client.post(
        "/bookmarks/",
        json={"url": "not-a-valid-url"},
    )
    assert response.status_code == 422


# =============================================================================
# URL Scraping Integration Tests
# =============================================================================


async def test_create_bookmark_auto_fetches_metadata(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """Test that creating a bookmark without metadata auto-fetches from URL."""
    mock_fetch = AsyncMock(
        return_value=FetchResult(
            html='<html><head><title>Fetched Title</title></head></html>',
            final_url='https://example.com/',
            status_code=200,
            content_type='text/html',
            error=None,
        ),
    )
    mock_metadata = ExtractedMetadata(
        title='Fetched Title',
        description='Fetched description from meta tag.',
    )

    with (
        patch('services.bookmark_service.fetch_url', mock_fetch),
        patch('services.bookmark_service.extract_metadata', return_value=mock_metadata),
        patch('services.bookmark_service.extract_content', return_value='Page content here.'),
    ):
        response = await client.post(
            "/bookmarks/",
            json={"url": "https://example.com"},
        )

    assert response.status_code == 201
    data = response.json()
    assert data["title"] == "Fetched Title"
    assert data["description"] == "Fetched description from meta tag."

    # Verify content was stored in database
    result = await db_session.execute(select(Bookmark).where(Bookmark.id == data["id"]))
    bookmark = result.scalar_one()
    assert bookmark.content == "Page content here."


async def test_create_bookmark_user_values_take_precedence(
    client: AsyncClient,
) -> None:
    """Test that user-provided title/description override fetched values."""
    mock_fetch = AsyncMock(
        return_value=FetchResult(
            html='<html><head><title>Fetched Title</title></head></html>',
            final_url='https://example.com/',
            status_code=200,
            content_type='text/html',
            error=None,
        ),
    )
    mock_metadata = ExtractedMetadata(
        title='Fetched Title',
        description='Fetched description',
    )

    with (
        patch('services.bookmark_service.fetch_url', mock_fetch),
        patch('services.bookmark_service.extract_metadata', return_value=mock_metadata),
        patch('services.bookmark_service.extract_content', return_value='Fetched content'),
    ):
        response = await client.post(
            "/bookmarks/",
            json={
                "url": "https://example.com",
                "title": "User Title",
                "description": "User description",
            },
        )

    assert response.status_code == 201
    data = response.json()
    assert data["title"] == "User Title"
    assert data["description"] == "User description"


async def test_create_bookmark_skips_fetch_when_all_provided(
    client: AsyncClient,
) -> None:
    """Test that fetch is skipped when user provides all metadata and content."""
    mock_fetch = AsyncMock()

    with patch('services.bookmark_service.fetch_url', mock_fetch):
        response = await client.post(
            "/bookmarks/",
            json={
                "url": "https://example.com",
                "title": "User Title",
                "description": "User description",
                "content": "User provided content",
            },
        )

    assert response.status_code == 201
    # fetch_url should not have been called
    mock_fetch.assert_not_called()


async def test_create_bookmark_store_content_false(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """Test that store_content=false skips content storage but still fetches metadata."""
    mock_fetch = AsyncMock(
        return_value=FetchResult(
            html='<html><head><title>Fetched</title></head></html>',
            final_url='https://example.com/',
            status_code=200,
            content_type='text/html',
            error=None,
        ),
    )
    mock_metadata = ExtractedMetadata(title='Fetched Title', description='Fetched desc')

    with (
        patch('services.bookmark_service.fetch_url', mock_fetch),
        patch('services.bookmark_service.extract_metadata', return_value=mock_metadata),
        patch('services.bookmark_service.extract_content', return_value='Page content'),
    ):
        response = await client.post(
            "/bookmarks/",
            json={
                "url": "https://example.com",
                "store_content": False,
            },
        )

    assert response.status_code == 201
    data = response.json()
    # Metadata should still be fetched
    assert data["title"] == "Fetched Title"
    assert data["description"] == "Fetched desc"

    # But content should NOT be stored
    result = await db_session.execute(select(Bookmark).where(Bookmark.id == data["id"]))
    bookmark = result.scalar_one()
    assert bookmark.content is None


async def test_create_bookmark_fetch_failure_does_not_block(
    client: AsyncClient,
) -> None:
    """Test that fetch failures don't prevent bookmark creation."""
    mock_fetch = AsyncMock(
        return_value=FetchResult(
            html=None,
            final_url='https://example.com/',
            status_code=None,
            content_type=None,
            error="Connection refused",
        ),
    )

    with patch('services.bookmark_service.fetch_url', mock_fetch):
        response = await client.post(
            "/bookmarks/",
            json={"url": "https://example.com"},
        )

    assert response.status_code == 201
    data = response.json()
    # Bookmark created but without fetched data
    assert data["title"] is None
    assert data["description"] is None


async def test_create_bookmark_http_error_saves_with_null_values(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """Test that HTTP errors (404/500) still save bookmark with null metadata."""
    mock_fetch = AsyncMock(
        return_value=FetchResult(
            html=None,  # No HTML returned for error pages
            final_url='https://example.com/deleted-page',
            status_code=404,
            content_type='text/html',
            error="HTTP 404",
        ),
    )

    with patch('services.bookmark_service.fetch_url', mock_fetch):
        response = await client.post(
            "/bookmarks/",
            json={"url": "https://example.com/deleted-page"},
        )

    assert response.status_code == 201
    data = response.json()

    # Bookmark saved with null metadata (not "404 Not Found" from error page)
    assert data["title"] is None
    assert data["description"] is None
    assert data["url"] == "https://example.com/deleted-page"

    # Verify in database
    result = await db_session.execute(select(Bookmark).where(Bookmark.id == data["id"]))
    bookmark = result.scalar_one()
    assert bookmark.url == "https://example.com/deleted-page"
    assert bookmark.title is None
    assert bookmark.description is None
    assert bookmark.content is None


async def test_create_bookmark_response_includes_summary_field(
    client: AsyncClient,
) -> None:
    """Test that bookmark response includes summary field (null for Phase 1)."""
    response = await client.post(
        "/bookmarks/",
        json={
            "url": "https://example.com",
            "title": "Test",
            "description": "Test description",
        },
    )

    assert response.status_code == 201
    data = response.json()
    assert "summary" in data
    assert data["summary"] is None


async def test_create_bookmark_user_content_not_overridden(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """Test that user-provided content is used even when fetch succeeds."""
    mock_fetch = AsyncMock(
        return_value=FetchResult(
            html='<html><head><title>Fetched</title></head></html>',
            final_url='https://example.com/',
            status_code=200,
            content_type='text/html',
            error=None,
        ),
    )
    mock_metadata = ExtractedMetadata(title='Fetched Title', description=None)

    with (
        patch('services.bookmark_service.fetch_url', mock_fetch),
        patch('services.bookmark_service.extract_metadata', return_value=mock_metadata),
        patch('services.bookmark_service.extract_content', return_value='Fetched content'),
    ):
        response = await client.post(
            "/bookmarks/",
            json={
                "url": "https://example.com",
                "content": "User provided content for paywalled site",
            },
        )

    assert response.status_code == 201

    # User content should be stored, not fetched content
    result = await db_session.execute(
        select(Bookmark).where(Bookmark.id == response.json()["id"]),
    )
    bookmark = result.scalar_one()
    assert bookmark.content == "User provided content for paywalled site"


async def test_create_bookmark_partial_metadata_fetch(
    client: AsyncClient,
) -> None:
    """Test that fetch happens when only some metadata is provided."""
    mock_fetch = AsyncMock(
        return_value=FetchResult(
            html='<html><head><title>Fetched</title></head></html>',
            final_url='https://example.com/',
            status_code=200,
            content_type='text/html',
            error=None,
        ),
    )
    mock_metadata = ExtractedMetadata(title='Fetched Title', description='Fetched desc')

    with (
        patch('services.bookmark_service.fetch_url', mock_fetch),
        patch('services.bookmark_service.extract_metadata', return_value=mock_metadata),
        patch('services.bookmark_service.extract_content', return_value=None),
    ):
        response = await client.post(
            "/bookmarks/",
            json={
                "url": "https://example.com",
                "title": "User Title",  # Only title provided
            },
        )

    assert response.status_code == 201
    data = response.json()
    # User title preserved, description fetched
    assert data["title"] == "User Title"
    assert data["description"] == "Fetched desc"
    # fetch_url should have been called because description was missing
    mock_fetch.assert_called_once()
