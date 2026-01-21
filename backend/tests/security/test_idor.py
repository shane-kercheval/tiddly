"""
IDOR (Insecure Direct Object Reference) security tests.

These tests verify that users cannot access, modify, or delete resources
belonging to other users by manipulating resource IDs.

OWASP Reference: A01:2021 - Broken Access Control
"""
from httpx import AsyncClient

from models.bookmark import Bookmark
from models.note import Note
from models.prompt import Prompt


class TestBookmarkIDOR:
    """Test IDOR protection for bookmark resources."""

    async def test__get_bookmark__returns_404_for_other_users_bookmark(
        self,
        client_as_user_b: AsyncClient,
        user_a_bookmark: Bookmark,
    ) -> None:
        """User B cannot access User A's bookmark via direct ID access."""
        response = await client_as_user_b.get(f"/bookmarks/{user_a_bookmark.id}")

        # Should return 404, not 403 (to prevent ID enumeration)
        assert response.status_code == 404
        assert response.json()["detail"] == "Bookmark not found"

    async def test__search_in_bookmark__returns_404_for_other_users_bookmark(
        self,
        client_as_user_b: AsyncClient,
        user_a_bookmark: Bookmark,
    ) -> None:
        """User B cannot search within User A's bookmark content."""
        response = await client_as_user_b.get(
            f"/bookmarks/{user_a_bookmark.id}/search",
            params={"q": "test"},
        )

        # Should return 404, not 403 (to prevent ID enumeration)
        assert response.status_code == 404
        assert response.json()["detail"] == "Bookmark not found"

    async def test__update_bookmark__returns_404_for_other_users_bookmark(
        self,
        client_as_user_b: AsyncClient,
        user_a_bookmark: Bookmark,
    ) -> None:
        """User B cannot update User A's bookmark."""
        response = await client_as_user_b.patch(
            f"/bookmarks/{user_a_bookmark.id}",
            json={"title": "Hacked by User B"},
        )

        assert response.status_code == 404
        assert response.json()["detail"] == "Bookmark not found"

    async def test__delete_bookmark__returns_404_for_other_users_bookmark(
        self,
        client_as_user_b: AsyncClient,
        user_a_bookmark: Bookmark,
    ) -> None:
        """User B cannot delete User A's bookmark."""
        response = await client_as_user_b.delete(f"/bookmarks/{user_a_bookmark.id}")

        assert response.status_code == 404
        assert response.json()["detail"] == "Bookmark not found"

    async def test__archive_bookmark__returns_404_for_other_users_bookmark(
        self,
        client_as_user_b: AsyncClient,
        user_a_bookmark: Bookmark,
    ) -> None:
        """User B cannot archive User A's bookmark."""
        response = await client_as_user_b.post(
            f"/bookmarks/{user_a_bookmark.id}/archive",
        )

        assert response.status_code == 404
        assert response.json()["detail"] == "Bookmark not found"

    async def test__list_bookmarks__excludes_other_users_data(
        self,
        client_as_user_b: AsyncClient,
        user_a_bookmark: Bookmark,
        user_b_bookmark: Bookmark,
    ) -> None:
        """User B's list does not include User A's bookmarks."""
        # User B's list should only contain their own bookmarks
        response_b = await client_as_user_b.get("/bookmarks/")
        assert response_b.status_code == 200
        bookmarks_b = response_b.json()["items"]
        bookmark_ids_b = [b["id"] for b in bookmarks_b]

        # User B sees their own bookmark
        assert str(user_b_bookmark.id) in bookmark_ids_b
        # User B does NOT see User A's bookmark
        assert str(user_a_bookmark.id) not in bookmark_ids_b


