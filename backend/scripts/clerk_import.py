r"""
Auth0 -> Clerk user import & backfill (migration plan M2; the production run happens at M6a).

For every Auth0-exported user that has a Tiddly database row, creates a Clerk user —
carrying the email's verified status through from the export (never asserting it: the
Backend API marks emails verified by default, which would launder unverified addresses
into silent Google account-linking), storing the Auth0 `sub` in Clerk's `external_id`
(audit breadcrumb only; the application never reads it, per AD3) — then backfills
`users.external_auth_id` with the Clerk user IDs.

Dry-run is the default; nothing is written to Clerk or Postgres without --execute,
and no write happens unless the preflight classification is completely clean:

- export email with no matching DB row         -> skipped (logged; no data to preserve)
- export email matching exactly one DB row     -> create one Clerk user mapped to it
- export email matching two or more DB rows    -> hard failure (manual merge decision)
- DB row whose auth0_id is absent from export  -> hard failure (never guess-match)
- Clerk user the plan cannot account for       -> hard failure unless --allow-existing

Inputs:
    --export-file    JSON from `auth0 api get "users?per_page=100&include_totals=true"`
                     (repeatable for paginated exports; a bare JSON array also works,
                     e.g. for test fixtures)
    --database-url   explicit asyncpg URL — deliberately a required flag rather than
                     read from .env, so the script can never write to whatever database
                     the local environment happens to point at
    CLERK_SECRET_KEY (env) — the target Clerk instance's secret key; never logged

Usage:
    PYTHONPATH=backend/src uv run python backend/scripts/clerk_import.py \\
        --export-file /path/to/auth0_users.json \\
        --database-url postgresql+asyncpg://user:pass@localhost:5435/dbname \\
        [--execute] [--allow-existing <email-or-clerk-user-id>] ...
"""
import argparse
import asyncio
import json
import os
import sys
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from functools import partial
from pathlib import Path
from typing import Any, TypeVar

from clerk_backend_api import Clerk
from clerk_backend_api import models as clerk_models
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from models.user import User

CLERK_PAGE_SIZE = 500
RATE_LIMIT_MAX_ATTEMPTS = 6

T = TypeVar("T")


@dataclass
class ExportUser:
    """One user from the Auth0 bulk export."""

    sub: str
    email: str  # casefolded
    email_verified: bool


@dataclass
class DbRow:
    """The identity columns of one Postgres `users` row."""

    id: str
    auth0_id: str | None
    external_auth_id: str | None
    email: str | None


@dataclass
class ClerkUserInfo:
    """One pre-existing user on the target Clerk instance."""

    id: str
    external_id: str | None
    emails: list[str]  # casefolded


@dataclass
class CreateAction:
    """Create a Clerk user and backfill the mapped DB row."""

    email: str
    email_verified: bool
    auth0_sub: str  # stored as Clerk external_id
    needs_password_skip: bool  # auth0| subs import passwordless (M0 no-hash-export decision)
    db_row_id: str
    discarded_subs: list[str] = field(default_factory=list)


@dataclass
class BackfillAction:
    """Clerk user already exists for this sub (idempotent re-run); only backfill the row."""

    clerk_user_id: str
    auth0_sub: str
    db_row_id: str


@dataclass
class ImportPlan:
    """The full intended mapping, plus everything that must stop the run."""

    creates: list[CreateAction] = field(default_factory=list)
    backfills: list[BackfillAction] = field(default_factory=list)
    already_linked: list[str] = field(default_factory=list)  # db row ids, nothing to do
    skipped: list[ExportUser] = field(default_factory=list)  # no DB row; not imported
    discarded_subs: list[str] = field(default_factory=list)  # dual-sub emails, non-DB sub
    clerk_native_rows: list[str] = field(default_factory=list)  # rows keyed by Clerk only
    pre_linked_rows: list[str] = field(default_factory=list)  # outside export, already linked
    failures: list[str] = field(default_factory=list)

    @property
    def is_clean(self) -> bool:
        """True when nothing blocks execution."""
        return not self.failures


