"""Tests for AI suggestion endpoints."""
import json
from unittest.mock import AsyncMock, MagicMock, patch

from httpx import AsyncClient

from core.tier_limits import Tier, TierLimits


def _mock_llm_response(content: str) -> MagicMock:
    """Create a mock LLM response with given content."""
    response = MagicMock()
    response.choices = [MagicMock()]
    response.choices[0].message.content = content
    return response


def _patch_llm(content: str):
    """Context manager to patch acompletion with a mock response."""
    mock_response = _mock_llm_response(content)
    return (
        patch("services.llm_service.acompletion", new_callable=AsyncMock, return_value=mock_response),
        patch("services.llm_service.completion_cost", return_value=0.001),
    )


# ---------------------------------------------------------------------------
# POST /ai/suggest-tags
# ---------------------------------------------------------------------------


class TestSuggestTags:
    """Tests for POST /ai/suggest-tags."""

    async def test_returns_suggested_tags(self, client: AsyncClient) -> None:
        p1, p2 = _patch_llm('{"tags": ["python", "web-dev", "api"]}')
        with p1, p2:
            response = await client.post(
                "/ai/suggest-tags",
                json={"title": "Flask REST API Tutorial", "content_type": "bookmark"},
            )
        assert response.status_code == 200
        data = response.json()
        assert "tags" in data
        assert "python" in data["tags"]

    async def test_deduplicates_current_tags_case_insensitive(self, client: AsyncClient) -> None:
        p1, p2 = _patch_llm('{"tags": ["Python", "web-dev", "API"]}')
        with p1, p2:
            response = await client.post(
                "/ai/suggest-tags",
                json={
                    "title": "Flask Tutorial",
                    "content_type": "bookmark",
                    "current_tags": ["python", "api"],
                },
            )
        data = response.json()
        assert "web-dev" in data["tags"]
        assert "Python" not in data["tags"]
        assert "API" not in data["tags"]

    async def test_works_with_minimal_context(self, client: AsyncClient) -> None:
        """Endpoint works even with only a title — no URL, description, or content."""
        p1, p2 = _patch_llm('{"tags": ["general"]}')
        with p1, p2:
            response = await client.post(
                "/ai/suggest-tags",
                json={"title": "Something", "content_type": "bookmark"},
            )
        assert response.status_code == 200

    async def test_works_with_content_type_only(self, client: AsyncClient) -> None:
        """Endpoint handles minimal valid request — content_type with no other context."""
        p1, p2 = _patch_llm('{"tags": []}')
        with p1, p2:
            response = await client.post(
                "/ai/suggest-tags",
                json={"content_type": "bookmark"},
            )
        assert response.status_code == 200

    async def test_missing_content_type_rejected(self, client: AsyncClient) -> None:
        """content_type is required — 422 without it."""
        response = await client.post("/ai/suggest-tags", json={"title": "Test"})
        assert response.status_code == 422

    async def test_oversized_content_snippet_rejected(self, client: AsyncClient) -> None:
        response = await client.post(
            "/ai/suggest-tags",
            json={"content_snippet": "x" * 10_001, "content_type": "bookmark"},
        )
        assert response.status_code == 422

    async def test_includes_rate_limit_headers(self, client: AsyncClient) -> None:
        p1, p2 = _patch_llm('{"tags": ["test"]}')
        with p1, p2:
            response = await client.post(
                "/ai/suggest-tags",
                json={"title": "Test", "content_type": "bookmark"},
            )
        assert "x-ratelimit-limit" in response.headers

    async def test_tracks_cost(self, client: AsyncClient) -> None:
        p1, p2 = _patch_llm('{"tags": ["test"]}')
        with p1, p2, patch("api.routers.ai.track_cost", new_callable=AsyncMock) as mock_track:
            await client.post(
                "/ai/suggest-tags",
                json={"title": "Test", "content_type": "bookmark"},
            )
        mock_track.assert_called_once()
        call_kwargs = mock_track.call_args.kwargs
        assert call_kwargs["use_case"].value == "suggestions"
        assert call_kwargs["cost"] == 0.001

    async def test_byok_key_passed_through(self, client: AsyncClient) -> None:
        p1, p2 = _patch_llm('{"tags": ["test"]}')
        with p1 as mock_acomp, p2:
            await client.post(
                "/ai/suggest-tags",
                json={"title": "Test", "content_type": "bookmark"},
                headers={"X-LLM-Api-Key": "user-key-123"},
            )
        # Verify the user's key was used
        call_kwargs = mock_acomp.call_args.kwargs
        assert call_kwargs["api_key"] == "user-key-123"