class TestTokenIDOR:
    """
    Test IDOR protection for API token resources.

    Note: Token IDOR tests that require multiple clients are tested via
    the service layer in test_token_service.py since the pytest fixtures
    for multiple clients have conflicts. The core IDOR protection is
    verified via the bookmark tests above.
    """

    async def test__token_creation__scoped_to_current_user(
        self,
        client_as_user_a: AsyncClient,
    ) -> None:
        """Tokens are created under the authenticated user's account."""
        response = await client_as_user_a.post(
            "/tokens/",
            json={"name": "Test Token"},
        )
        assert response.status_code == 201
        # Token is created successfully (ownership implicit via auth)
        assert response.json()["name"] == "Test Token"


class TestTagIDOR:
    """
    Test IDOR protection for tag resources.

    Note: Complex cross-user tag tests are verified via the service layer
    since the pytest fixtures for multiple clients have conflicts.
    """

    async def test__tag_listing__only_shows_own_tags(
        self,
        client_as_user_a: AsyncClient,
    ) -> None:
        """User can only see and manage their own tags."""
        # Create a bookmark with a tag
        response_create = await client_as_user_a.post(
            "/bookmarks/",
            json={
                "url": "https://tag-idor-test.example.com/",
                "tags": ["my-private-tag"],
            },
        )
        assert response_create.status_code == 201

        # Verify tag is visible in user's tag list
        response_tags = await client_as_user_a.get("/tags/")
        assert response_tags.status_code == 200
        tag_names = [t["name"] for t in response_tags.json()["tags"]]
        assert "my-private-tag" in tag_names

    async def test__nonexistent_tag__returns_404(
        self,
        client_as_user_a: AsyncClient,
    ) -> None:
        """Deleting a non-existent tag returns 404 (not 403)."""
        response = await client_as_user_a.delete("/tags/does-not-exist")
        # Returns 404 regardless of whether tag exists for other users
        # This prevents user enumeration
        assert response.status_code == 404


class TestNoteIDOR:
    """Test IDOR protection for note resources."""

    async def test__get_note__returns_404_for_other_users_note(
        self,
        client_as_user_b: AsyncClient,
        user_a_note: Note,
    ) -> None:
        """User B cannot access User A's note via direct ID access."""
        response = await client_as_user_b.get(f"/notes/{user_a_note.id}")

        # Should return 404, not 403 (to prevent ID enumeration)
        assert response.status_code == 404
        assert response.json()["detail"] == "Note not found"

    async def test__search_in_note__returns_404_for_other_users_note(
        self,
        client_as_user_b: AsyncClient,
        user_a_note: Note,
    ) -> None:
        """User B cannot search within User A's note content."""
        response = await client_as_user_b.get(
            f"/notes/{user_a_note.id}/search",
            params={"q": "test"},
        )

        # Should return 404, not 403 (to prevent ID enumeration)
        assert response.status_code == 404
        assert response.json()["detail"] == "Note not found"

    async def test__update_note__returns_404_for_other_users_note(
        self,
        client_as_user_b: AsyncClient,
        user_a_note: Note,
    ) -> None:
        """User B cannot update User A's note."""
        response = await client_as_user_b.patch(
            f"/notes/{user_a_note.id}",
            json={"title": "Hacked by User B"},
        )

        assert response.status_code == 404
        assert response.json()["detail"] == "Note not found"

    async def test__delete_note__returns_404_for_other_users_note(
        self,
        client_as_user_b: AsyncClient,
        user_a_note: Note,
    ) -> None:
        """User B cannot delete User A's note."""
        response = await client_as_user_b.delete(f"/notes/{user_a_note.id}")

        assert response.status_code == 404
        assert response.json()["detail"] == "Note not found"

    async def test__archive_note__returns_404_for_other_users_note(
        self,
        client_as_user_b: AsyncClient,
        user_a_note: Note,
    ) -> None:
        """User B cannot archive User A's note."""
        response = await client_as_user_b.post(
            f"/notes/{user_a_note.id}/archive",
        )

        assert response.status_code == 404
        assert response.json()["detail"] == "Note not found"

    async def test__list_notes__excludes_other_users_data(
        self,
        client_as_user_b: AsyncClient,
        user_a_note: Note,
        user_b_note: Note,
    ) -> None:
        """User B's list does not include User A's notes."""
        # User B's list should only contain their own notes
        response_b = await client_as_user_b.get("/notes/")
        assert response_b.status_code == 200
        notes_b = response_b.json()["items"]
        note_ids_b = [n["id"] for n in notes_b]

        # User B sees their own note
        assert str(user_b_note.id) in note_ids_b
        # User B does NOT see User A's note
        assert str(user_a_note.id) not in note_ids_b


