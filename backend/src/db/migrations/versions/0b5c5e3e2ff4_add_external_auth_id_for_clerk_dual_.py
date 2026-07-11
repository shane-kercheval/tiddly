"""add external_auth_id for clerk dual accept

Revision ID: 0b5c5e3e2ff4
Revises: 77ccf8214c82
Create Date: 2026-07-10 16:32:58.085841

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0b5c5e3e2ff4'
down_revision: Union[str, Sequence[str], None] = '77ccf8214c82'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # (Removed autogenerate's spurious drop of the trigger-maintained FTS GIN
    # indexes — a known autogenerate artifact; those indexes are not part of
    # this change.)
    op.add_column('users', sa.Column('external_auth_id', sa.String(length=255), nullable=True, comment="The 'sub' claim of verified IdP tokens (currently the Clerk user ID). Provider-neutral name, provider-specific value - never parse its format."))
    op.alter_column('users', 'auth0_id',
               existing_type=sa.VARCHAR(length=255),
               nullable=True,
               comment="Auth0 'sub' claim - NULL for users created via Clerk (dropped in M6b)",
               existing_comment="Auth0 'sub' claim - unique identifier from Auth0")
    op.create_index(op.f('ix_users_external_auth_id'), 'users', ['external_auth_id'], unique=True)
    # CheckConstraints are not detected by autogenerate; added manually to match
    # the model __table_args__. Transitional identity invariant for the
    # Auth0→Clerk dual-accept window: every user row must carry at least one
    # provider identity. Dropped in M6b along with auth0_id.
    op.create_check_constraint(
        'ck_user_has_identity',
        'users',
        '(auth0_id IS NOT NULL) OR (external_auth_id IS NOT NULL)',
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('ck_user_has_identity', 'users', type_='check')
    op.drop_index(op.f('ix_users_external_auth_id'), table_name='users')
    op.alter_column('users', 'auth0_id',
               existing_type=sa.VARCHAR(length=255),
               nullable=False,
               comment="Auth0 'sub' claim - unique identifier from Auth0",
               existing_comment="Auth0 'sub' claim - NULL for users created via Clerk (dropped in M6b)")
    op.drop_column('users', 'external_auth_id')
