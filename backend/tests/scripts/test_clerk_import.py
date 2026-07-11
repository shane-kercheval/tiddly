"""
Unit tests for the M2 Clerk import script's decision logic.

The script is the single highest-data-risk artifact in the Auth0 -> Clerk migration,
so the parse/classification/reconciliation logic is tested exhaustively here; the
thin API-calling shell is exercised in the dev-instance rehearsal, not unit-tested.
"""
from unittest.mock import AsyncMock, MagicMock

import pytest

from clerk_import import (
    BackfillAction,
    ClerkUserInfo,
    DbRow,
    ExportUser,
    ImportPlan,
    build_plan,
    execute_plan,
    format_report,
    parse_export,
    reconciliation_failure,
)


def _export_doc(users: list[dict], total: int | None = None) -> dict:
    """Auth0 CLI `include_totals=true` output shape."""
    return {
        "start": 0,
        "limit": 100,
        "length": len(users),
        "total": total if total is not None else len(users),
        "users": users,
    }


def _auth0_user(sub: str, email: str, email_verified: bool = True) -> dict:
    return {"user_id": sub, "email": email, "email_verified": email_verified}


def _db_row(
    row_id: str,
    auth0_id: str | None,
    external_auth_id: str | None = None,
    email: str | None = None,
) -> DbRow:
    return DbRow(id=row_id, auth0_id=auth0_id, external_auth_id=external_auth_id, email=email)


class TestParseExport:
    """Export parsing: shapes, truncation guard, field requirements, normalization."""

    def test_parses_include_totals_shape(self) -> None:
        doc = _export_doc([_auth0_user("google-oauth2|1", "A@Example.com")])
        users = parse_export([doc])
        assert users == [
            ExportUser(sub="google-oauth2|1", email="a@example.com", email_verified=True),
        ]

    def test_parses_bare_list(self) -> None:
        users = parse_export([[_auth0_user("auth0|2", "b@example.com", email_verified=False)]])
        assert users == [ExportUser(sub="auth0|2", email="b@example.com", email_verified=False)]

    def test_merges_multiple_documents(self) -> None:
        docs = [
            _export_doc([_auth0_user("google-oauth2|1", "a@example.com")], total=2),
            _export_doc([_auth0_user("google-oauth2|2", "b@example.com")], total=2),
        ]
        assert len(parse_export(docs)) == 2

    def test_truncated_export_fails_loudly(self) -> None:
        doc = _export_doc([_auth0_user("google-oauth2|1", "a@example.com")], total=120)
        with pytest.raises(ValueError, match=r"incomplete.*total=120"):
            parse_export([doc])

    def test_missing_users_key_rejected(self) -> None:
        with pytest.raises(ValueError, match="missing 'users'/'total'"):
            parse_export([{"total": 1}])

    def test_missing_email_rejected(self) -> None:
        with pytest.raises(ValueError, match="no 'email'"):
            parse_export([[{"user_id": "auth0|1", "email_verified": True}]])

    def test_missing_email_verified_rejected(self) -> None:
        # Verified status must come from the export, never defaulted (M0 footgun).
        with pytest.raises(ValueError, match="email_verified"):
            parse_export([[{"user_id": "auth0|1", "email": "a@example.com"}]])

    def test_duplicate_sub_rejected(self) -> None:
        user = _auth0_user("auth0|1", "a@example.com")
        with pytest.raises(ValueError, match="Duplicate user_id"):
            parse_export([[user, user]])

    def test_email_casefolded(self) -> None:
        users = parse_export([[_auth0_user("auth0|1", "  MiXeD@Example.COM ")]])
        assert users[0].email == "mixed@example.com"