def parse_export(raw_documents: list[Any]) -> list[ExportUser]:
    """
    Parse one or more Auth0 export documents into ExportUsers.

    Accepts the `auth0 api get "users?...&include_totals=true"` object shape
    (validated against its own `total`, so a truncated/paginated export fails loudly)
    or a bare JSON array of Auth0 user objects.
    """
    users_json: list[dict[str, Any]] = []
    expected_total: int | None = None
    for doc in raw_documents:
        if isinstance(doc, dict):
            if "users" not in doc or "total" not in doc:
                raise ValueError(
                    "Export object is missing 'users'/'total' keys — expected the "
                    "`auth0 api get \"users?...&include_totals=true\"` output shape.",
                )
            expected_total = doc["total"]
            users_json.extend(doc["users"])
        elif isinstance(doc, list):
            users_json.extend(doc)
        else:
            raise ValueError(f"Unrecognized export document type: {type(doc).__name__}")

    if expected_total is not None and len(users_json) != expected_total:
        raise ValueError(
            f"Export is incomplete: files contain {len(users_json)} users but the "
            f"export reports total={expected_total}. Fetch every page "
            "(auth0 api get \"users?page=N...\") and pass all files via --export-file.",
        )

    parsed: list[ExportUser] = []
    seen_subs: set[str] = set()
    for user in users_json:
        sub = user.get("user_id")
        email = user.get("email")
        if not sub:
            raise ValueError(f"Export user is missing 'user_id': {sorted(user.keys())}")
        if not email:
            raise ValueError(f"Export user {sub} has no 'email' — cannot classify it.")
        if "email_verified" not in user:
            raise ValueError(
                f"Export user {sub} has no 'email_verified' field — the verified status "
                "must be carried through from the export, never defaulted.",
            )
        if sub in seen_subs:
            raise ValueError(f"Duplicate user_id in export: {sub}")
        seen_subs.add(sub)
        parsed.append(
            ExportUser(
                sub=sub,
                email=email.strip().casefold(),
                email_verified=bool(user["email_verified"]),
            ),
        )
    return parsed


def _verify_linked_row(
    row: DbRow,
    sub: str,
    clerk_by_id: dict[str, ClerkUserInfo],
    plan: ImportPlan,
) -> str | None:
    """Verify an already-backfilled row's Clerk link; returns the accounted Clerk id."""
    linked = clerk_by_id.get(row.external_auth_id or "")
    if linked is None:
        plan.failures.append(
            f"users.id={row.id} claims external_auth_id={row.external_auth_id}, but no "
            "such user exists on the target Clerk instance. Wrong instance or stale row.",
        )
        return None
    if linked.external_id != sub:
        plan.failures.append(
            f"users.id={row.id} is linked to Clerk user {linked.id}, whose external_id "
            f"({linked.external_id}) does not match the row's auth0_id ({sub}).",
        )
        return None
    plan.already_linked.append(row.id)
    return linked.id


