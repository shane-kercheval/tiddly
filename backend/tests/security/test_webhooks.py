"""
Security tests for the Clerk webhook endpoint (POST /webhooks/clerk).

This is the first inbound provider-calls-us surface: an endpoint that deletes
users on request. The property under test is that signature verification is
unbypassable — no request that wasn't signed with the instance's Svix secret
can reach the deletion path, and malformed input never produces a 500 (which
could leak stack detail or mask a bypass).

OWASP References:
- A01:2021 - Broken Access Control
- A08:2021 - Software and Data Integrity Failures (webhook forgery)
"""
import json
from collections.abc import AsyncGenerator
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from svix.webhooks import Webhook

from core.config import get_settings
from models.user import User

TEST_WEBHOOK_SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw"


@pytest.fixture
async def webhook_client(client: AsyncClient) -> AsyncGenerator[AsyncClient]:
    """The standard test client with the webhook signing secret configured."""
    from api.main import app  # noqa: PLC0415

    settings_with_secret = get_settings().model_copy(
        update={"clerk_webhook_signing_secret": TEST_WEBHOOK_SECRET},
    )
    app.dependency_overrides[get_settings] = lambda: settings_with_secret
    yield client
    app.dependency_overrides.pop(get_settings, None)


@pytest.fixture
async def target_user(db_session: AsyncSession) -> User:
    """A user an attacker would try to delete."""
    user = User(external_auth_id="user_attack_target", email="target@test.com")
    db_session.add(user)
    await db_session.flush()
    return user


def forged_deletion(clerk_user_id: str) -> str:
    return json.dumps({
        "data": {"deleted": True, "id": clerk_user_id, "object": "user"},
        "object": "event",
        "type": "user.deleted",
    })


def _signed(payload: str, msg_id: str = "msg_signed_test") -> dict[str, str]:
    """Genuine svix headers for a payload, signed with the endpoint's secret."""
    timestamp = datetime.now(UTC)
    signature = Webhook(TEST_WEBHOOK_SECRET).sign(msg_id, timestamp, payload)
    return {
        "svix-id": msg_id,
        "svix-timestamp": str(int(timestamp.timestamp())),
        "svix-signature": signature,
        "content-type": "application/json",
    }


async def _user_exists(db: AsyncSession, external_auth_id: str) -> bool:
    result = await db.execute(
        select(User).where(User.external_auth_id == external_auth_id),
    )
    return result.scalar_one_or_none() is not None


class TestWebhookForgeryPrevention:
    """Unsigned or mis-signed deletion requests must never delete anything."""

    async def test__unsigned_forged_deletion__rejected(
        self,
        webhook_client: AsyncClient,
        db_session: AsyncSession,
        target_user: User,
    ) -> None:
        """The trivial forgery: a valid-looking payload with no signature."""
        response = await webhook_client.post(
            "/webhooks/clerk",
            content=forged_deletion(target_user.external_auth_id),
            headers={"content-type": "application/json"},
        )
        assert response.status_code == 400
        assert await _user_exists(db_session, "user_attack_target")

    async def test__attacker_signed_with_own_secret__rejected(
        self,
        webhook_client: AsyncClient,
        db_session: AsyncSession,
        target_user: User,
    ) -> None:
        """A structurally-valid Svix signature from a secret we don't hold."""
        payload = forged_deletion(target_user.external_auth_id)
        timestamp = datetime.now(UTC)
        attacker_sig = Webhook("whsec_attackerattackerattackerXX").sign(
            "msg_forged", timestamp, payload,
        )
        response = await webhook_client.post(
            "/webhooks/clerk",
            content=payload,
            headers={
                "svix-id": "msg_forged",
                "svix-timestamp": str(int(timestamp.timestamp())),
                "svix-signature": attacker_sig,
                "content-type": "application/json",
            },
        )
        assert response.status_code == 400
        assert await _user_exists(db_session, "user_attack_target")

    async def test__stale_timestamp_replay__rejected(
        self,
        webhook_client: AsyncClient,
        db_session: AsyncSession,
        target_user: User,
    ) -> None:
        """
        A correctly-signed message with an hours-old timestamp is rejected
        (svix enforces a replay-window tolerance on svix-timestamp).
        """
        payload = forged_deletion(target_user.external_auth_id)
        stale = datetime.fromtimestamp(
            datetime.now(UTC).timestamp() - 3600,
            tz=UTC,
        )
        signature = Webhook(TEST_WEBHOOK_SECRET).sign("msg_stale", stale, payload)
        response = await webhook_client.post(
            "/webhooks/clerk",
            content=payload,
            headers={
                "svix-id": "msg_stale",
                "svix-timestamp": str(int(stale.timestamp())),
                "svix-signature": signature,
                "content-type": "application/json",
            },
        )
        assert response.status_code == 400
        assert await _user_exists(db_session, "user_attack_target")

    @pytest.mark.parametrize("garbage", [
        b"",
        b"not json at all",
        b'{"unterminated": ',
        b"\x00\x01\x02\xff",
        b'{"type": "user.deleted"}' + b"A" * 100_000,
    ])
    async def test__garbage_bodies__clean_4xx_never_500(
        self,
        webhook_client: AsyncClient,
        garbage: bytes,
    ) -> None:
        """Malformed input fails verification cleanly — no parse-first 500s."""
        response = await webhook_client.post(
            "/webhooks/clerk",
            content=garbage,
            headers={"content-type": "application/json"},
        )
        assert response.status_code == 400

    async def test__unconfigured_secret__fails_closed(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        target_user: User,
    ) -> None:
        """
        No signing secret configured (misdeployment) must not degrade to
        accepting unverified events — the endpoint refuses with 503.
        """
        payload = forged_deletion(target_user.external_auth_id)
        timestamp = datetime.now(UTC)
        signature = Webhook(TEST_WEBHOOK_SECRET).sign("msg_x", timestamp, payload)
        response = await client.post(
            "/webhooks/clerk",
            content=payload,
            headers={
                "svix-id": "msg_x",
                "svix-timestamp": str(int(timestamp.timestamp())),
                "svix-signature": signature,
                "content-type": "application/json",
            },
        )
        assert response.status_code == 503
        assert await _user_exists(db_session, "user_attack_target")


