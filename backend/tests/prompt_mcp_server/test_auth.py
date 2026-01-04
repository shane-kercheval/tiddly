"""Tests for auth module."""

import pytest

from prompt_mcp_server.auth import (
    AuthenticationError,
    clear_current_token,
    get_bearer_token,
    set_current_token,
)


def test__set_current_token__stores_token() -> None:
    """Test that set_current_token stores the token."""
    set_current_token("test_token")
    try:
        assert get_bearer_token() == "test_token"
    finally:
        clear_current_token()


def test__get_bearer_token__raises_when_no_token() -> None:
    """Test that get_bearer_token raises when no token is set."""
    clear_current_token()  # Ensure no token
    with pytest.raises(AuthenticationError, match="No authentication token"):
        get_bearer_token()


def test__clear_current_token__removes_token() -> None:
    """Test that clear_current_token removes the token."""
    set_current_token("test_token")
    clear_current_token()
    with pytest.raises(AuthenticationError):
        get_bearer_token()


def test__token_context__isolated_per_context() -> None:
    """Test that tokens are properly scoped to context."""
    # Set token
    set_current_token("token_a")
    assert get_bearer_token() == "token_a"

    # Override with new token
    set_current_token("token_b")
    assert get_bearer_token() == "token_b"

    # Clear
    clear_current_token()
    with pytest.raises(AuthenticationError):
        get_bearer_token()