class TestBuildPlanHappyPaths:
    """The plan's create/skip decisions and the verified-status carry-through."""

    def test_single_user_with_row_creates_and_maps(self) -> None:
        export = [ExportUser("google-oauth2|1", "a@example.com", email_verified=True)]
        rows = [_db_row("row-1", "google-oauth2|1")]
        plan = build_plan(export, rows, [], set())
        assert plan.is_clean
        assert len(plan.creates) == 1
        create = plan.creates[0]
        assert create.email == "a@example.com"
        assert create.email_verified is True
        assert create.auth0_sub == "google-oauth2|1"
        assert create.db_row_id == "row-1"
        assert create.needs_password_skip is False

    def test_password_user_gets_password_skip(self) -> None:
        export = [ExportUser("auth0|pw", "pw@example.com", email_verified=True)]
        plan = build_plan(export, [_db_row("row-1", "auth0|pw")], [], set())
        assert plan.is_clean
        assert plan.creates[0].needs_password_skip is True

    def test_verified_status_carried_through_verified(self) -> None:
        export = [ExportUser("google-oauth2|1", "a@example.com", email_verified=True)]
        plan = build_plan(export, [_db_row("row-1", "google-oauth2|1")], [], set())
        assert plan.creates[0].email_verified is True

    def test_verified_status_carried_through_unverified(self) -> None:
        # An unverified export row must import unverified — blanket-asserting
        # verification would launder the address into silent Google account-linking.
        export = [ExportUser("auth0|1", "u@example.com", email_verified=False)]
        plan = build_plan(export, [_db_row("row-1", "auth0|1")], [], set())
        assert plan.is_clean
        assert plan.creates[0].email_verified is False

    def test_export_user_without_row_skipped(self) -> None:
        export = [ExportUser("google-oauth2|ghost", "ghost@example.com", email_verified=True)]
        plan = build_plan(export, [], [], set())
        assert plan.is_clean
        assert plan.creates == []
        assert [s.sub for s in plan.skipped] == ["google-oauth2|ghost"]


class TestDualSubCollisions:
    """The same email appearing under both auth0| and google-oauth2| subs."""

    def test_dual_sub_one_row_creates_once_discarding_other_sub(self) -> None:
        export = [
            ExportUser("auth0|pw", "dup@example.com", email_verified=True),
            ExportUser("google-oauth2|g", "dup@example.com", email_verified=True),
        ]
        rows = [_db_row("row-1", "google-oauth2|g")]
        plan = build_plan(export, rows, [], set())
        assert plan.is_clean
        assert len(plan.creates) == 1
        assert plan.creates[0].auth0_sub == "google-oauth2|g"
        assert plan.creates[0].discarded_subs == ["auth0|pw"]
        assert plan.discarded_subs == ["auth0|pw"]

    def test_dual_sub_two_rows_hard_preflight_failure_naming_accounts(self) -> None:
        export = [
            ExportUser("auth0|pw", "dup@example.com", email_verified=True),
            ExportUser("google-oauth2|g", "dup@example.com", email_verified=True),
        ]
        rows = [_db_row("row-1", "auth0|pw"), _db_row("row-2", "google-oauth2|g")]
        plan = build_plan(export, rows, [], set())
        assert not plan.is_clean
        assert plan.creates == []
        failure = plan.failures[0]
        assert "dup@example.com" in failure
        assert "row-1" in failure
        assert "row-2" in failure


class TestUnmatchedDbRows:
    """DB rows the export cannot account for."""

    def test_row_without_export_counterpart_is_hard_failure(self) -> None:
        plan = build_plan([], [_db_row("row-1", "auth0|vanished")], [], set())
        assert not plan.is_clean
        assert "auth0|vanished" in plan.failures[0]

    def test_clerk_native_row_needs_no_backfill_and_accounts_its_user(self) -> None:
        rows = [_db_row("row-1", None, external_auth_id="user_clerk1")]
        clerk = [ClerkUserInfo(id="user_clerk1", external_id=None, emails=["c@example.com"])]
        plan = build_plan([], rows, clerk, set())
        assert plan.is_clean
        assert plan.clerk_native_rows == ["row-1"]

    def test_pre_linked_row_outside_export_is_exempt_and_accounts_its_user(self) -> None:
        # Operator/test accounts (PAT-authenticated, Auth0 identity deleted) get
        # hand-linked to Clerk users at M6a-prep — the import owes them nothing,
        # and their Clerk user must not be flagged as an unexpected walk-in.
        rows = [_db_row("row-1", "auth0|pentest", external_auth_id="user_op1")]
        clerk = [ClerkUserInfo(id="user_op1", external_id=None, emails=["op@example.com"])]
        plan = build_plan([], rows, clerk, set())
        assert plan.is_clean
        assert plan.pre_linked_rows == ["row-1"]

    def test_pre_linked_row_with_stale_link_still_fails(self) -> None:
        rows = [_db_row("row-1", "auth0|pentest", external_auth_id="user_gone")]
        plan = build_plan([], rows, [], set())
        assert not plan.is_clean
        assert "user_gone" in plan.failures[0]