class TestSignedMalformedPayloads:
    """
    Validly-SIGNED malformed bodies must be classified 400s, never 500s —
    svix parses JSON after the signature check, so these bypass the
    verification-error path. Only the trusted sender can produce these
    (a 400 does not stop Svix retries; it makes the failure legible).
    """

    async def test__signed_invalid_json__400(
        self,
        webhook_client: AsyncClient,
    ) -> None:
        payload = '{"unterminated": '
        response = await webhook_client.post(
            "/webhooks/clerk",
            content=payload,
            headers=_signed(payload),
        )
        assert response.status_code == 400

    async def test__signed_json_array__400(
        self,
        webhook_client: AsyncClient,
    ) -> None:
        payload = '["not", "an", "event"]'
        response = await webhook_client.post(
            "/webhooks/clerk",
            content=payload,
            headers=_signed(payload),
        )
        assert response.status_code == 400

    async def test__signed_deletion_with_non_object_data__400(
        self,
        webhook_client: AsyncClient,
    ) -> None:
        payload = json.dumps({"type": "user.deleted", "data": ["user_x"]})
        response = await webhook_client.post(
            "/webhooks/clerk",
            content=payload,
            headers=_signed(payload),
        )
        assert response.status_code == 400

    async def test__signed_unknown_event_with_weird_shape__still_200_noop(
        self,
        webhook_client: AsyncClient,
    ) -> None:
        """Unknown event types stay harmless no-ops regardless of data shape."""
        payload = json.dumps({"type": "organization.created", "data": "opaque"})
        response = await webhook_client.post(
            "/webhooks/clerk",
            content=payload,
            headers=_signed(payload),
        )
        assert response.status_code == 200
        assert response.json()["handled"] is False


class TestBodySizeLimit:
    """The unauthenticated body read is bounded — oversized requests → 413."""

    async def test__oversized_declared_content_length__413(
        self,
        webhook_client: AsyncClient,
    ) -> None:
        """The cheap early reject on the declared length."""
        response = await webhook_client.post(
            "/webhooks/clerk",
            content=b"x" * (300 * 1024),
            headers={"content-type": "application/json"},
        )
        assert response.status_code == 413

    async def test__oversized_chunked_body_without_content_length__413(
        self,
        webhook_client: AsyncClient,
    ) -> None:
        """A chunked request can't bypass the cap — actual bytes are counted."""
        async def chunks() -> "AsyncGenerator[bytes]":
            for _ in range(30):
                yield b"y" * (10 * 1024)

        response = await webhook_client.post(
            "/webhooks/clerk",
            content=chunks(),
            headers={"content-type": "application/json"},
        )
        assert response.status_code == 413

    async def test__valid_signed_event_under_limit__unaffected(
        self,
        webhook_client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        """The cap doesn't interfere with real deliveries."""
        user = User(external_auth_id="user_size_ok", email="ok@test.com")
        db_session.add(user)
        await db_session.flush()
        payload = forged_deletion("user_size_ok")
        response = await webhook_client.post(
            "/webhooks/clerk",
            content=payload,
            headers=_signed(payload),
        )
        assert response.status_code == 200
        assert not await _user_exists(db_session, "user_size_ok")


class TestMalformedSignatureHeaders:
    """
    Attacker-reachable parser edges: the svix library tuple-unpacks the
    svix-signature header and base64-decodes its parts BEFORE any signature
    match, so malformed headers raise bare ValueError — these must be clean
    400s, not unauthenticated 500 generators.
    """

    @pytest.mark.parametrize("bad_signature", [
        "x",                      # no comma — tuple-unpack ValueError
        "v1,x,y",                 # too many parts
        "v1,%%%not-base64%%%",    # binascii.Error (ValueError subclass)
        "v1,",                    # empty signature part
        ",",                      # empty version and signature
    ])
    async def test__malformed_signature_header__400(
        self,
        webhook_client: AsyncClient,
        db_session: AsyncSession,
        target_user: User,
        bad_signature: str,
    ) -> None:
        payload = forged_deletion(target_user.external_auth_id)
        timestamp = datetime.now(UTC)
        response = await webhook_client.post(
            "/webhooks/clerk",
            content=payload,
            headers={
                "svix-id": "msg_bad_header",
                "svix-timestamp": str(int(timestamp.timestamp())),
                "svix-signature": bad_signature,
                "content-type": "application/json",
            },
        )
        assert response.status_code == 400
        assert await _user_exists(db_session, "user_attack_target")

    @pytest.mark.parametrize("bad_id", [
        1,                # signed numeric id -> would hit SQL binding
        ["user_x"],       # signed list id
        {"id": "x"},      # signed object id
        "",               # empty string
        "u" * 300,        # exceeds the 255-char column limit -> insert error
    ])
    async def test__signed_deletion_with_unusable_id__400(
        self,
        webhook_client: AsyncClient,
        bad_id: object,
    ) -> None:
        """A signed user.deleted whose id can't reach SQL safely is a 400."""
        payload = json.dumps({
            "data": {"deleted": True, "id": bad_id, "object": "user"},
            "object": "event",
            "type": "user.deleted",
        })
        response = await webhook_client.post(
            "/webhooks/clerk",
            content=payload,
            headers=_signed(payload),
        )
        assert response.status_code == 400