def _classify_email_group(
    email: str,
    group: list[ExportUser],
    db_by_sub: dict[str, DbRow],
    clerk_by_external_id: dict[str, ClerkUserInfo],
    clerk_by_id: dict[str, ClerkUserInfo],
    plan: ImportPlan,
) -> str | None:
    """Classify one email's export users against Postgres; returns an accounted Clerk id."""
    matches = [(eu, db_by_sub[eu.sub]) for eu in group if eu.sub in db_by_sub]

    if not matches:
        plan.skipped.extend(group)
        return None

    if len(matches) > 1:
        described = ", ".join(f"{eu.sub} -> users.id={row.id}" for eu, row in matches)
        plan.failures.append(
            f"Email {email} maps to {len(matches)} data-bearing Tiddly accounts "
            f"({described}). One human with two accounts is a manual merge/ownership "
            "decision — resolve it before importing.",
        )
        return None

    export_user, row = matches[0]
    plan.discarded_subs.extend(eu.sub for eu in group if eu.sub != export_user.sub)

    if row.external_auth_id is not None:
        # Row already backfilled (idempotent re-run) — verify the link instead of writing.
        return _verify_linked_row(row, export_user.sub, clerk_by_id, plan)

    existing = clerk_by_external_id.get(export_user.sub)
    if existing is not None:
        plan.backfills.append(
            BackfillAction(
                clerk_user_id=existing.id,
                auth0_sub=export_user.sub,
                db_row_id=row.id,
            ),
        )
        return existing.id

    plan.creates.append(
        CreateAction(
            email=email,
            email_verified=export_user.email_verified,
            auth0_sub=export_user.sub,
            needs_password_skip=export_user.sub.startswith("auth0|"),
            db_row_id=row.id,
            discarded_subs=[eu.sub for eu in group if eu.sub != export_user.sub],
        ),
    )
    return None


def _reconcile_db_row(
    row: DbRow,
    export_subs: set[str],
    clerk_by_id: dict[str, ClerkUserInfo],
    plan: ImportPlan,
    accounted_clerk_ids: set[str],
) -> None:
    """Account for one DB row that the email-group classification didn't map."""
    if row.auth0_id is None:
        # Keyed by Clerk only (JIT-created during the window) — needs no backfill,
        # and its Clerk user is legitimately on the instance.
        plan.clerk_native_rows.append(row.id)
        if row.external_auth_id is not None:
            accounted_clerk_ids.add(row.external_auth_id)
    elif row.auth0_id not in export_subs:
        if row.external_auth_id is not None and row.external_auth_id in clerk_by_id:
            # Outside the export but already holding a valid Clerk link — e.g.
            # operator/test accounts (PAT-authenticated, Auth0 identity long gone)
            # linked by hand at M6a-prep. The import owes this row nothing.
            plan.pre_linked_rows.append(row.id)
            accounted_clerk_ids.add(row.external_auth_id)
        elif row.external_auth_id is not None:
            plan.failures.append(
                f"users.id={row.id} (auth0_id={row.auth0_id}) is outside the export "
                f"and its external_auth_id={row.external_auth_id} matches no user on "
                "the target Clerk instance. Wrong instance or stale link.",
            )
        else:
            plan.failures.append(
                f"users.id={row.id} (auth0_id={row.auth0_id}) has no counterpart in "
                "the export — a row without a mapping. Never guess-matched; resolve "
                "before importing: delete the row (dead account) or link it to a "
                "Clerk user via external_auth_id (operator/test account).",
            )


