"""add user consents table

Revision ID: 18a484989bf0
Revises: abefe96a197f
Create Date: 2025-12-20 15:52:40.160923

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '18a484989bf0'
down_revision: Union[str, Sequence[str], None] = 'abefe96a197f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Create user_consents table
    op.create_table(
        'user_consents',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False,
                  comment='Foreign key to users table - one consent record per user'),
        sa.Column('consented_at', sa.TIMESTAMP(timezone=True), nullable=False,
                  comment='Timestamp when user accepted the terms'),
        sa.Column('privacy_policy_version', sa.String(length=50), nullable=False,
                  comment="Version of privacy policy accepted (e.g., '2024-12-20')"),
        sa.Column('terms_of_service_version', sa.String(length=50), nullable=False,
                  comment="Version of terms of service accepted (e.g., '2024-12-20')"),
        sa.Column('ip_address', sa.String(length=45), nullable=True,
                  comment='IP address at time of consent (for legal proof)'),
        sa.Column('user_agent', sa.Text(), nullable=True,
                  comment='Browser user agent at time of consent (for legal proof)'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id')
    )
    op.create_index(op.f('ix_user_consents_user_id'), 'user_consents', ['user_id'], unique=True)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_user_consents_user_id'), table_name='user_consents')
    op.drop_table('user_consents')
