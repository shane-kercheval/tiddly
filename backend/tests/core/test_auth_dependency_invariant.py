"""
Invariant guard: no endpoint may resolve two DISTINCT authentication callables.

The phantom-cache fix (core.auth.get_or_create_user skips caching a user it
created in the *current* request — commit d6a5761) closes the observed bug,
but its full safety relies on get_or_create_user running at most ONCE per
request transaction. FastAPI caches each dependency callable once per request,
so a single auth callable — even when reached through several dependencies
(e.g. get_current_limits depends on get_current_user) — resolves exactly once.

The hazard is a route that depends on TWO *different* auth callables: the
first resolution could JIT-create the user (correctly uncached), the second
would then see the flushed-but-uncommitted row as "existing" and cache it, and
a later rollback in that request would resurrect the phantom-cache 500 the fix
removed. That is not reachable today; this test enforces that it stays that
way, turning the unwritten "resolve auth once per request" rule into a
checked invariant.

If this ever fails: either collapse the offending route to a single auth
variant, or land the deferred post-commit cache-publication follow-up (which
removes the reliance on call-count entirely). Do not just delete the test.
"""
from fastapi.routing import APIRoute


def _auth_callables_in(dependant: object, targets: set) -> set:
    """Recursively collect the target auth callables reachable from a Dependant."""
    found = set()
    for dep in dependant.dependencies:  # type: ignore[attr-defined]
        if dep.call in targets:
            found.add(dep.call)
        found |= _auth_callables_in(dep, targets)
    return found


def test__no_route_resolves_two_distinct_auth_callables() -> None:
    """
    Every route resolves at most one distinct auth callable, so
    get_or_create_user runs at most once per request transaction.
    """
    from api.main import app  # noqa: PLC0415
    from core.auth import (  # noqa: PLC0415
        get_current_user,
        get_current_user_ai,
        get_current_user_session_only,
        get_current_user_session_only_without_consent,
        get_current_user_without_consent,
    )

    auth_callables = {
        get_current_user,
        get_current_user_ai,
        get_current_user_session_only,
        get_current_user_session_only_without_consent,
        get_current_user_without_consent,
    }

    offenders: dict[str, list[str]] = {}
    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue
        resolved = _auth_callables_in(route.dependant, auth_callables)
        if len(resolved) > 1:
            key = f"{sorted(route.methods)} {route.path}"
            offenders[key] = sorted(c.__name__ for c in resolved)

    assert not offenders, (
        "Endpoints resolving 2+ distinct auth callables — each independently "
        "runs get_or_create_user, breaking the phantom-cache invariant "
        "(see this module's docstring):\n"
        + "\n".join(f"  {route}: {names}" for route, names in offenders.items())
    )
