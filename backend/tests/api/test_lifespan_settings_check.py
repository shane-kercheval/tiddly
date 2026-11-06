"""
The API's startup check for settings only the api service needs.

These run the real ``lifespan`` (test clients built on ``ASGITransport`` never
do), with ``get_settings`` patched and Redis disabled so startup touches
nothing outside the process.
"""
from unittest.mock import patch

import pytest

from core.config import Settings
from core.redis import RedisClient


@pytest.fixture(autouse=True)
def _database_url_env(database_url: str) -> str:
    """Importing api.main builds the engine, which needs DATABASE_URL set."""
    return database_url


def _settings(*, dev_mode: bool, cli_client_id: str) -> Settings:
    return Settings(
        database_url="postgresql://localhost/test",
        dev_mode=dev_mode,
        clerk_frontend_api="test-instance.clerk.accounts.dev",
        clerk_authorized_parties_str="http://localhost:5173",
        clerk_cli_oauth_client_id=cli_client_id,
        redis_enabled=False,
    )


@pytest.mark.parametrize("cli_client_id", ["", " \n"], ids=["empty", "whitespace_only"])
async def test__real_auth_without_cli_client_id__refuses_to_boot(cli_client_id: str) -> None:
    """
    With dev mode off and no CLERK_CLI_OAUTH_CLIENT_ID (unset, or only
    whitespace), startup raises a message naming the variable, before any
    startup work runs.
    """
    from api.main import app, lifespan  # noqa: PLC0415

    settings = _settings(dev_mode=False, cli_client_id=cli_client_id)
    with (
        patch("api.main.get_settings", return_value=settings),
        patch("api.main.RedisClient", wraps=RedisClient) as redis_client_cls,
        pytest.raises(RuntimeError, match="CLERK_CLI_OAUTH_CLIENT_ID"),
    ):
        async with lifespan(app):
            pass

    redis_client_cls.assert_not_called()


async def test__real_auth_with_cli_client_id__boots() -> None:
    """With dev mode off and the variable set, startup completes."""
    from api.main import app, lifespan  # noqa: PLC0415

    settings = _settings(dev_mode=False, cli_client_id="zTESTcliclient456")
    with patch("api.main.get_settings", return_value=settings):
        async with lifespan(app):
            pass


async def test__dev_mode_without_cli_client_id__boots() -> None:
    """Dev mode needs no CLI client ID: authentication is bypassed."""
    from api.main import app, lifespan  # noqa: PLC0415

    settings = _settings(dev_mode=True, cli_client_id="")
    with patch("api.main.get_settings", return_value=settings):
        async with lifespan(app):
            pass