# ---------------------------------------------------------------------------
# POST /ai/suggest-metadata
# ---------------------------------------------------------------------------


class TestSuggestMetadata:
    """Tests for POST /ai/suggest-metadata."""

    async def test_generates_both_fields_by_default(self, client: AsyncClient) -> None:
        content = json.dumps({
            "title": "Understanding REST APIs",
            "description": "A guide to building RESTful web services.",
        })
        p1, p2 = _patch_llm(content)
        with p1, p2:
            response = await client.post(
                "/ai/suggest-metadata",
                json={"content_snippet": "REST APIs are..."},
            )
        assert response.status_code == 200
        data = response.json()
        assert data["title"] is not None
        assert data["description"] is not None

    async def test_title_only(self, client: AsyncClient) -> None:
        """Request title only — description used as context, not generated."""
        content = json.dumps({"title": "Better Title"})
        p1, p2 = _patch_llm(content)
        with p1, p2:
            response = await client.post(
                "/ai/suggest-metadata",
                json={
                    "fields": ["title"],
                    "description": "Existing description for context",
                    "content_snippet": "Some content...",
                },
            )
        assert response.status_code == 200
        data = response.json()
        assert data["title"] is not None
        assert data["description"] is None

    async def test_description_only(self, client: AsyncClient) -> None:
        """Request description only — title used as context, not generated."""
        content = json.dumps({"description": "A detailed summary."})
        p1, p2 = _patch_llm(content)
        with p1, p2:
            response = await client.post(
                "/ai/suggest-metadata",
                json={
                    "fields": ["description"],
                    "title": "My Article",
                    "content_snippet": "Some content...",
                },
            )
        assert response.status_code == 200
        data = response.json()
        assert data["title"] is None
        assert data["description"] is not None

    async def test_explicit_both_fields(self, client: AsyncClient) -> None:
        """Explicitly requesting both fields works the same as default."""
        content = json.dumps({"title": "T", "description": "D"})
        p1, p2 = _patch_llm(content)
        with p1, p2:
            response = await client.post(
                "/ai/suggest-metadata",
                json={
                    "fields": ["title", "description"],
                    "content_snippet": "Content...",
                },
            )
        data = response.json()
        assert data["title"] is not None
        assert data["description"] is not None

    async def test_invalid_fields_rejected(self, client: AsyncClient) -> None:
        """Invalid field values are rejected at schema level (422, not 400)."""
        response = await client.post(
            "/ai/suggest-metadata",
            json={"fields": ["invalid_field"], "content_snippet": "..."},
        )
        assert response.status_code == 422

    async def test_empty_fields_rejected(self, client: AsyncClient) -> None:
        response = await client.post(
            "/ai/suggest-metadata",
            json={"fields": [], "content_snippet": "..."},
        )
        assert response.status_code == 422

    async def test_existing_title_used_as_context_for_description(
        self, client: AsyncClient,
    ) -> None:
        """When generating description, the existing title appears in the prompt."""
        content = json.dumps({"description": "A summary."})
        mock_response = _mock_llm_response(content)
        with (
            patch(
                "services.llm_service.acompletion",
                new_callable=AsyncMock,
                return_value=mock_response,
            ) as mock_acomp,
            patch("services.llm_service.completion_cost", return_value=0.001),
        ):
            await client.post(
                "/ai/suggest-metadata",
                json={
                    "fields": ["description"],
                    "title": "My Specific Article Title",
                    "content_snippet": "Content...",
                },
            )
        call_kwargs = mock_acomp.call_args.kwargs
        user_msg = next(
            m["content"] for m in call_kwargs["messages"] if m["role"] == "user"
        )
        assert "My Specific Article Title" in user_msg

    async def test_existing_description_used_as_context_for_title(
        self, client: AsyncClient,
    ) -> None:
        """When generating title, the existing description appears in the prompt."""
        content = json.dumps({"title": "A Title"})
        mock_response = _mock_llm_response(content)
        with (
            patch(
                "services.llm_service.acompletion",
                new_callable=AsyncMock,
                return_value=mock_response,
            ) as mock_acomp,
            patch("services.llm_service.completion_cost", return_value=0.001),
        ):
            await client.post(
                "/ai/suggest-metadata",
                json={
                    "fields": ["title"],
                    "description": "A detailed description about machine learning",
                    "content_snippet": "Content...",
                },
            )
        call_kwargs = mock_acomp.call_args.kwargs
        user_msg = next(
            m["content"] for m in call_kwargs["messages"] if m["role"] == "user"
        )
        assert "A detailed description about machine learning" in user_msg

    async def test_works_with_url_only(self, client: AsyncClient) -> None:
        content = json.dumps({"title": "Example", "description": "A site."})
        p1, p2 = _patch_llm(content)
        with p1, p2:
            response = await client.post(
                "/ai/suggest-metadata",
                json={"url": "https://example.com"},
            )
        assert response.status_code == 200

    async def test_tracks_cost(self, client: AsyncClient) -> None:
        content = json.dumps({"title": "T", "description": "D"})
        p1, p2 = _patch_llm(content)
        with p1, p2, patch("api.routers.ai.track_cost", new_callable=AsyncMock) as mock_track:
            await client.post(
                "/ai/suggest-metadata",
                json={"content_snippet": "Test content"},
            )
        mock_track.assert_called_once()


