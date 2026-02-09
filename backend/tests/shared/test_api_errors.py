"""Tests for shared API error parsing."""

from typing import Any
from unittest.mock import MagicMock


from shared.api_errors import parse_http_error


_RAISE_VALUE_ERROR = object()  # Sentinel to indicate json() should raise


def _make_http_error(status_code: int, json_body: Any = _RAISE_VALUE_ERROR) -> MagicMock:
    """Create a mock HTTPStatusError for testing."""
    mock_response = MagicMock()
    mock_response.status_code = status_code
    if json_body is _RAISE_VALUE_ERROR:
        mock_response.json.side_effect = ValueError("No JSON")
    else:
        mock_response.json.return_value = json_body

    mock_error = MagicMock()
    mock_error.response = mock_response
    return mock_error


class TestParseHttpError:
    """Tests for parse_http_error function."""

    def test__parse_http_error__401_returns_auth_category(self) -> None:
        """Test 401 returns auth category."""
        error = _make_http_error(401, {"detail": "Invalid token"})
        result = parse_http_error(error)

        assert result.category == "auth"
        assert "invalid" in result.message.lower() or "expired" in result.message.lower()
        assert result.server_state is None

    def test__parse_http_error__403_returns_forbidden_category(self) -> None:
        """Test 403 returns forbidden category."""
        error = _make_http_error(403, {"detail": "Access denied"})
        result = parse_http_error(error)

        assert result.category == "forbidden"
        assert "access denied" in result.message.lower()
        assert result.server_state is None

    def test__parse_http_error__404_with_entity_info(self) -> None:
        """Test 404 with entity type and name in message."""
        error = _make_http_error(404, {"detail": "Not found"})
        result = parse_http_error(error, entity_type="prompt", entity_name="my-prompt")

        assert result.category == "not_found"
        assert "Prompt" in result.message
        assert "my-prompt" in result.message
        assert result.server_state is None

    def test__parse_http_error__404_without_entity_info(self) -> None:
        """Test 404 without entity info returns generic message."""
        error = _make_http_error(404, {"detail": "Not found"})
        result = parse_http_error(error)

        assert result.category == "not_found"
        assert result.message == "Not found"

    def test__parse_http_error__404_with_only_entity_name(self) -> None:
        """Test 404 with only entity name."""
        error = _make_http_error(404, {"detail": "Not found"})
        result = parse_http_error(error, entity_name="some-id")

        assert result.category == "not_found"
        assert "some-id" in result.message

    def test__parse_http_error__409_with_server_state_returns_conflict_modified(self) -> None:
        """Test 409 with server_state returns conflict_modified category."""
        server_state = {"id": "123", "title": "Current Title", "updated_at": "2024-01-02T00:00:00Z"}
        error = _make_http_error(409, {
            "detail": {
                "error": "conflict",
                "message": "Item was modified",
                "server_state": server_state,
            },
        })
        result = parse_http_error(error)

        assert result.category == "conflict_modified"
        assert "modified" in result.message.lower()
        assert result.server_state == server_state

    def test__parse_http_error__409_without_server_state_returns_conflict_name(self) -> None:
        """Test 409 without server_state returns conflict_name category."""
        error = _make_http_error(409, {
            "detail": {"message": "A prompt with this name already exists"},
        })
        result = parse_http_error(error)

        assert result.category == "conflict_name"
        assert "already exists" in result.message.lower()
        assert result.server_state is None

    def test__parse_http_error__409_with_string_detail(self) -> None:
        """Test 409 with string detail preserves the server-provided message."""
        error = _make_http_error(409, {"detail": "Name conflict"})
        result = parse_http_error(error)

        assert result.category == "conflict_name"
        assert result.message == "Name conflict"
        assert result.server_state is None

    def test__parse_http_error__409_with_empty_string_detail(self) -> None:
        """Test 409 with empty string detail uses default message."""
        error = _make_http_error(409, {"detail": ""})
        result = parse_http_error(error)

        assert result.category == "conflict_name"
        assert "already exists" in result.message.lower()
        assert result.server_state is None

    def test__parse_http_error__400_validation_dict_detail(self) -> None:
        """Test 400 with dict detail extracts message."""
        error = _make_http_error(400, {
            "detail": {"message": "Title is required"},
        })
        result = parse_http_error(error)

        assert result.category == "validation"
        assert "Title is required" in result.message

    def test__parse_http_error__422_fastapi_validation_list(self) -> None:
        """Test 422 with FastAPI-style list of validation errors."""
        error = _make_http_error(422, {
            "detail": [
                {"loc": ["body", "name"], "msg": "field required"},
                {"loc": ["body", "content"], "msg": "string too long"},
            ],
        })
        result = parse_http_error(error)

        assert result.category == "validation"
        assert "name" in result.message
        assert "content" in result.message

    def test__parse_http_error__400_string_detail(self) -> None:
        """Test 400 with string detail."""
        error = _make_http_error(400, {"detail": "Bad request"})
        result = parse_http_error(error)

        assert result.category == "validation"
        assert "Bad request" in result.message

    def test__parse_http_error__500_returns_internal(self) -> None:
        """Test 500 returns internal category."""
        error = _make_http_error(500, {"detail": "Internal server error"})
        result = parse_http_error(error)

        assert result.category == "internal"
        assert "500" in result.message

    def test__parse_http_error__no_json_body(self) -> None:
        """Test error with no JSON body is handled gracefully."""
        error = _make_http_error(400)  # Will raise ValueError on json()
        result = parse_http_error(error)

        assert result.category == "validation"
        assert "Validation error" in result.message

    def test__parse_http_error__list_json_body(self) -> None:
        """Test error with list JSON body (non-dict) is handled gracefully."""
        error = _make_http_error(409, ["error1", "error2"])
        result = parse_http_error(error)

        assert result.category == "conflict_name"
        assert "already exists" in result.message.lower()

    def test__parse_http_error__string_json_body(self) -> None:
        """Test error with string JSON body (non-dict) is handled gracefully."""
        error = _make_http_error(400, "Just a string")
        result = parse_http_error(error)

        assert result.category == "validation"
        assert "Validation error" in result.message
