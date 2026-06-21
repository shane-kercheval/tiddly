"""Request-level helpers shared across routers."""
from fastapi import Request


def resolve_client_ip(request: Request) -> tuple[str | None, str]:
    """
    Resolve the client IP *and* report which signal it came from.

    Same precedence and spoofability rules as :func:`get_client_ip` (see its
    docstring); this variant additionally returns the source so abuse logging can
    record whether the spoof-resistant ``X-Real-IP`` was actually present on a
    throttled request.

    Returns:
        ``(ip, source)`` where ``source`` is one of ``"x-real-ip"``,
        ``"x-forwarded-for"``, ``"socket"``, or ``"none"`` (nothing resolved).
    """
    real_ip = request.headers.get("X-Real-IP")
    if real_ip and real_ip.strip():
        return real_ip.strip(), "x-real-ip"

    forwarded_for = request.headers.get("X-Forwarded-For")
    if forwarded_for:
        first = forwarded_for.split(",")[0].strip()
        if first:
            return first, "x-forwarded-for"

    if request.client:
        return request.client.host, "socket"

    return None, "none"


def get_client_ip(request: Request) -> str | None:
    """
    Extract the client IP address from request headers.

    Prefers ``X-Real-IP``, which Railway's edge sets to the client's remote IP
    and which clients cannot set themselves (Railway docs → Public Networking →
    Specs & Limits → Request Headers documents ``X-Real-IP`` as *the* client-IP
    header; it does not list ``X-Forwarded-For``). Falls back to
    ``X-Forwarded-For`` (first entry) and then the direct connection so local dev
    and non-Railway hosts still resolve.

    Spoofability boundary: only the ``X-Real-IP`` path is spoof-resistant. The
    ``X-Forwarded-For`` fallback is client-settable, so callers using this for
    abuse mitigation get a hard guarantee only when ``X-Real-IP`` is present.
    Railway's edge is expected to always set it, but that has NOT been confirmed
    against real production traffic (forum reports suggest it can misbehave when
    Railway's CDN feature is active) — verify from an observed production request
    before treating the per-IP limit as more than coarse protection.

    Returns:
        Client IP address, or None if it cannot be determined.
    """
    return resolve_client_ip(request)[0]