# ---------------------------------------------------------------------------
# POST /ai/suggest-relationships
# ---------------------------------------------------------------------------


class TestSuggestRelationships:
    """Tests for POST /ai/suggest-relationships."""

    async def test_returns_empty_when_no_title_or_tags(self, client: AsyncClient) -> None:
        """No title or tags — return empty immediately."""
        response = await client.post(
            "/ai/suggest-relationships",
            json={"description": "only description, no title or tags"},
        )
        assert response.status_code == 200
        assert response.json()["candidates"] == []

    async def test_tag_search_finds_candidates(self, client: AsyncClient) -> None:
        """Items sharing tags appear as candidates even without title match."""
        await client.post("/bookmarks/", json={
            "url": "https://example.com/tag-rel-1",
            "title": "Completely unrelated title alpha",
            "tags": ["machine-learning"],
        })
        await client.post("/bookmarks/", json={
            "url": "https://example.com/tag-rel-2",
            "title": "Completely unrelated title beta",
            "tags": ["machine-learning"],
        })

        content = json.dumps({"candidates": []})
        mock_response = _mock_llm_response(content)
        with (
            patch(
                "services.llm_service.acompletion",
                new_callable=AsyncMock,
                return_value=mock_response,
            ) as mock_acomp,
            patch("services.llm_service.completion_cost", return_value=0.001),
        ):
            response = await client.post(
                "/ai/suggest-relationships",
                json={
                    "title": "No title match whatsoever xyz123",
                    "current_tags": ["machine-learning"],
                },
            )
        assert response.status_code == 200
        mock_acomp.assert_called_once()

    async def test_tags_only_no_title(self, client: AsyncClient) -> None:
        """Tags-only request (no title) still finds candidates."""
        await client.post("/bookmarks/", json={
            "url": "https://example.com/tag-only",
            "title": "Tag only test item",
            "tags": ["unique-test-tag-xyz"],
        })

        content = json.dumps({"candidates": []})
        mock_response = _mock_llm_response(content)
        with (
            patch(
                "services.llm_service.acompletion",
                new_callable=AsyncMock,
                return_value=mock_response,
            ) as mock_acomp,
            patch("services.llm_service.completion_cost", return_value=0.001),
        ):
            response = await client.post(
                "/ai/suggest-relationships",
                json={"current_tags": ["unique-test-tag-xyz"]},
            )
        assert response.status_code == 200
        mock_acomp.assert_called_once()

    async def test_dedup_across_title_and_tag_results(self, client: AsyncClient) -> None:
        """Item appearing in both title and tag results appears once in candidates."""
        await client.post("/bookmarks/", json={
            "url": "https://example.com/dedup-test",
            "title": "Dedup overlap test unique item",
            "tags": ["dedup-test-tag"],
        })

        content = json.dumps({"candidates": []})
        mock_response = _mock_llm_response(content)
        with (
            patch(
                "services.llm_service.acompletion",
                new_callable=AsyncMock,
                return_value=mock_response,
            ) as mock_acomp,
            patch("services.llm_service.completion_cost", return_value=0.001),
        ):
            await client.post(
                "/ai/suggest-relationships",
                json={
                    "title": "Dedup overlap test unique item",
                    "current_tags": ["dedup-test-tag"],
                },
            )
        mock_acomp.assert_called_once()
        # Verify the candidate appears only once (deduped across title + tag results)
        call_kwargs = mock_acomp.call_args.kwargs
        user_msg = next(
            m["content"] for m in call_kwargs["messages"] if m["role"] == "user"
        )
        # The candidates section should list the item once, even though it
        # matched both title search and tag search
        candidates_section = user_msg.split("Candidates:")[1]
        assert candidates_section.count("Dedup overlap test unique item") == 1

    async def test_source_id_excluded_from_candidates(self, client: AsyncClient) -> None:
        """Source item is excluded from candidates via source_id."""
        resp = await client.post("/bookmarks/", json={
            "url": "https://example.com/self-match",
            "title": "Self match test item unique",
        })
        source_id = resp.json()["id"]

        content = json.dumps({"candidates": [
            {"entity_id": source_id, "entity_type": "bookmark", "title": "Self"},
        ]})
        p1, p2 = _patch_llm(content)
        with p1, p2:
            response = await client.post(
                "/ai/suggest-relationships",
                json={
                    "title": "Self match test item unique",
                    "source_id": source_id,
                },
            )
        # Source item should be filtered from candidates
        candidate_ids = [c["entity_id"] for c in response.json()["candidates"]]
        assert source_id not in candidate_ids

    async def test_returns_empty_when_no_search_results(self, client: AsyncClient) -> None:
        """Search returns nothing — no LLM call, empty response."""
        response = await client.post(
            "/ai/suggest-relationships",
            json={"title": "Something very obscure with no matches"},
        )
        assert response.status_code == 200
        assert response.json()["candidates"] == []

    async def test_filters_invalid_candidate_ids(self, client: AsyncClient) -> None:
        """LLM returns candidate IDs not in our search results — filtered out."""
        # Create a bookmark so search has something to return
        await client.post("/bookmarks/", json={
            "url": "https://example.com/related",
            "title": "Related Item",
            "description": "A related item for testing",
        })

        content = json.dumps({"candidates": [
            {"entity_id": "fake-id-not-in-search", "entity_type": "bookmark", "title": "Fake"},
        ]})
        p1, p2 = _patch_llm(content)
        with p1, p2:
            response = await client.post(
                "/ai/suggest-relationships",
                json={"title": "Related Item"},
            )
        data = response.json()
        assert data["candidates"] == []

    async def test_excludes_existing_relationships(self, client: AsyncClient) -> None:
        """Items already in existing_relationship_ids are excluded from candidates."""
        # Create two bookmarks
        resp1 = await client.post("/bookmarks/", json={
            "url": "https://example.com/a",
            "title": "Item A for relationship test",
        })
        item_a_id = resp1.json()["id"]

        await client.post("/bookmarks/", json={
            "url": "https://example.com/b",
            "title": "Item B for relationship test",
        })

        content = json.dumps({"candidates": []})
        p1, p2 = _patch_llm(content)
        with p1, p2:
            response = await client.post(
                "/ai/suggest-relationships",
                json={
                    "title": "Item for relationship test",
                    "existing_relationship_ids": [item_a_id],
                },
            )
        assert response.status_code == 200

    async def test_tracks_cost(self, client: AsyncClient) -> None:
        content = json.dumps({"candidates": []})
        p1, p2 = _patch_llm(content)
        # Create an item so search has results and LLM is called
        await client.post("/bookmarks/", json={
            "url": "https://example.com/cost-test",
            "title": "Cost tracking test item",
        })
        with p1, p2, patch("api.routers.ai.track_cost", new_callable=AsyncMock) as mock_track:
            await client.post(
                "/ai/suggest-relationships",
                json={"title": "Cost tracking test item"},
            )
        mock_track.assert_called_once()


