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

SETUP: this file needs only `SECURITY_TEST_API_URL` (the endpoint takes no
auth). Note `make pen_tests` runs the *whole* deployed suite, whose sibling
module additionally requires `SECURITY_TEST_USER_A_PAT`/`_B_PAT`. To run only
this file (needs only the API URL):

    SECURITY_TEST_API_URL=https://... uv run pytest backend/tests/security/deployed/test_webhook_penetration.py
"""
import json
import os
import uuid
from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest
from dotenv import load_dotenv
from svix.webhooks import Webhook

_project_root = Path(__file__).parent.parent.parent.parent.parent
load_dotenv(_project_root / ".env")

API_URL = os.environ.get("SECURITY_TEST_API_URL", "")

pytestmark = pytest.mark.skipif(
    not API_URL,
    reason="SECURITY_TEST_API_URL not set (deployed webhook pen test)",
)

# A generated, per-run, nonexistent Clerk-style user id — never a real user.
NONEXISTENT_CLERK_ID = f"user_pentest{uuid.uuid4().hex}"

# A secret we do NOT hold — used to produce a well-formed but invalid signature
# with a *current* timestamp, so verification fails at the signature comparison
# rather than being short-circuited by svix's replay-window (timestamp) check.
_ATTACKER_SECRET = "whsec_pentestNotTheRealSigningSecret00"


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


def _current_ts() -> str:
    """
    A fresh unix timestamp — passes svix's replay window so verification
    proceeds to the signature check (a stale timestamp would short-circuit
    there, leaving the signature paths untested).
    """
    return str(int(datetime.now(UTC).timestamp()))


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

    async def test__wrong_secret_signature__rejected(self) -> None:
        """
        A genuine, well-formed signature from a secret we don't hold, with a
        CURRENT timestamp — so it clears the replay window and is rejected at
        the signature comparison itself (the path that actually matters).
        """
        payload = _forged_deletion(NONEXISTENT_CLERK_ID)
        ts = datetime.now(UTC)
        signature = Webhook(_ATTACKER_SECRET).sign("msg_pentest", ts, payload)
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{API_URL}/webhooks/clerk",
                content=payload,
                headers={
                    "content-type": "application/json",
                    "svix-id": "msg_pentest",
                    "svix-timestamp": str(int(ts.timestamp())),
                    "svix-signature": signature,
                },
            )
        _assert_rejected(response)

    async def test__malformed_svix_signature_header__no_500(self) -> None:
        """
        A malformed signature header with a CURRENT timestamp must not crash
        the endpoint — this reaches the header-parsing path (a stale timestamp
        would be rejected before parsing, so its ValueError→400 would go
        untested).
        """
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{API_URL}/webhooks/clerk",
                content=_forged_deletion(NONEXISTENT_CLERK_ID),
                headers={
                    "content-type": "application/json",
                    "svix-id": "msg_pentest",
                    "svix-timestamp": _current_ts(),
                    "svix-signature": "x",
                },
            )
        _assert_rejected(response)
