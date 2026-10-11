"""
Tests for core/logging_config.py.

The defect being fixed: the API configured no logging, so first-party INFO lines
never reached the process output. The guards being added: the fix must not raise
the root logger (httpx and sqlalchemy.engine would emit at INFO), INFO must go to
stdout and WARNING+ to stderr (Railway classifies stderr as error level), and the
first-party list must track the packages that actually exist.
"""

import logging
from collections.abc import Generator
from pathlib import Path

import pytest

from core.logging_config import (
    FIRST_PARTY_LOGGERS,
    LOG_FORMAT,
    STDERR_HANDLER_NAME,
    STDOUT_HANDLER_NAME,
    configure_logging,
)

_THIRD_PARTY_MUST_STAY_QUIET = ("httpx", "sqlalchemy.engine")
_HANDLER_NAMES = {STDOUT_HANDLER_NAME, STDERR_HANDLER_NAME}

# Top-level packages under backend/src that are deliberately NOT configured by the
# API's logging setup: separate processes with their own entry points.
_NOT_API_PACKAGES = frozenset({"mcp_server", "prompt_mcp_server", "tasks"})

_BACKEND_SRC = Path(__file__).resolve().parents[2] / "src"


@pytest.fixture
def restore_loggers() -> Generator[None]:
    """Snapshot and restore the level/handlers of every logger this module touches."""
    names = (*FIRST_PARTY_LOGGERS, *_THIRD_PARTY_MUST_STAY_QUIET, "core.auth")
    snapshot = {
        name: (logging.getLogger(name).level, list(logging.getLogger(name).handlers))
        for name in names
    }
    root = logging.getLogger()
    root_state = (root.level, list(root.handlers))
    yield
    for name, (level, handlers) in snapshot.items():
        logger = logging.getLogger(name)
        logger.setLevel(level)
        logger.handlers[:] = handlers
    root.setLevel(root_state[0])
    root.handlers[:] = root_state[1]


def _strip_our_handlers() -> None:
    """Remove the named handlers so a fresh configure binds to the current streams."""
    for name in FIRST_PARTY_LOGGERS:
        logger = logging.getLogger(name)
        logger.handlers[:] = [h for h in logger.handlers if h.get_name() not in _HANDLER_NAMES]


def _our_handlers(name: str) -> list[logging.Handler]:
    return [h for h in logging.getLogger(name).handlers if h.get_name() in _HANDLER_NAMES]


@pytest.mark.usefixtures("restore_loggers")
def test__configure_logging__first_party_loggers_emit_at_info() -> None:
    """Every enumerated first-party logger, and its children, is enabled for INFO."""
    configure_logging()

    for name in FIRST_PARTY_LOGGERS:
        assert logging.getLogger(name).getEffectiveLevel() == logging.INFO, name
        assert logging.getLogger(f"{name}.child").isEnabledFor(logging.INFO), name
        assert {h.get_name() for h in _our_handlers(name)} == _HANDLER_NAMES, name


@pytest.mark.usefixtures("restore_loggers")
def test__configure_logging__leaves_root_and_third_party_unchanged() -> None:
    """
    The contract: configure_logging() touches only the first-party loggers.

    Asserted as "unchanged across the call" rather than against an ambient value,
    because pytest's --log-level raises the root logger before the test runs.
    """
    root = logging.getLogger()
    before = {
        "root": (root.level, list(root.handlers)),
        **{
            name: (logging.getLogger(name).level, list(logging.getLogger(name).handlers))
            for name in _THIRD_PARTY_MUST_STAY_QUIET
        },
    }

    configure_logging()

    assert (root.level, list(root.handlers)) == before["root"]
    for name in _THIRD_PARTY_MUST_STAY_QUIET:
        logger = logging.getLogger(name)
        assert (logger.level, list(logger.handlers)) == before[name], name


@pytest.mark.usefixtures("restore_loggers")
def test__configure_logging__third_party_stay_quiet_at_default_root_level() -> None:
    """
    With the root at its production default (WARNING), httpx and sqlalchemy.engine
    are not enabled for INFO after the call. If they were, every outbound URL and
    every SQL statement would be logged.
    """
    logging.getLogger().setLevel(logging.WARNING)

    configure_logging()

    for name in _THIRD_PARTY_MUST_STAY_QUIET:
        assert not logging.getLogger(name).isEnabledFor(logging.INFO), name


@pytest.mark.usefixtures("restore_loggers")
def test__configure_logging__is_idempotent() -> None:
    """Repeated calls (api.main imported more than once) add no duplicate handlers."""
    configure_logging()
    configure_logging()

    for name in FIRST_PARTY_LOGGERS:
        names = [h.get_name() for h in _our_handlers(name)]
        assert sorted(names) == sorted(_HANDLER_NAMES), name


@pytest.mark.usefixtures("restore_loggers")
def test__configure_logging__info_to_stdout_warning_to_stderr_exactly_once(
    capfd: pytest.CaptureFixture[str],
) -> None:
    """
    The line actually reaches the process output (the defect being fixed), on the
    right stream (Railway shows stderr as error level), exactly once (no
    duplicates from handler stacking or propagation).

    The handlers are rebuilt inside the test: a handler created at api.main import
    time is bound to whatever stream pytest had installed then, not the one capfd
    reads here.
    """
    _strip_our_handlers()
    configure_logging()
    configure_logging()  # idempotency must hold through real output too
    capfd.readouterr()  # discard anything emitted so far

    logging.getLogger("core.auth").info("probe-info")
    logging.getLogger("core.auth").warning("probe-warning")
    logging.getLogger("httpx").info("third-party-info-must-not-appear")

    out, err = capfd.readouterr()
    out_lines = [line for line in out.splitlines() if "probe" in line or "must-not" in line]
    err_lines = [line for line in err.splitlines() if "probe" in line or "must-not" in line]

    assert len(out_lines) == 1, out
    assert out_lines[0].endswith(" - core.auth - INFO - probe-info")
    assert len(err_lines) == 1, err
    assert err_lines[0].endswith(" - core.auth - WARNING - probe-warning")
    assert "third-party-info-must-not-appear" not in out + err
    # The format is the cron tasks' format: timestamp first.
    assert LOG_FORMAT.startswith("%(asctime)s")


def test__first_party_loggers__match_packages_under_backend_src() -> None:
    """
    Drift guard: a new top-level package under backend/src must be added to
    FIRST_PARTY_LOGGERS or to the explicit not-API set, or its INFO lines are
    silently dropped — the exact failure this module fixes.

    Lists every directory, not only ones with __init__.py: a namespace package
    imports fine without one and would otherwise slip past the guard.
    """
    on_disk = {
        p.name for p in _BACKEND_SRC.iterdir()
        if p.is_dir() and p.name != "__pycache__" and not p.name.startswith(".")
    }
    configured = set(FIRST_PARTY_LOGGERS)

    assert not (configured & _NOT_API_PACKAGES), "a package cannot be both API and not-API"
    assert on_disk - configured - _NOT_API_PACKAGES == set(), (
        "new package under backend/src: add it to FIRST_PARTY_LOGGERS or _NOT_API_PACKAGES"
    )
    assert configured - on_disk == set(), "FIRST_PARTY_LOGGERS names a package that no longer exists"
    assert _NOT_API_PACKAGES - on_disk == set(), "_NOT_API_PACKAGES names a package that no longer exists"