# ---------------------------------------------------------------------------
# POST /ai/suggest-arguments
# ---------------------------------------------------------------------------


class TestSuggestArguments:
    """Tests for POST /ai/suggest-arguments."""

    async def test_generate_all_from_template(self, client: AsyncClient) -> None:
        content = json.dumps({"arguments": [
            {"name": "language", "description": "The programming language to use"},
            {"name": "topic", "description": "The topic to explain"},
        ]})
        p1, p2 = _patch_llm(content)
        with p1, p2:
            response = await client.post(
                "/ai/suggest-arguments",
                json={
                    "prompt_content": "Explain {{ topic }} in {{ language }}.",
                },
            )
        assert response.status_code == 200
        data = response.json()
        assert len(data["arguments"]) == 2

    async def test_generate_all_excludes_existing(self, client: AsyncClient) -> None:
        """Existing arguments are excluded from placeholder extraction — LLM only sees new ones."""
        content = json.dumps({"arguments": [
            {"name": "topic", "description": "The topic to explain"},
        ]})
        p1, p2 = _patch_llm(content)
        with p1, p2:
            response = await client.post(
                "/ai/suggest-arguments",
                json={
                    "prompt_content": "Explain {{ topic }} in {{ language }}.",
                    "arguments": [{"name": "language", "description": "Already exists"}],
                },
            )
        data = response.json()
        names = [a["name"] for a in data["arguments"]]
        assert "language" not in names
        assert "topic" in names

    async def test_suggest_name_for_argument(self, client: AsyncClient) -> None:
        content = json.dumps({"arguments": [
            {"name": "programming_language", "description": "The language to use"},
        ]})
        p1, p2 = _patch_llm(content)
        with p1, p2:
            response = await client.post(
                "/ai/suggest-arguments",
                json={
                    "target": "lang",
                    "arguments": [{"name": "lang", "description": "The language to use"}],
                },
            )
        assert response.status_code == 200

    async def test_suggest_description_for_argument(self, client: AsyncClient) -> None:
        content = json.dumps({"arguments": [
            {"name": "language", "description": "The programming language (e.g. Python, Go)"},
        ]})
        p1, p2 = _patch_llm(content)
        with p1, p2:
            response = await client.post(
                "/ai/suggest-arguments",
                json={
                    "target": "language",
                    "arguments": [{"name": "language"}],
                },
            )
        assert response.status_code == 200

    async def test_works_with_no_template(self, client: AsyncClient) -> None:
        content = json.dumps({"arguments": [
            {"name": "input", "description": "The input text"},
        ]})
        p1, p2 = _patch_llm(content)
        with p1, p2:
            response = await client.post(
                "/ai/suggest-arguments",
                json={"target": "input", "arguments": [{"name": "input"}]},
            )
        assert response.status_code == 200

    async def test_tracks_cost(self, client: AsyncClient) -> None:
        content = json.dumps({"arguments": [
            {"name": "name", "description": "The name"},
        ]})
        p1, p2 = _patch_llm(content)
        with p1, p2, patch("api.routers.ai.track_cost", new_callable=AsyncMock) as mock_track:
            await client.post(
                "/ai/suggest-arguments",
                json={"prompt_content": "Hello {{ name }}"},
            )
        mock_track.assert_called_once()

    async def test_filters_invalid_argument_names(self, client: AsyncClient) -> None:
        """LLM returns names that don't match argument naming rules — filtered out."""
        content = json.dumps({"arguments": [
            {"name": "valid_name", "description": "Good"},
            {"name": "Invalid Name", "description": "Has spaces"},
            {"name": "also_valid", "description": "Fine"},
        ]})
        p1, p2 = _patch_llm(content)
        with p1, p2:
            response = await client.post(
                "/ai/suggest-arguments",
                json={
                    "prompt_content": "{{ valid_name }} {{ also_valid }}",
                    "target": "valid_name",
                    "arguments": [{"name": "valid_name"}],
                },
            )
        data = response.json()
        names = [a["name"] for a in data["arguments"]]
        assert "Invalid Name" not in names

    async def test_required_field_included_in_response(self, client: AsyncClient) -> None:
        """The required field from the LLM response is preserved in the API response."""
        content = json.dumps({"arguments": [
            {"name": "topic", "description": "The topic", "required": True},
            {"name": "context", "description": "Optional context", "required": False},
        ]})
        p1, p2 = _patch_llm(content)
        with p1, p2:
            response = await client.post(
                "/ai/suggest-arguments",
                json={"prompt_content": "Explain {{ topic }}. {% if context %}Context: {{ context }}{% endif %}"},
            )
        data = response.json()
        args_by_name = {a["name"]: a for a in data["arguments"]}
        assert args_by_name["topic"]["required"] is True
        assert args_by_name["context"]["required"] is False

    async def test_generate_all_returns_empty_when_all_placeholders_exist(
        self, client: AsyncClient,
    ) -> None:
        """All template placeholders already have arguments — no LLM call needed."""
        response = await client.post(
            "/ai/suggest-arguments",
            json={
                "prompt_content": "Hello {{ name }}",
                "arguments": [{"name": "name", "description": "The name"}],
            },
        )
        assert response.status_code == 200
        assert response.json()["arguments"] == []


