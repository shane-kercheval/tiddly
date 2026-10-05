"""
Application logging for the API process.

Why this exists: the API never configured logging. Uvicorn configures only its
own loggers (``uvicorn``, ``uvicorn.error``, ``uvicorn.access``) and leaves the
root logger at its default WARNING with no handler, so every first-party
``logger.info(...)`` call in the API — including the security review's
``clerk_oauth_token_accepted client_id=... sub=...`` line in ``core/auth.py`` —
was dropped before reaching the process output in every environment. Only
WARNING and above ever surfaced, through Python's ``lastResort`` handler.

Three deliberate choices, each with a reason that is easy to lose:

1. **The first-party loggers are enumerated; the root logger is not raised.**
   ``PYTHONPATH`` is ``backend/src``, so the application has no single root
   package — its loggers are ``api.*``, ``core.*``, ``services.*`` and so on,
   siblings of every third-party package. Setting the root logger to INFO (the
   cron tasks' ``logging.basicConfig(level=INFO)`` pattern) would also enable
   ``httpx`` (one ``HTTP Request: <method> <url>`` line per outbound call — every
   user-submitted scrape URL and every LLM provider call) and
   ``sqlalchemy.engine`` (every SQL statement, even with ``echo=False``). Neither
   is a first-party log call, so auditing our own ``logger.info`` calls for
   sensitive values would never catch them.

2. **Handlers are attached to the first-party loggers, not to the root.** The
   textbook alternative (one root handler, levels on the loggers) was considered
   and rejected: LiteLLM installs its own ``StreamHandler`` on the ``LiteLLM``,
   ``LiteLLM Proxy`` and ``LiteLLM Router`` loggers and leaves propagation on
   (``litellm/_logging.py``), so a root handler would print every LiteLLM
   warning and error twice. Scoped handlers have the mirror-image exposure (a
   root handler installed later would double *our* lines), but that is
   hypothetical and LiteLLM's handlers are present today.

3. **Records below WARNING go to stdout; WARNING and above go to stderr.**
   Railway's log viewer classifies unstructured stderr as error level (red) and
   unstructured stdout as info level. With a single stderr handler the
   accepted-token line, which fires once per OAuth-authenticated request (because
   ``decode_clerk_jwt`` runs before the auth cache is consulted), would paint one
   red "error" per MCP tool call. Uvicorn's own INFO lines already have this
   problem; this module does not add to it. The cron tasks still use
   ``basicConfig`` to stderr and show the same red INFO lines — a follow-up, not
   in scope here.

``mcp_server`` and ``prompt_mcp_server`` are absent from the list on purpose:
they are separate processes with their own entry points. ``tasks`` configures
its own logging in each entry point. ``test_logging_config.py`` asserts the list
matches the directories under ``backend/src`` so a new package cannot be
silently dropped.
"""

import logging
import sys

# The API's own top-level packages under backend/src. Add a package here when one
# is created (the drift test will tell you); do NOT replace this list with a
# root-logger configuration (see the module docstring for why).
FIRST_PARTY_LOGGERS: tuple[str, ...] = (
    "api",
    "core",
    "services",
    "shared",
    "db",
    "models",
    "schemas",
)

# Same shape as the cron tasks' format so Railway log lines read alike.
LOG_FORMAT = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"

# Handler names make configure_logging idempotent: api/main.py can be imported
# more than once in a test session, and uvicorn imports it once per worker.
STDOUT_HANDLER_NAME = "tiddly-api-first-party-stdout"
STDERR_HANDLER_NAME = "tiddly-api-first-party-stderr"


def _below_warning(record: logging.LogRecord) -> bool:
    """Filter for the stdout handler: everything the stderr handler does not take."""
    return record.levelno < logging.WARNING


def _build_handlers() -> list[logging.Handler]:
    """Build the stdout (< WARNING) and stderr (>= WARNING) handler pair."""
    formatter = logging.Formatter(LOG_FORMAT)

    stdout_handler = logging.StreamHandler(sys.stdout)
    stdout_handler.set_name(STDOUT_HANDLER_NAME)
    stdout_handler.addFilter(_below_warning)
    stdout_handler.setFormatter(formatter)

    stderr_handler = logging.StreamHandler(sys.stderr)
    stderr_handler.set_name(STDERR_HANDLER_NAME)
    stderr_handler.setLevel(logging.WARNING)
    stderr_handler.setFormatter(formatter)

    return [stdout_handler, stderr_handler]


def configure_logging(level: int = logging.INFO) -> None:
    """
    Set each first-party logger to ``level`` and attach the stdout/stderr handler
    pair to it.

    Leaves the root logger and every third-party logger untouched (they keep the
    default WARNING via ``lastResort``). Idempotent: repeated calls neither stack
    handlers nor duplicate lines. Records still propagate to the root logger, so
    pytest's ``caplog`` sees them unchanged.
    """
    handlers = _build_handlers()
    for name in FIRST_PARTY_LOGGERS:
        logger = logging.getLogger(name)
        logger.setLevel(level)
        present = {h.get_name() for h in logger.handlers}
        for handler in handlers:
            if handler.get_name() not in present:
                logger.addHandler(handler)
