"""Tests for BaseEntityService._compute_changed_fields()."""
import pytest
from httpx import AsyncClient
from sqlalchemy import select

from models.content_history import ContentHistory, EntityType
from services.base_entity_service import BaseEntityService


class TestComputeChangedFields:
    """Tests for the static _compute_changed_fields method."""

    def test__compute_changed_fields__title_only(self) -> None:
        """Only title changed returns ['title']."""
        prev = {"title": "Old", "description": None, "tags": [], "relationships": []}
        curr = {"title": "New", "description": None, "tags": [], "relationships": []}
        result = BaseEntityService._compute_changed_fields(prev, curr, content_changed=False)
        assert result == ["title"]

    def test__compute_changed_fields__content_only(self) -> None:
        """Only content changed returns ['content']."""
        prev = {"title": "Title", "tags": []}
        curr = {"title": "Title", "tags": []}
        result = BaseEntityService._compute_changed_fields(prev, curr, content_changed=True)
        assert result == ["content"]

    def test__compute_changed_fields__tags_only(self) -> None:
        """Only tags changed returns ['tags']."""
        prev = {"title": "Title", "tags": [{"id": "1", "name": "old"}]}
        curr = {"title": "Title", "tags": [{"id": "2", "name": "new"}]}
        result = BaseEntityService._compute_changed_fields(prev, curr, content_changed=False)
        assert result == ["tags"]

    def test__compute_changed_fields__tags_reorder_is_not_a_change(self) -> None:
        """Tags in different order but same names are not a change."""
        prev = {"tags": [{"id": "1", "name": "b"}, {"id": "2", "name": "a"}]}
        curr = {"tags": [{"id": "2", "name": "a"}, {"id": "1", "name": "b"}]}
        result = BaseEntityService._compute_changed_fields(prev, curr, content_changed=False)
        assert result == []

    def test__compute_changed_fields__tags_id_change_ignored(self) -> None:
        """Tag ID changes are ignored; only names matter."""
        prev = {"tags": [{"id": "1", "name": "tag"}]}
        curr = {"tags": [{"id": "99", "name": "tag"}]}
        result = BaseEntityService._compute_changed_fields(prev, curr, content_changed=False)
        assert result == []

    def test__compute_changed_fields__relationships_only(self) -> None:
        """Only relationships changed returns ['relationships']."""
        prev = {
            "title": "T",
            "relationships": [{"target_type": "note", "target_id": "abc"}],
        }
        curr = {
            "title": "T",
            "relationships": [{"target_type": "bookmark", "target_id": "xyz"}],
        }
        result = BaseEntityService._compute_changed_fields(prev, curr, content_changed=False)
        assert result == ["relationships"]

    def test__compute_changed_fields__relationship_description_change(self) -> None:
        """Relationship description change is detected."""
        prev = {
            "relationships": [
                {"target_type": "note", "target_id": "abc", "relationship_type": "related", "description": None},
            ],
        }
        curr = {
            "relationships": [
                {"target_type": "note", "target_id": "abc", "relationship_type": "related", "description": "Updated"},
            ],
        }
        result = BaseEntityService._compute_changed_fields(prev, curr, content_changed=False)
        assert result == ["relationships"]

    def test__compute_changed_fields__relationship_type_change(self) -> None:
        """Relationship type change is detected."""
        prev = {
            "relationships": [
                {"target_type": "note", "target_id": "abc", "relationship_type": "related", "description": None},
            ],
        }
        curr = {
            "relationships": [
                {"target_type": "note", "target_id": "abc", "relationship_type": "references", "description": None},
            ],
        }
        result = BaseEntityService._compute_changed_fields(prev, curr, content_changed=False)
        assert result == ["relationships"]

    def test__compute_changed_fields__relationship_same_metadata_no_change(self) -> None:
        """Same relationships with same metadata are not a change."""
        rel = {"target_type": "note", "target_id": "abc", "relationship_type": "related", "description": "desc"}
        prev = {"relationships": [rel]}
        curr = {"relationships": [dict(rel)]}
        result = BaseEntityService._compute_changed_fields(prev, curr, content_changed=False)
        assert result == []

    def test__compute_changed_fields__arguments_only(self) -> None:
        """Only arguments changed returns ['arguments']."""
        prev = {"name": "p", "arguments": [{"name": "a", "required": True}]}
        curr = {"name": "p", "arguments": [{"name": "a", "required": False}]}
        result = BaseEntityService._compute_changed_fields(prev, curr, content_changed=False)
        assert result == ["arguments"]

    def test__compute_changed_fields__arguments_reorder_is_not_a_change(self) -> None:
        """Arguments in different order but same content are not a change."""
        prev = {"arguments": [{"name": "b"}, {"name": "a"}]}
        curr = {"arguments": [{"name": "a"}, {"name": "b"}]}
        result = BaseEntityService._compute_changed_fields(prev, curr, content_changed=False)
        assert result == []

    def test__compute_changed_fields__multiple_fields(self) -> None:
        """Multiple changes returns sorted list."""
        prev = {"title": "Old", "description": "Old desc", "tags": []}
        curr = {"title": "New", "description": "New desc", "tags": []}
        result = BaseEntityService._compute_changed_fields(prev, curr, content_changed=True)
        assert result == ["content", "description", "title"]

    def test__compute_changed_fields__no_changes(self) -> None:
        """No changes returns empty list."""
        meta = {"title": "Title", "tags": [], "relationships": []}
        result = BaseEntityService._compute_changed_fields(meta, meta, content_changed=False)
        assert result == []

    def test__compute_changed_fields__create_includes_non_empty_fields(self) -> None:
        """CREATE (previous_metadata=None) includes all non-empty fields."""
        curr = {
            "title": "My Title",
            "description": None,
            "tags": [{"id": "1", "name": "tag"}],
            "url": "https://example.com",
            "relationships": [],
        }
        result = BaseEntityService._compute_changed_fields(None, curr, content_changed=True)
        assert result == ["content", "tags", "title", "url"]

    def test__compute_changed_fields__create_with_no_content(self) -> None:
        """CREATE with no content does not include 'content'."""
        curr = {"title": "Title", "tags": [], "relationships": []}
        result = BaseEntityService._compute_changed_fields(None, curr, content_changed=False)
        assert result == ["title"]

    def test__compute_changed_fields__create_empty_entity(self) -> None:
        """CREATE with all empty/default values returns empty list."""
        curr = {"title": None, "description": None, "tags": [], "relationships": []}
        result = BaseEntityService._compute_changed_fields(None, curr, content_changed=False)
        assert result == []

    def test__compute_changed_fields__create_with_relationships(self) -> None:
        """CREATE with non-empty relationships includes 'relationships' in changed_fields."""
        curr = {
            "title": "Title",
            "tags": [],
            "relationships": [
                {"target_type": "note", "target_id": "abc", "relationship_type": "related", "description": None},
            ],
        }
        result = BaseEntityService._compute_changed_fields(None, curr, content_changed=True)
        assert "relationships" in result
        assert result == ["content", "relationships", "title"]

    def test__compute_changed_fields__tags_mixed_format(self) -> None:
        """Tag comparison handles both string and dict formats."""
        prev = {"tags": ["python", "web"]}
        curr = {"tags": [{"id": "1", "name": "python"}, {"id": "2", "name": "web"}]}
        result = BaseEntityService._compute_changed_fields(prev, curr, content_changed=False)
        assert result == []

    def test__compute_changed_fields__tags_mixed_format_with_change(self) -> None:
        """Tag comparison detects changes across mixed formats."""
        prev = {"tags": ["python"]}
        curr = {"tags": [{"id": "1", "name": "rust"}]}
        result = BaseEntityService._compute_changed_fields(prev, curr, content_changed=False)
        assert result == ["tags"]

    def test__compute_changed_fields__ignores_underscore_prefixed_keys(self) -> None:
        """Keys starting with underscore are ignored."""
        prev = {"title": "Old", "_internal": "x"}
        curr = {"title": "New", "_internal": "y"}
        result = BaseEntityService._compute_changed_fields(prev, curr, content_changed=False)
        assert result == ["title"]

    def test__compute_changed_fields__url_change(self) -> None:
        """URL field change is detected."""
        prev = {"url": "https://old.com", "title": "T"}
        curr = {"url": "https://new.com", "title": "T"}
        result = BaseEntityService._compute_changed_fields(prev, curr, content_changed=False)
        assert result == ["url"]

    def test__compute_changed_fields__name_change(self) -> None:
        """Name field change (for prompts) is detected."""
        prev = {"name": "old-name", "title": "T"}
        curr = {"name": "new-name", "title": "T"}
        result = BaseEntityService._compute_changed_fields(prev, curr, content_changed=False)
        assert result == ["name"]

    def test__compute_changed_fields__description_change(self) -> None:
        """Description field change is detected."""
        prev = {"description": "old"}
        curr = {"description": "new"}
        result = BaseEntityService._compute_changed_fields(prev, curr, content_changed=False)
        assert result == ["description"]