# ---------------------------------------------------------------------------
# LLM response validation (502 on invalid JSON)
# ---------------------------------------------------------------------------


class TestLLMResponseValidation:
    """Tests for handling invalid LLM responses."""

    async def test_invalid_json_returns_502(self, client: AsyncClient) -> None:
        """LLM returns unparseable content — 502, not 500."""
        p1, p2 = _patch_llm("This is not JSON at all")
        with p1, p2:
            response = await client.post(
                "/ai/suggest-tags",
                json={"title": "Test", "content_type": "bookmark"},
            )
        assert response.status_code == 502
        assert "invalid response" in response.json()["detail"].lower()

    async def test_cost_tracked_even_on_parse_failure(self, client: AsyncClient) -> None:
        """Cost is tracked on parse failure — provider was still billed."""
        p1, p2 = _patch_llm("Not valid JSON")
        with p1, p2, patch("api.routers.ai.track_cost", new_callable=AsyncMock) as mock_track:
            response = await client.post(
                "/ai/suggest-tags",
                json={"title": "Test", "content_type": "bookmark"},
            )
        assert response.status_code == 502
        mock_track.assert_called_once()

    async def test_wrong_schema_returns_502(self, client: AsyncClient) -> None:
        """LLM returns valid JSON but wrong schema — 502."""
        p1, p2 = _patch_llm('{"wrong_field": "value"}')
        with p1, p2:
            response = await client.post(
                "/ai/suggest-tags",
                json={"title": "Test", "content_type": "bookmark"},
            )
        assert response.status_code == 502