def build_plan(
    export_users: list[ExportUser],
    db_rows: list[DbRow],
    clerk_users: list[ClerkUserInfo],
    allow_existing: set[str],
) -> ImportPlan:
    """
    Build the full intended mapping, collecting every blocking condition as a failure.

    Pure decision logic — no IO. `allow_existing` holds operator-named emails or Clerk
    user IDs for pre-existing instance users the export legitimately doesn't cover
    (dev/test accounts; M6a's operator smoke-test account).
    """
    plan = ImportPlan()
    allow = {a.strip().casefold() for a in allow_existing}

    db_by_sub = {r.auth0_id: r for r in db_rows if r.auth0_id is not None}
    clerk_by_id = {c.id: c for c in clerk_users}
    clerk_by_external_id = {c.external_id: c for c in clerk_users if c.external_id}

    groups: dict[str, list[ExportUser]] = {}
    for eu in export_users:
        groups.setdefault(eu.email, []).append(eu)

    accounted_clerk_ids: set[str] = set()
    for email, group in sorted(groups.items()):
        accounted = _classify_email_group(
            email, group, db_by_sub, clerk_by_external_id, clerk_by_id, plan,
        )
        if accounted is not None:
            accounted_clerk_ids.add(accounted)

    export_subs = {eu.sub for eu in export_users}
    for row in db_rows:
        _reconcile_db_row(row, export_subs, clerk_by_id, plan, accounted_clerk_ids)

    create_emails = {c.email for c in plan.creates}
    for clerk_user in clerk_users:
        if clerk_user.id in accounted_clerk_ids:
            continue
        if clerk_user.external_id in export_subs:
            # Created by a previous run for an export user whose DB row no longer
            # exists (e.g. a fresh restore). Harmless: nothing to backfill.
            continue
        if clerk_user.id.casefold() in allow or any(e in allow for e in clerk_user.emails):
            overlap = create_emails.intersection(clerk_user.emails)
            if overlap:
                plan.failures.append(
                    f"Allowlisted Clerk user {clerk_user.id} holds email(s) "
                    f"{sorted(overlap)} that this import must create — the create would "
                    "collide. Remove or rename that user first.",
                )
            continue
        plan.failures.append(
            f"Unexpected pre-existing Clerk user {clerk_user.id} "
            f"(external_id={clerk_user.external_id}, emails={clerk_user.emails}) — not "
            "accounted for by the export. A walk-in sign-up colliding with the import? "
            "Name it via --allow-existing only if it is a known operator/test account.",
        )

    # The last-resort invariant is part of plan validity, not just report text —
    # the execution gate (`is_clean`) must fail closed if the books don't balance.
    mismatch = reconciliation_failure(plan, len(export_users))
    if mismatch is not None:
        plan.failures.append(mismatch)

    return plan


def reconciliation_failure(plan: ImportPlan, export_count: int) -> str | None:
    """
    Check that every exported user is accounted for exactly once.

    Shared by `build_plan` (which turns a mismatch into a blocking failure) and
    `format_report` (which renders the same arithmetic), so the printed verdict
    and the execution gate can never diverge.
    """
    mapped = len(plan.creates) + len(plan.backfills) + len(plan.already_linked)
    accounted = mapped + len(plan.skipped) + len(plan.discarded_subs)
    if accounted == export_count:
        return None
    return (
        f"RECONCILIATION MISMATCH: {mapped} mapped + {len(plan.skipped)} skipped + "
        f"{len(plan.discarded_subs)} discarded = {accounted}, but the export contains "
        f"{export_count} users. The plan does not account for every exported user — "
        "refusing to execute."
    )


def format_report(plan: ImportPlan, export_count: int, *, executed: bool) -> str:
    """Render the reconciliation report the plan requires (counts must net to zero)."""
    lines: list[str] = []
    mode = "EXECUTE (writes follow below)" if executed else "DRY-RUN (no writes performed)"
    lines.append(f"=== Clerk import plan — {mode} ===")
    lines.append(f"Exported Auth0 users:            {export_count}")
    lines.append(f"Clerk users to create:           {len(plan.creates)}")
    for c in sorted(plan.creates, key=lambda a: a.email):
        flags = []
        if not c.email_verified:
            flags.append("UNVERIFIED — will import unverified (linking will prompt)")
        if c.needs_password_skip:
            flags.append("passwordless import (password user)")
        if c.discarded_subs:
            flags.append(f"discarding duplicate sub(s): {', '.join(c.discarded_subs)}")
        suffix = f"  [{'; '.join(flags)}]" if flags else ""
        lines.append(f"  + {c.email}  ({c.auth0_sub} -> users.id={c.db_row_id}){suffix}")
    lines.append(f"Backfill-only (Clerk user exists): {len(plan.backfills)}")
    for b in plan.backfills:
        lines.append(f"  ~ {b.clerk_user_id}  ({b.auth0_sub} -> users.id={b.db_row_id})")
    lines.append(f"Already linked (no-op):          {len(plan.already_linked)}")
    lines.append(f"Skipped (no Tiddly data):        {len(plan.skipped)}")
    for s in sorted(plan.skipped, key=lambda u: u.email):
        lines.append(f"  - {s.email}  ({s.sub})")
    if plan.discarded_subs:
        lines.append(f"Discarded duplicate subs:        {len(plan.discarded_subs)}")
    if plan.clerk_native_rows:
        lines.append(f"Clerk-native rows (no backfill): {len(plan.clerk_native_rows)}")
    if plan.pre_linked_rows:
        lines.append(f"Pre-linked rows outside export: {len(plan.pre_linked_rows)}")

    mapped = len(plan.creates) + len(plan.backfills) + len(plan.already_linked)
    mismatch = reconciliation_failure(plan, export_count)
    lines.append(
        f"Reconciliation: {mapped} mapped + {len(plan.skipped)} skipped + "
        f"{len(plan.discarded_subs)} discarded == {export_count} exported: "
        f"{'OK' if mismatch is None else 'MISMATCH'}",
    )

    if plan.failures:
        lines.append("")
        lines.append(f"PREFLIGHT FAILURES ({len(plan.failures)}) — nothing will be written:")
        for failure in plan.failures:
            lines.append(f"  ! {failure}")
    return "\n".join(lines)