class TestIdempotency:
    """Re-runs must reuse, verify, or no-op — never duplicate."""

    def test_existing_clerk_user_reused_backfill_only(self) -> None:
        export = [ExportUser("google-oauth2|1", "a@example.com", email_verified=True)]
        rows = [_db_row("row-1", "google-oauth2|1")]
        clerk = [
            ClerkUserInfo(
                id="user_abc", external_id="google-oauth2|1", emails=["a@example.com"],
            ),
        ]
        plan = build_plan(export, rows, clerk, set())
        assert plan.is_clean
        assert plan.creates == []
        assert len(plan.backfills) == 1
        assert plan.backfills[0].clerk_user_id == "user_abc"
        assert plan.backfills[0].db_row_id == "row-1"

    def test_fully_linked_row_is_noop(self) -> None:
        export = [ExportUser("google-oauth2|1", "a@example.com", email_verified=True)]
        rows = [_db_row("row-1", "google-oauth2|1", external_auth_id="user_abc")]
        clerk = [
            ClerkUserInfo(
                id="user_abc", external_id="google-oauth2|1", emails=["a@example.com"],
            ),
        ]
        plan = build_plan(export, rows, clerk, set())
        assert plan.is_clean
        assert plan.creates == []
        assert plan.backfills == []
        assert plan.already_linked == ["row-1"]

    def test_linked_row_pointing_at_missing_clerk_user_fails(self) -> None:
        export = [ExportUser("google-oauth2|1", "a@example.com", email_verified=True)]
        rows = [_db_row("row-1", "google-oauth2|1", external_auth_id="user_gone")]
        plan = build_plan(export, rows, [], set())
        assert not plan.is_clean
        assert "user_gone" in plan.failures[0]

    def test_linked_row_with_mismatched_external_id_fails(self) -> None:
        export = [ExportUser("google-oauth2|1", "a@example.com", email_verified=True)]
        rows = [_db_row("row-1", "google-oauth2|1", external_auth_id="user_abc")]
        clerk = [
            ClerkUserInfo(id="user_abc", external_id="auth0|other", emails=["a@example.com"]),
        ]
        plan = build_plan(export, rows, clerk, set())
        assert not plan.is_clean
        assert "does not match" in plan.failures[0]


class TestPreexistingClerkUsers:
    """Walk-in accounts on the target instance are failures unless allowlisted."""

    def test_unexpected_clerk_user_is_hard_failure(self) -> None:
        clerk = [ClerkUserInfo(id="user_walkin", external_id=None, emails=["w@example.com"])]
        plan = build_plan([], [], clerk, set())
        assert not plan.is_clean
        assert "user_walkin" in plan.failures[0]

    def test_allowlist_by_email(self) -> None:
        clerk = [ClerkUserInfo(id="user_op", external_id=None, emails=["op@example.com"])]
        plan = build_plan([], [], clerk, {"OP@example.com"})
        assert plan.is_clean

    def test_allowlist_by_clerk_user_id(self) -> None:
        clerk = [ClerkUserInfo(id="user_op", external_id=None, emails=["op@example.com"])]
        plan = build_plan([], [], clerk, {"user_op"})
        assert plan.is_clean

    def test_allowlisted_user_holding_a_create_email_still_fails(self) -> None:
        # Allowlisting silences "unexpected user", but a create against an email that
        # user holds would collide at execute time — surface it in preflight instead.
        export = [ExportUser("google-oauth2|1", "a@example.com", email_verified=True)]
        rows = [_db_row("row-1", "google-oauth2|1")]
        clerk = [ClerkUserInfo(id="user_op", external_id=None, emails=["a@example.com"])]
        plan = build_plan(export, rows, clerk, {"user_op"})
        assert not plan.is_clean
        assert "collide" in plan.failures[0]

    def test_stale_clerk_user_from_prior_run_tolerated(self) -> None:
        # A previous run created this user; the DB was then restored fresh, so the
        # export sub exists but its row does not. Accounted for by the export — not
        # a walk-in — and there is simply nothing to backfill.
        export = [ExportUser("google-oauth2|1", "a@example.com", email_verified=True)]
        clerk = [
            ClerkUserInfo(
                id="user_old", external_id="google-oauth2|1", emails=["a@example.com"],
            ),
        ]
        plan = build_plan(export, [], clerk, set())
        assert plan.is_clean
        assert [s.sub for s in plan.skipped] == ["google-oauth2|1"]