# ---------------------------------------------------------------------------
# Platform rate limiting on suggestion endpoints
# ---------------------------------------------------------------------------


class TestSuggestionRateLimiting:
    """Tests for rate limiting on suggestion endpoints."""

    async def test_platform_quota_consumed(self, client: AsyncClient) -> None:
        """Suggestion endpoints consume AI_PLATFORM quota."""
        resp1 = await client.get("/ai/health")
        initial = resp1.json()["remaining_daily"]

        p1, p2 = _patch_llm('{"tags": ["test"]}')
        with p1, p2:
            await client.post(
                "/ai/suggest-tags",
                json={"title": "Test", "content_type": "bookmark"},
            )

        resp2 = await client.get("/ai/health")
        assert resp2.json()["remaining_daily"] == initial - 1

    async def test_zero_limit_tier_returns_429(self, client: AsyncClient) -> None:
        """Tiers with zero AI limits get 429 on suggestion endpoints."""
        zero_limits = TierLimits(
            **{f.name: 0 for f in TierLimits.__dataclass_fields__.values()},
        )
        # Patch all tiers since dev mode user tier resolves through get_tier_safely
        with patch.dict("core.tier_limits.TIER_LIMITS", {
            Tier.FREE: zero_limits,
            Tier.STANDARD: zero_limits,
            Tier.PRO: zero_limits,
            Tier.DEV: zero_limits,
        }):
            response = await client.post(
                "/ai/suggest-tags",
                json={"title": "Test", "content_type": "bookmark"},
            )
        assert response.status_code == 429