async def _call_with_backoff[T](
    call: Callable[[], Awaitable[T]],
    description: str,
) -> T:
    """Run a Clerk SDK call, backing off on 429s instead of crashing mid-import."""
    for attempt in range(RATE_LIMIT_MAX_ATTEMPTS):
        try:
            return await call()
        except clerk_models.SDKError as e:
            status = e.raw_response.status_code if e.raw_response is not None else None
            if status != 429 or attempt == RATE_LIMIT_MAX_ATTEMPTS - 1:
                raise
            delay = min(2 ** attempt, 30)
            print(f"  Clerk rate limit (429) on {description}; retrying in {delay}s...")
            await asyncio.sleep(delay)
    raise AssertionError("unreachable")


async def fetch_clerk_users(clerk: Clerk) -> list[ClerkUserInfo]:
    """Fetch every user on the target Clerk instance (paginated)."""
    users: list[ClerkUserInfo] = []
    offset = 0
    while True:
        page = await _call_with_backoff(
            partial(
                clerk.users.list_async,
                request=clerk_models.GetUserListRequest(limit=CLERK_PAGE_SIZE, offset=offset),
            ),
            "users.list",
        )
        if not page:
            break
        for u in page:
            emails = [
                e.email_address.strip().casefold()
                for e in (u.email_addresses or [])
                if e.email_address
            ]
            users.append(ClerkUserInfo(id=u.id, external_id=u.external_id, emails=emails))
        if len(page) < CLERK_PAGE_SIZE:
            break
        offset += CLERK_PAGE_SIZE
    return users


async def fetch_db_rows(session_factory: async_sessionmaker) -> list[DbRow]:
    """Fetch the identity columns of every users row."""
    async with session_factory() as session:
        result = await session.execute(
            select(User.id, User.auth0_id, User.external_auth_id, User.email),
        )
        return [
            DbRow(
                id=str(row.id),
                auth0_id=row.auth0_id,
                external_auth_id=row.external_auth_id,
                email=row.email,
            )
            for row in result
        ]