class TestReconciliationGate:
    """The last-resort invariant must fail closed, not just print."""

    def test_balanced_plan_has_no_reconciliation_failure(self) -> None:
        export = [ExportUser("google-oauth2|1", "a@example.com", email_verified=True)]
        plan = build_plan(export, [_db_row("row-1", "google-oauth2|1")], [], set())
        assert reconciliation_failure(plan, 1) is None

    def test_unbalanced_plan_returns_failure(self) -> None:
        # The classifier can't produce a mismatch through its public API (the bucket
        # accounting holds by construction), so exercise the helper on a hand-built
        # plan — this is the regression net for a future classifier edit that breaks
        # the accounting.
        plan = ImportPlan()  # accounts for zero users
        failure = reconciliation_failure(plan, export_count=3)
        assert failure is not None
        assert "3" in failure

    def test_mismatch_blocks_execution_via_is_clean(self) -> None:
        # build_plan appends the reconciliation result to plan.failures, so the
        # execution gate (is_clean) and the printed verdict derive from one check.
        plan = ImportPlan()
        mismatch = reconciliation_failure(plan, export_count=2)
        assert mismatch is not None
        plan.failures.append(mismatch)
        assert not plan.is_clean
        report = format_report(plan, 2, executed=False)
        assert "MISMATCH" in report


class TestExecutePlanGuards:
    """The backfill transaction's own safety net (the rest of the shell is IO)."""

    async def test_rowcount_mismatch_raises_and_never_commits(self) -> None:
        # rowcount 0 means the row was already backfilled (concurrent/prior run) or
        # the WHERE matched nothing — either way the batch must abort uncommitted;
        # the next run re-heals via the idempotent classification.
        plan = ImportPlan(
            backfills=[
                BackfillAction(
                    clerk_user_id="user_x", auth0_sub="auth0|x", db_row_id="row-1",
                ),
            ],
        )
        session = AsyncMock()
        session.execute.return_value = MagicMock(rowcount=0)
        session_factory = MagicMock()
        session_factory.return_value.__aenter__ = AsyncMock(return_value=session)
        session_factory.return_value.__aexit__ = AsyncMock(return_value=False)

        with pytest.raises(RuntimeError, match="rolling back"):
            await execute_plan(plan, clerk=None, session_factory=session_factory)
        session.commit.assert_not_awaited()


class TestFormatReport:
    """The reconciliation report the operator reviews before --execute."""

    def test_reconciliation_ok_when_counts_net_out(self) -> None:
        export = [
            ExportUser("auth0|pw", "dup@example.com", email_verified=True),
            ExportUser("google-oauth2|g", "dup@example.com", email_verified=True),
            ExportUser("google-oauth2|1", "a@example.com", email_verified=True),
            ExportUser("google-oauth2|ghost", "ghost@example.com", email_verified=True),
        ]
        rows = [_db_row("row-1", "google-oauth2|g"), _db_row("row-2", "google-oauth2|1")]
        plan = build_plan(export, rows, [], set())
        report = format_report(plan, len(export), executed=False)
        assert "Reconciliation: 2 mapped + 1 skipped + 1 discarded == 4 exported: OK" in report
        assert "MISMATCH" not in report

    def test_unverified_create_named_in_report(self) -> None:
        export = [ExportUser("auth0|1", "u@example.com", email_verified=False)]
        plan = build_plan(export, [_db_row("row-1", "auth0|1")], [], set())
        report = format_report(plan, 1, executed=False)
        assert "u@example.com" in report
        assert "UNVERIFIED" in report

    def test_failures_listed(self) -> None:
        plan = build_plan([], [_db_row("row-1", "auth0|gone")], [], set())
        report = format_report(plan, 0, executed=False)
        assert "PREFLIGHT FAILURES (1)" in report
        assert "auth0|gone" in report
