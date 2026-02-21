"""Tests for auth module."""

import asyncio

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


@pytest.mark.asyncio
async def test__token_context__isolated_between_concurrent_tasks() -> None:
    """
    Test that tokens are properly isolated between concurrent async tasks.

    This verifies that contextvars provides proper task-level isolation,
    preventing token leakage between concurrent requests.
    """
    results: dict[str, str | None] = {}
    errors: dict[str, str] = {}

    async def task_with_token(task_id: str, token: str) -> None:
        """Simulate a request task that sets and reads its token."""
        set_current_token(token)
        # Yield to allow other tasks to run
        await asyncio.sleep(0.01)
        try:
            # Should still see its own token, not another task's
            results[task_id] = get_bearer_token()
        except AuthenticationError as e:
            errors[task_id] = str(e)
        finally:
            clear_current_token()

    # Run multiple concurrent tasks with different tokens
    await asyncio.gather(
        task_with_token("task_a", "token_for_a"),
        task_with_token("task_b", "token_for_b"),
        task_with_token("task_c", "token_for_c"),
    )

    # Each task should have seen its own token
    assert results.get("task_a") == "token_for_a", "Task A token leaked"
    assert results.get("task_b") == "token_for_b", "Task B token leaked"
    assert results.get("task_c") == "token_for_c", "Task C token leaked"
    assert not errors, f"Unexpected errors: {errors}"
