"""
Invariant guard: no endpoint may execute authentication more than once per
request. This checks the *current* dependency graph — it is a tripwire that
fails when a future change would break the invariant, not a permanent proof.

The phantom-cache fix (core.auth.get_or_create_user skips caching a user it
created in the *current* request — commit d6a5761) relies on get_or_create_user
running at most once per request transaction. Authentication runs once per
distinct FastAPI dependency-cache key, plus once for every dependency marked
`use_cache=False`. So the true invariant, per route, is:

  every auth dependency node has use_cache=True  AND  they all share one
  cache_key (== `(call, security_scopes)`).

Checking "distinct callables" alone is insufficient: the same callable under
`use_cache=False`, or under two different security scopes (different
cache_keys), executes twice while still being one callable. The negative-
validation tests below exercise all three bypass shapes.

If this fails: collapse the route to a single cached auth dependency, or land
the deferred post-commit cache-publication follow-up (which removes the
reliance on execution count). Do not weaken the test.
"""
from collections.abc import Callable

from fastapi import Depends, FastAPI, Security
from fastapi.routing import APIRoute


def _auth_nodes(dependant: object, targets: set[Callable]) -> list:
    """Collect the auth-matching Dependant nodes reachable from a route."""
    nodes = []
    for dep in dependant.dependencies:  # type: ignore[attr-defined]
        if dep.call in targets:
            nodes.append(dep)
        nodes.extend(_auth_nodes(dep, targets))
    return nodes


def _offending_routes(app: FastAPI, targets: set[Callable]) -> dict[str, str]:
    """
    Return routes whose auth dependencies could execute more than once:
    any auth node with use_cache=False, or two auth nodes with different
    cache keys (distinct callables, or same callable under different scopes).
    """
    offenders: dict[str, str] = {}
    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue
        nodes = _auth_nodes(route.dependant, targets)
        if not nodes:
            continue
        uncached = [n for n in nodes if not n.use_cache]
        distinct_keys = {n.cache_key for n in nodes}
        if uncached or len(distinct_keys) > 1:
            key = f"{sorted(route.methods)} {route.path}"
            offenders[key] = (
                f"use_cache=False on {len(uncached)} auth node(s); "
                f"{len(distinct_keys)} distinct cache key(s)"
            )
    return offenders


def _checked_paths(app: FastAPI, targets: set[Callable]) -> set[str]:
    """Paths of routes that actually resolved at least one auth node."""
    return {
        route.path
        for route in app.routes
        if isinstance(route, APIRoute) and _auth_nodes(route.dependant, targets)
    }


def test__auth_dependencies_tuple_is_complete() -> None:
    """
    AUTH_DEPENDENCIES lists every `get_current_user*` callable in core.auth.

    So a new auth variant following the naming convention can't be added
    without also entering the guard's coverage. (A differently-named auth
    dependency still needs manual registration — the tuple comment says so.)
    """
    import core.auth as auth_mod  # noqa: PLC0415
    from core.auth import AUTH_DEPENDENCIES  # noqa: PLC0415

    discovered = {
        obj
        for name, obj in vars(auth_mod).items()
        if name.startswith("get_current_user") and callable(obj)
    }
    assert discovered == set(AUTH_DEPENDENCIES), (
        "core.auth.AUTH_DEPENDENCIES is out of sync with the get_current_user* "
        "callables in the module — a new auth variant must be added to the "
        f"tuple.\n  in tuple, not discovered: {set(AUTH_DEPENDENCIES) - discovered}"
        f"\n  discovered, not in tuple: {discovered - set(AUTH_DEPENDENCIES)}"
    )


def test__no_route_executes_auth_more_than_once() -> None:
    """
    Every route's auth dependencies collapse to a single execution: all
    cacheable (use_cache=True) and sharing one cache key.
    """
    from api.main import app  # noqa: PLC0415
    from core.auth import AUTH_DEPENDENCIES  # noqa: PLC0415

    targets = set(AUTH_DEPENDENCIES)
    offenders = _offending_routes(app, targets)
    assert not offenders, (
        "Endpoints whose auth dependencies can execute more than once per "
        "request, breaking the phantom-cache invariant (see module docstring):\n"
        + "\n".join(f"  {route}: {why}" for route, why in offenders.items())
    )

    # Non-vacuity: this test is worthless if the traversal silently found
    # nothing (empty route table, import failure dropping routers, etc.).
    # Assert the auth-carrying routers actually loaded and were checked, by
    # naming load-bearing protected routes rather than a brittle count floor.
    checked = _checked_paths(app, targets)
    assert checked, "no auth-guarded routes checked — route registration broken?"
    for expected in ("/users/me", "/bookmarks/"):
        assert expected in checked, (
            f"expected protected route {expected!r} among checked routes — "
            f"an auth-carrying router may have failed to load. Checked: "
            f"{sorted(checked)[:8]}..."
        )


# ---------------------------------------------------------------------------
# Negative validation: the guard must actually DETECT each bypass shape.
# ---------------------------------------------------------------------------


def _one_auth_callable() -> set[Callable]:
    from core.auth import (  # noqa: PLC0415
        get_current_user,
        get_current_user_ai,
    )

    return {get_current_user, get_current_user_ai}


def test__guard_detects_two_distinct_auth_callables() -> None:
    """Two different auth callables on one route → two cache keys → flagged."""
    from core.auth import get_current_user, get_current_user_ai  # noqa: PLC0415

    app = FastAPI()

    @app.get(
        "/two-distinct",
        dependencies=[Depends(get_current_user), Depends(get_current_user_ai)],
    )
    async def _r() -> dict:
        return {}

    assert _offending_routes(app, _one_auth_callable())


def test__guard_detects_same_callable_uncached() -> None:
    """
    Same callable twice with use_cache=False → executes twice → flagged.

    use_cache=False must be set via a *parameter* Depends: route-level
    `dependencies=[...]` silently forces use_cache=True (verified), so the
    param form is the only way a real route could introduce this. The guard's
    traversal walks both param and route-level nodes, so it catches it.
    """
    from core.auth import get_current_user  # noqa: PLC0415

    app = FastAPI()

    @app.get("/uncached-dup")
    async def _r(
        a: object = Depends(get_current_user),  # noqa: ARG001
        b: object = Depends(get_current_user, use_cache=False),  # noqa: ARG001
    ) -> dict:
        return {}

    assert _offending_routes(app, {get_current_user})


def test__guard_detects_same_callable_different_scopes() -> None:
    """Same callable under different security scopes → different cache keys."""
    from core.auth import get_current_user  # noqa: PLC0415

    app = FastAPI()

    @app.get(
        "/diff-scopes",
        dependencies=[
            Security(get_current_user, scopes=["x"]),
            Security(get_current_user, scopes=["y"]),
        ],
    )
    async def _r() -> dict:
        return {}

    assert _offending_routes(app, {get_current_user})


def test__guard_passes_single_cached_auth_dependency() -> None:
    """The compliant shape (one cached auth dep, even reached twice) passes."""
    from core.auth import get_current_user  # noqa: PLC0415

    app = FastAPI()

    @app.get(
        "/compliant",
        # Same key, use_cache=True → deduped to one execution.
        dependencies=[Depends(get_current_user), Depends(get_current_user)],
    )
    async def _r() -> dict:
        return {}

    assert not _offending_routes(app, {get_current_user})
