"""Application configuration using pydantic-settings."""
import socket
from functools import lru_cache
from urllib.parse import urlparse

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        populate_by_name=True,
    )

    # Database
    database_url: str
    db_pool_size: int = Field(default=10, validation_alias="DB_POOL_SIZE")
    db_max_overflow: int = Field(default=10, validation_alias="DB_MAX_OVERFLOW")
    db_pool_recycle: int = Field(default=3600, validation_alias="DB_POOL_RECYCLE")

    # Auth0 - shared with frontend (VITE_ prefix for Vite exposure)
    auth0_domain: str = Field(default="", validation_alias="VITE_AUTH0_DOMAIN")
    auth0_audience: str = Field(default="", validation_alias="VITE_AUTH0_AUDIENCE")
    auth0_client_id: str = Field(default="", validation_alias="VITE_AUTH0_CLIENT_ID")

    # Development mode - bypasses auth for local development (shared with frontend)
    dev_mode: bool = Field(default=False, validation_alias="VITE_DEV_MODE")

    # URLs - used in consent enforcement error messages
    api_url: str = Field(
        default="http://localhost:8000",
        validation_alias="VITE_API_URL",
    )
    frontend_url: str = Field(
        default="http://localhost:5173",
        validation_alias="VITE_FRONTEND_URL",
    )

    # CORS - comma-separated list of allowed origins (stored as string, parsed via property)
    cors_origins_str: str = Field(
        default="http://localhost:5173",
        validation_alias="CORS_ORIGINS",
    )

    # Redis - for rate limiting and auth caching
    redis_url: str = Field(default="redis://localhost:6379", validation_alias="REDIS_URL")
    redis_enabled: bool = Field(default=True, validation_alias="REDIS_ENABLED")
    redis_pool_size: int = Field(default=5, validation_alias="REDIS_POOL_SIZE")

    # Note: Field length limits moved to core/tier_limits.py (tier-based)

    @model_validator(mode="after")
    def validate_dev_mode_security(self) -> "Settings":
        """
        Prevent DEV_MODE from being enabled with a production database.

        DEV_MODE completely bypasses authentication, so we must ensure it's only
        used with local development databases to prevent accidental production exposure.
        """
        if not self.dev_mode:
            return self

        # Parse database URL to extract hostname
        try:
            parsed = urlparse(self.database_url)
            hostname = parsed.hostname or ""
        except Exception:
            # If we can't parse the URL, block DEV_MODE (fail-safe)
            hostname = ""

        # Check if database is on localhost
        local_hosts = {"localhost", "127.0.0.1", "0.0.0.0", "::1"}
        if hostname.lower() not in local_hosts:
            raise ValueError(
                f"DEV_MODE cannot be enabled with a non-local database. "
                f"Database host '{hostname}' appears to be a production database. "
                f"DEV_MODE bypasses all authentication and must only be used locally.",
            )

        return self

    @property
    def cors_origins(self) -> list[str]:
        """
        Parse comma-separated CORS origins string into a list.

        In dev mode, automatically includes origins for all local network IPs
        so the frontend can be accessed from a VM host without manual CORS config.
        """
        origins = []
        if self.cors_origins_str:
            origins = [
                origin.strip()
                for origin in self.cors_origins_str.split(",")
                if origin.strip()
            ]

        if self.dev_mode:
            for ip in _get_local_ips():
                origin = f"http://{ip}:5173"
                if origin not in origins:
                    origins.append(origin)

        return origins

    @property
    def auth0_issuer(self) -> str:
        """Get the Auth0 issuer URL."""
        return f"https://{self.auth0_domain}/"

    @property
    def auth0_jwks_url(self) -> str:
        """Get the Auth0 JWKS URL for fetching public keys."""
        return f"https://{self.auth0_domain}/.well-known/jwks.json"


def _get_local_ips() -> list[str]:
    """
    Return non-loopback IPv4 addresses for this machine.

    Uses UDP connect trick to discover routable IPs — works reliably
    across Linux distributions regardless of /etc/hosts configuration.
    """
    ips: list[str] = []
    # Connect a UDP socket to a public IP (no traffic sent) to discover
    # which local IP the OS would route through.
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(('8.8.8.8', 80))
            addr = s.getsockname()[0]
            if not addr.startswith('127.'):
                ips.append(addr)
    except OSError:
        pass
    return ips


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