async def execute_plan(
    plan: ImportPlan,
    clerk: Clerk,
    session_factory: async_sessionmaker,
) -> list[BackfillAction]:
    """
    Create the planned Clerk users, then backfill every mapped row in one transaction.

    Returns the full backfill list (created + pre-existing) for the final report.
    """
    all_backfills: list[BackfillAction] = list(plan.backfills)
    for action in plan.creates:
        status = "verified" if action.email_verified else "reserved"
        created = await _call_with_backoff(
            partial(
                clerk.users.create_async,
                email_address=[action.email],
                # Explicit always — the Backend API defaults created emails to verified,
                # which would over-vouch for addresses Auth0 never verified (M0 finding).
                email_address_identification_status=[status],
                external_id=action.auth0_sub,
                # Required for every import create, not only the password user: no
                # imported user gets a password (the M0 no-hash-export decision), and
                # on an instance with password required, a BAPI create without this
                # flag is rejected outright (confirmed in the M2 rehearsal).
                skip_password_requirement=True,
            ),
            f"users.create ({action.email})",
        )
        print(f"  created Clerk user {created.id} for {action.email}")
        all_backfills.append(
            BackfillAction(
                clerk_user_id=created.id,
                auth0_sub=action.auth0_sub,
                db_row_id=action.db_row_id,
            ),
        )

    # Deliberately all-or-nothing: the RuntimeError below must propagate so the
    # session never commits and the whole batch rolls back as one. Do NOT catch
    # per-row and continue — that would turn this into a partial-write path. A
    # failed run re-heals on the next invocation: created Clerk users classify
    # as backfill-only and completed backfills as already-linked.
    async with session_factory() as session:
        for backfill in all_backfills:
            result = await session.execute(
                update(User)
                .where(User.id == backfill.db_row_id, User.external_auth_id.is_(None))
                .values(external_auth_id=backfill.clerk_user_id),
            )
            if result.rowcount != 1:
                raise RuntimeError(
                    f"Backfill of users.id={backfill.db_row_id} updated "
                    f"{result.rowcount} rows (expected 1) — rolling back everything.",
                )
        await session.commit()
    return all_backfills


async def verify_backfill_total(session_factory: async_sessionmaker) -> int:
    """Return the number of Auth0-keyed rows still missing external_auth_id (must be 0)."""
    async with session_factory() as session:
        result = await session.execute(
            select(func.count())
            .select_from(User)
            .where(User.auth0_id.is_not(None), User.external_auth_id.is_(None)),
        )
        return result.scalar_one()


def parse_args(argv: list[str]) -> argparse.Namespace:
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--export-file",
        action="append",
        required=True,
        type=Path,
        help="Auth0 export JSON (repeat the flag for paginated exports)",
    )
    parser.add_argument(
        "--database-url",
        required=True,
        help="Explicit asyncpg database URL (never read from .env by design)",
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Actually write to Clerk and Postgres (default is dry-run)",
    )
    parser.add_argument(
        "--allow-existing",
        action="append",
        default=[],
        metavar="EMAIL_OR_CLERK_USER_ID",
        help="Pre-existing Clerk instance user the export legitimately doesn't cover",
    )
    return parser.parse_args(argv)


async def run(args: argparse.Namespace) -> int:
    """Load inputs, build the plan, report, and (with --execute) run it."""
    secret_key = os.environ.get("CLERK_SECRET_KEY")
    if not secret_key:
        print("CLERK_SECRET_KEY is not set — export the target instance's secret key.")
        return 1

    raw_documents = [json.loads(p.read_text()) for p in args.export_file]
    export_users = parse_export(raw_documents)

    engine = create_async_engine(args.database_url)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with Clerk(bearer_auth=secret_key) as clerk:
            clerk_users = await fetch_clerk_users(clerk)
            db_rows = await fetch_db_rows(session_factory)
            plan = build_plan(
                export_users, db_rows, clerk_users, set(args.allow_existing),
            )
            print(format_report(plan, len(export_users), executed=args.execute))

            if not plan.is_clean:
                return 1
            if not args.execute:
                print("\nDry-run only. Re-run with --execute to apply this plan.")
                return 0

            print("\nExecuting...")
            backfills = await execute_plan(plan, clerk, session_factory)
            remaining = await verify_backfill_total(session_factory)
            print(f"\nBackfilled {len(backfills)} rows.")
            print(f"Auth0-keyed rows still missing external_auth_id: {remaining}")
            if remaining != 0:
                print("VERIFICATION FAILED — investigate before proceeding.")
                return 1
            print("Verification passed: mapping is total and 1:1 (unique index enforced).")
            return 0
    finally:
        await engine.dispose()


def main() -> None:
    """CLI entry point."""
    args = parse_args(sys.argv[1:])
    raise SystemExit(asyncio.run(run(args)))


if __name__ == "__main__":
    main()
