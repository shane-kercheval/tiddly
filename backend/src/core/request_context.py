"""Request context types for tracking source and auth information."""
from dataclasses import dataclass
from enum import StrEnum


class AuthType(StrEnum):
    """
    Authentication method used for the request.

    SESSION covers IdP-issued JWTs (mechanism-descriptive, provider-neutral —
    today that means Clerk session and OAuth tokens; during the Auth0 → Clerk
    dual-accept window it spanned both issuers). Historical content_history
    rows persisted the pre-rename value "auth0"; those are audit facts and are
    never backfilled.
    """

    SESSION = "session"
    PAT = "pat"
    DEV = "dev"


class OAuthClientKind(StrEnum):
    """
    Which kind of app a verified Clerk OAuth access token was issued to.

    CLI is the pre-registered "Tiddly CLI" app (`client_id` equals
    `Settings.clerk_cli_oauth_client_id`); CONNECTOR is every other app a user
    approved, such as Claude or ChatGPT.
    """

    CLI = "cli"
    CONNECTOR = "connector"


@dataclass
class RequestContext:
    """
    Context information for tracking the source and auth type of a request.

    Used for audit trails in history recording.
    """

    source: str
    auth_type: AuthType
    token_prefix: str | None = None  # Only set for PAT auth, e.g. "bm_a3f8..."
    # Only set for Clerk OAuth access tokens; None for session tokens, PATs, and dev mode.
    oauth_client_id: str | None = None
    oauth_client_kind: OAuthClientKind | None = None
