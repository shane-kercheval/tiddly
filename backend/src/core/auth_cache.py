"""Authentication caching for reduced database load."""
import json
import logging
from typing import TYPE_CHECKING
from uuid import UUID

from schemas.cached_user import CachedUser

if TYPE_CHECKING:
    from core.redis import RedisClient
    from models.user import User

logger = logging.getLogger(__name__)

# Cache schema version - included in all cache keys (e.g., "auth:v1:user:...")
#
# Bump this version when CachedUser fields change or when a deployment
# requires immediate cache invalidation (e.g., tier migrations).
# This ensures old cached entries (with the previous version) are ignored:
# - New code looks for "auth:v2:..." keys
# - Old "auth:v1:..." keys are never found (cache miss)
# - Old entries expire naturally via TTL (5 minutes)
#
# This avoids the need for cache invalidation during deployments.
# Version history:
#   v1: Initial version with id: int
#   v2: Changed id from int to UUID (UUIDv7 migration)
#   v3: Added tier field for tier-based limits
#   v4: Added email_verified field
#   v5: All users migrated to Pro for beta
#   v6: Added external_auth_id; auth0_id became optional (Clerk dual-accept)
CACHE_SCHEMA_VERSION = 6


class AuthCache:
    """
    Cache for authenticated user lookups.

    A user entry is cached under every identifier that can authenticate it:
    - `id:{user_id}` — PAT flow lookups
    - `ext:{external_auth_id}` — Clerk JWT lookups (token `sub`)
    - `auth0:{auth0_id}` — Auth0 JWT lookups. Transitional: this segment (and
      everything else auth0-shaped here) is removed in M6b when the Auth0
      verification path is decommissioned.

    Invalidation must cover every segment the user may be cached under —
    see invalidate().
    """

    CACHE_TTL = 300  # 5 minutes

    def __init__(self, redis_client: "RedisClient") -> None:
        """Initialize auth cache with Redis client."""
        self._redis = redis_client

    def _cache_key_auth0(self, auth0_id: str) -> str:
        """Generate cache key for Auth0 ID lookup (transitional; removed in M6b)."""
        return f"auth:v{CACHE_SCHEMA_VERSION}:user:auth0:{auth0_id}"

    def _cache_key_external(self, external_auth_id: str) -> str:
        """Generate cache key for external auth ID (Clerk `sub`) lookup."""
        return f"auth:v{CACHE_SCHEMA_VERSION}:user:ext:{external_auth_id}"

    def _cache_key_user_id(self, user_id: UUID) -> str:
        """Generate cache key for user ID lookup."""
        return f"auth:v{CACHE_SCHEMA_VERSION}:user:id:{user_id}"

    async def get_by_auth0_id(self, auth0_id: str) -> CachedUser | None:
        """
        Get cached user by Auth0 ID.

        Args:
            auth0_id: The Auth0 sub claim (e.g., 'auth0|123456').

        Returns:
            CachedUser if found in cache, None on cache miss.
        """
        key = self._cache_key_auth0(auth0_id)
        data = await self._redis.get(key)
        if data:
            logger.debug("auth_cache_hit auth0_id=%s", auth0_id)
            return self._deserialize(data)
        logger.debug("auth_cache_miss auth0_id=%s", auth0_id)
        return None

    async def get_by_external_auth_id(self, external_auth_id: str) -> CachedUser | None:
        """
        Get cached user by external auth ID.

        Args:
            external_auth_id: The verified token's sub claim (the Clerk user ID).

        Returns:
            CachedUser if found in cache, None on cache miss.
        """
        key = self._cache_key_external(external_auth_id)
        data = await self._redis.get(key)
        if data:
            logger.debug("auth_cache_hit external_auth_id=%s", external_auth_id)
            return self._deserialize(data)
        logger.debug("auth_cache_miss external_auth_id=%s", external_auth_id)
        return None

    async def get_by_user_id(self, user_id: UUID) -> CachedUser | None:
        """
        Get cached user by user ID (for PAT lookups).

        Args:
            user_id: The database user ID (UUID).

        Returns:
            CachedUser if found in cache, None on cache miss.
        """
        key = self._cache_key_user_id(user_id)
        data = await self._redis.get(key)
        if data:
            logger.debug("auth_cache_hit user_id=%s", user_id)
            return self._deserialize(data)
        logger.debug("auth_cache_miss user_id=%s", user_id)
        return None

    async def set(self, user: "User") -> None:
        """
        Cache user data from ORM User object.

        Caches by user_id always, and by each provider identifier the row
        carries — so any auth path (PAT, Auth0 JWT, Clerk JWT) hits the same
        entry.

        Args:
            user: The User ORM object to cache.
        """
        cached = CachedUser(
            id=user.id,
            auth0_id=user.auth0_id,
            external_auth_id=user.external_auth_id,
            email=user.email,
            email_verified=user.email_verified,
            consent_privacy_version=(
                user.consent.privacy_policy_version if user.consent else None
            ),
            consent_tos_version=(
                user.consent.terms_of_service_version if user.consent else None
            ),
            tier=user.tier,
        )
        # Convert UUID to string for JSON serialization
        cache_dict = cached.__dict__.copy()
        cache_dict["id"] = str(cached.id)
        data = json.dumps(cache_dict)

        # Cache by user ID (for PAT lookups after token validation)
        await self._redis.setex(
            self._cache_key_user_id(user.id),
            self.CACHE_TTL,
            data,
        )

        if user.auth0_id:
            await self._redis.setex(
                self._cache_key_auth0(user.auth0_id),
                self.CACHE_TTL,
                data,
            )

        if user.external_auth_id:
            await self._redis.setex(
                self._cache_key_external(user.external_auth_id),
                self.CACHE_TTL,
                data,
            )

        logger.debug(
            "auth_cache_set user_id=%s auth0_id=%s external_auth_id=%s",
            user.id,
            user.auth0_id,
            user.external_auth_id,
        )

    async def invalidate(
        self,
        user_id: UUID,
        auth0_id: str | None = None,
        external_auth_id: str | None = None,
    ) -> None:
        """
        Invalidate cached user data.

        Should be called when user data changes (e.g., consent update).

        Callers MUST pass every provider identifier the user carries — a
        segment left out keeps serving stale data for up to the TTL (the
        consent flow passes both; see api/routers/consent.py).

        Args:
            user_id: The database user ID.
            auth0_id: Auth0 ID to also invalidate, if the user has one.
            external_auth_id: External auth ID to also invalidate, if the user has one.
        """
        keys = [self._cache_key_user_id(user_id)]
        if auth0_id:
            keys.append(self._cache_key_auth0(auth0_id))
        if external_auth_id:
            keys.append(self._cache_key_external(external_auth_id))
        await self._redis.delete(*keys)
        logger.debug(
            "auth_cache_invalidate user_id=%s auth0_id=%s external_auth_id=%s",
            user_id,
            auth0_id,
            external_auth_id,
        )

    def _deserialize(self, data: bytes) -> CachedUser:
        """Deserialize cached data to CachedUser."""
        d = json.loads(data)
        # Convert id back to UUID
        d["id"] = UUID(d["id"])
        return CachedUser(**d)


# Global auth cache instance (set during app startup)
_auth_cache: AuthCache | None = None


def get_auth_cache() -> AuthCache | None:
    """Get the global auth cache instance."""
    return _auth_cache


def set_auth_cache(cache: AuthCache | None) -> None:
    """Set the global auth cache instance."""
    global _auth_cache  # noqa: PLW0603
    _auth_cache = cache