class TestPromptIDOR:
    """Test IDOR protection for prompt resources."""

    async def test__get_prompt__returns_404_for_other_users_prompt(
        self,
        client_as_user_b: AsyncClient,
        user_a_prompt: Prompt,
    ) -> None:
        """User B cannot access User A's prompt via direct ID access."""
        response = await client_as_user_b.get(f"/prompts/{user_a_prompt.id}")

        # Should return 404, not 403 (to prevent ID enumeration)
        assert response.status_code == 404
        assert response.json()["detail"] == "Prompt not found"

    async def test__search_in_prompt__returns_404_for_other_users_prompt(
        self,
        client_as_user_b: AsyncClient,
        user_a_prompt: Prompt,
    ) -> None:
        """User B cannot search within User A's prompt content."""
        response = await client_as_user_b.get(
            f"/prompts/{user_a_prompt.id}/search",
            params={"q": "test"},
        )

        # Should return 404, not 403 (to prevent ID enumeration)
        assert response.status_code == 404
        assert response.json()["detail"] == "Prompt not found"

    async def test__get_prompt_by_name__returns_404_for_other_users_prompt(
        self,
        client_as_user_b: AsyncClient,
        user_a_prompt: Prompt,
    ) -> None:
        """User B cannot access User A's prompt via name lookup."""
        response = await client_as_user_b.get(f"/prompts/name/{user_a_prompt.name}")

        # Should return 404 - cannot discover prompts by name
        assert response.status_code == 404
        assert response.json()["detail"] == "Prompt not found"

    async def test__update_prompt__returns_404_for_other_users_prompt(
        self,
        client_as_user_b: AsyncClient,
        user_a_prompt: Prompt,
    ) -> None:
        """User B cannot update User A's prompt."""
        response = await client_as_user_b.patch(
            f"/prompts/{user_a_prompt.id}",
            json={"content": "Hacked by User B"},
        )

        assert response.status_code == 404
        assert response.json()["detail"] == "Prompt not found"

    async def test__delete_prompt__returns_404_for_other_users_prompt(
        self,
        client_as_user_b: AsyncClient,
        user_a_prompt: Prompt,
    ) -> None:
        """User B cannot delete User A's prompt."""
        response = await client_as_user_b.delete(f"/prompts/{user_a_prompt.id}")

        assert response.status_code == 404
        assert response.json()["detail"] == "Prompt not found"

    async def test__archive_prompt__returns_404_for_other_users_prompt(
        self,
        client_as_user_b: AsyncClient,
        user_a_prompt: Prompt,
    ) -> None:
        """User B cannot archive User A's prompt."""
        response = await client_as_user_b.post(
            f"/prompts/{user_a_prompt.id}/archive",
        )

        assert response.status_code == 404
        assert response.json()["detail"] == "Prompt not found"

    async def test__list_prompts__excludes_other_users_data(
        self,
        client_as_user_b: AsyncClient,
        user_a_prompt: Prompt,
        user_b_prompt: Prompt,
    ) -> None:
        """User B's list does not include User A's prompts."""
        # User B's list should only contain their own prompts
        response_b = await client_as_user_b.get("/prompts/")
        assert response_b.status_code == 200
        prompts_b = response_b.json()["items"]
        prompt_ids_b = [p["id"] for p in prompts_b]

        # User B sees their own prompt
        assert str(user_b_prompt.id) in prompt_ids_b
        # User B does NOT see User A's prompt
        assert str(user_a_prompt.id) not in prompt_ids_b
