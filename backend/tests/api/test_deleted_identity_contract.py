"""
Endpoint-level contract test for the terminal deleted-account 401.

The unit tests in tests/core/test_auth_clerk.py prove core.auth raises
``DeletedIdentityError``; this proves the *public HTTP contract* clients bind
to — that the app's exception handler (api/main.py) turns that exception into a
401 with the ``{detail, error_code}`` envelope AND the ``WWW-Authenticate``
header. Bound here so a future refactor of the handler (dropping the header,
nesting ``error_code`` inside ``detail``, changing the code) fails loudly.
"""
from httpx import AsyncClient


async def test__deleted_identity_returns_error_code_envelope_and_header(
    client: AsyncClient,
) -> None:
    """
    A protected route whose auth resolves to a tombstoned identity returns the
    stable ``account_deleted`` contract, produced by the real app's handler.
    """
    from api.dependencies import get_current_user  # noqa: PLC0415
    from api.main import app  # noqa: PLC0415
    from core.auth import DeletedIdentityError  # noqa: PLC0415

    async def _tombstoned_identity() -> None:
        raise DeletedIdentityError

    app.dependency_overrides[get_current_user] = _tombstoned_identity
    try:
        response = await client.get("/users/me")
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert response.status_code == 401
    assert response.json() == {
        "detail": "This account was deleted",
        "error_code": "account_deleted",
    }
    assert response.headers["www-authenticate"] == "Bearer"