class TestComputeChangedFieldsIntegration:
    """Integration tests verifying changed_fields appears in history records."""

    @pytest.mark.asyncio
    async def test__bookmark_create__sets_changed_fields(
        self,
        db_session,
        client: AsyncClient,
    ) -> None:
        """Bookmark CREATE sets changed_fields in history record."""
        # Create a bookmark via API
        response = await client.post(
            "/bookmarks/",
            json={
                "url": "https://changedfields-create.com",
                "title": "Changed Fields Test",
                "content": "Some content",
                "tags": ["test-tag"],
            },
        )
        assert response.status_code == 201
        bookmark_id = response.json()["id"]

        # Check history record

        result = await db_session.execute(
            select(ContentHistory).where(
                ContentHistory.entity_id == bookmark_id,
                ContentHistory.entity_type == EntityType.BOOKMARK.value,
            ),
        )
        record = result.scalar_one()
        assert record.changed_fields is not None
        assert "content" in record.changed_fields
        assert "title" in record.changed_fields
        assert "url" in record.changed_fields
        assert "tags" in record.changed_fields

    @pytest.mark.asyncio
    async def test__bookmark_update_title__sets_changed_fields_title_only(
        self,
        db_session,
        client: AsyncClient,
    ) -> None:
        """Bookmark UPDATE with title change sets changed_fields to ['title']."""
        # Create bookmark
        response = await client.post(
            "/bookmarks/",
            json={
                "url": "https://changedfields-update.com",
                "title": "Original",
                "content": "Content",
            },
        )
        bookmark_id = response.json()["id"]

        # Update title only
        await client.patch(
            f"/bookmarks/{bookmark_id}",
            json={"title": "Updated Title"},
        )

        # Get the UPDATE history record

        result = await db_session.execute(
            select(ContentHistory)
            .where(
                ContentHistory.entity_id == bookmark_id,
                ContentHistory.entity_type == EntityType.BOOKMARK.value,
                ContentHistory.action == "update",
            ),
        )
        record = result.scalar_one()
        assert record.changed_fields == ["title"]

    @pytest.mark.asyncio
    async def test__bookmark_update_content_and_tags__sets_both(
        self,
        db_session,
        client: AsyncClient,
    ) -> None:
        """Bookmark UPDATE with content and tag changes sets both in changed_fields."""
        # Create bookmark
        response = await client.post(
            "/bookmarks/",
            json={
                "url": "https://changedfields-multi.com",
                "content": "Original",
                "tags": ["a"],
            },
        )
        bookmark_id = response.json()["id"]

        # Update content and tags
        await client.patch(
            f"/bookmarks/{bookmark_id}",
            json={"content": "New content", "tags": ["b"]},
        )


        result = await db_session.execute(
            select(ContentHistory)
            .where(
                ContentHistory.entity_id == bookmark_id,
                ContentHistory.entity_type == EntityType.BOOKMARK.value,
                ContentHistory.action == "update",
            ),
        )
        record = result.scalar_one()
        assert "content" in record.changed_fields
        assert "tags" in record.changed_fields

    @pytest.mark.asyncio
    async def test__note_create__sets_changed_fields(
        self,
        db_session,
        client: AsyncClient,
    ) -> None:
        """Note CREATE sets changed_fields."""
        response = await client.post(
            "/notes/",
            json={"title": "Note Title", "content": "Note content"},
        )
        assert response.status_code == 201
        note_id = response.json()["id"]


        result = await db_session.execute(
            select(ContentHistory).where(
                ContentHistory.entity_id == note_id,
                ContentHistory.entity_type == EntityType.NOTE.value,
            ),
        )
        record = result.scalar_one()
        assert "content" in record.changed_fields
        assert "title" in record.changed_fields

    @pytest.mark.asyncio
    async def test__prompt_create__sets_changed_fields(
        self,
        db_session,
        client: AsyncClient,
    ) -> None:
        """Prompt CREATE sets changed_fields."""
        response = await client.post(
            "/prompts/",
            json={
                "name": "changed-fields-test",
                "content": "Hello {{ name }}",
                "arguments": [{"name": "name"}],
            },
        )
        assert response.status_code == 201
        prompt_id = response.json()["id"]


        result = await db_session.execute(
            select(ContentHistory).where(
                ContentHistory.entity_id == prompt_id,
                ContentHistory.entity_type == EntityType.PROMPT.value,
            ),
        )
        record = result.scalar_one()
        assert "content" in record.changed_fields
        assert "name" in record.changed_fields
        assert "arguments" in record.changed_fields

    @pytest.mark.asyncio
    async def test__audit_actions__have_null_changed_fields(
        self,
        db_session,
        client: AsyncClient,
    ) -> None:
        """Audit actions (delete, archive) have null changed_fields."""
        # Create and delete a bookmark
        response = await client.post(
            "/bookmarks/",
            json={"url": "https://changedfields-audit.com", "content": "X"},
        )
        bookmark_id = response.json()["id"]

        await client.delete(f"/bookmarks/{bookmark_id}")


        result = await db_session.execute(
            select(ContentHistory)
            .where(
                ContentHistory.entity_id == bookmark_id,
                ContentHistory.entity_type == EntityType.BOOKMARK.value,
                ContentHistory.action == "delete",
            ),
        )
        record = result.scalar_one()
        assert record.changed_fields is None

    @pytest.mark.asyncio
    async def test__changed_fields_in_api_response(
        self,
        client: AsyncClient,
    ) -> None:
        """changed_fields is included in the history API response."""
        # Create a bookmark
        response = await client.post(
            "/bookmarks/",
            json={
                "url": "https://changedfields-api.com",
                "title": "API Test",
                "content": "Content",
            },
        )
        bookmark_id = response.json()["id"]

        # Get history via API
        response = await client.get(f"/history/bookmark/{bookmark_id}")
        assert response.status_code == 200
        items = response.json()["items"]
        assert len(items) == 1
        assert "changed_fields" in items[0]
        assert "content" in items[0]["changed_fields"]
        assert "title" in items[0]["changed_fields"]
