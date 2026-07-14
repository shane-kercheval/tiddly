"""
Live penetration test for the Clerk webhook endpoint against the deployed API.

`POST /webhooks/clerk` is the app's only unauthenticated, state-changing,
internet-facing surface — an unsigned "delete this user" request must be
rejected before it reaches the handler. This is the deployed counterpart to
`backend/tests/security/test_webhooks.py` (which runs in-process); it exists to
satisfy the AGENTS.md obligation to cover new endpoints in the deployed suite.

SEQUENCING: this can only pass once M8 is deployed to the target (the endpoint
and its signing secret must exist in production). It is an M6a run item — run
`make pen_tests` against production after the cutover deploy.

SAFETY: the forged event targets a GENERATED, NONEXISTENT Clerk-style id, never
a real or persistent test user. Even in the (tested-against) impossible case
that signature verification were bypassed, there is no such user to delete.

SETUP: reuses `SECURITY_TEST_API_URL` from .env (no PAT needed — the whole
point is that this endpoint takes no auth).

RUN:
    make pen_tests
"""
import json
import os
from pathlib import Path

import httpx
import pytest
from dotenv import load_dotenv

_project_root = Path(__file__).parent.parent.parent.parent.parent
load_dotenv(_project_root / ".env")

API_URL = os.environ.get("SECURITY_TEST_API_URL", "")

pytestmark = pytest.mark.skipif(
    not API_URL,
    reason="SECURITY_TEST_API_URL not set (deployed webhook pen test)",
)

# A generated, nonexistent Clerk-style user id — never a real/persistent user.
NONEXISTENT_CLERK_ID = "user_PENTESTdoesnotexist000000"


def _forged_deletion(clerk_user_id: str) -> str:
    return json.dumps({
        "data": {"deleted": True, "id": clerk_user_id, "object": "user"},
        "object": "event",
        "type": "user.deleted",
    })


def _assert_rejected(response: httpx.Response) -> None:
    """
    Require exactly 400. Diagnose the other outcomes:
    - 200 → CRITICAL: an unsigned forgery was accepted.
    - 500 → the endpoint parsed before verifying, or otherwise crashed.
    - 503 → the production signing secret is not configured.
    - 404 → M8 is not deployed to this target yet.
    """
    assert response.status_code == 400, (
        f"expected 400 (signature rejected), got {response.status_code}. "
        "200=forgery ACCEPTED (critical); 503=signing secret unconfigured; "
        "404=M8 not deployed; 500=crash before/after verification."
    )


class TestWebhookForgeryRejectedInProduction:
    """An unsigned or mis-signed user.deleted must be rejected with 400."""

    async def test__no_svix_headers__rejected(self) -> None:
        """A bare forged deletion with no signature headers."""
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{API_URL}/webhooks/clerk",
                content=_forged_deletion(NONEXISTENT_CLERK_ID),
                headers={"content-type": "application/json"},
            )
        _assert_rejected(response)

    async def test__bogus_svix_signature__rejected(self) -> None:
        """Well-formed-looking svix headers with an attacker-chosen signature."""
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{API_URL}/webhooks/clerk",
                content=_forged_deletion(NONEXISTENT_CLERK_ID),
                headers={
                    "content-type": "application/json",
                    "svix-id": "msg_pentest",
                    "svix-timestamp": "1700000000",
                    "svix-signature": "v1,Ym9ndXNzaWduYXR1cmU=",
                },
            )
        _assert_rejected(response)

    async def test__malformed_svix_signature_header__no_500(self) -> None:
        """A malformed signature header must not crash the endpoint."""
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{API_URL}/webhooks/clerk",
                content=_forged_deletion(NONEXISTENT_CLERK_ID),
                headers={
                    "content-type": "application/json",
                    "svix-id": "msg_pentest",
                    "svix-timestamp": "1700000000",
                    "svix-signature": "x",
                },
            )
        _assert_rejected(response)
