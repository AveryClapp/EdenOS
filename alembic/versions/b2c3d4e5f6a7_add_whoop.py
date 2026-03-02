"""add_whoop

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-03-02

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'b2c3d4e5f6a7'
down_revision: Union[str, Sequence[str], None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'whoop_tokens',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('access_token', sa.String(2000), nullable=False),
        sa.Column('refresh_token', sa.String(2000), nullable=False),
        sa.Column('token_type', sa.String(50), nullable=False),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.Column('scope', sa.String(500), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_table(
        'whoop_daily',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('date', sa.Date(), nullable=False),
        sa.Column('recovery_score', sa.Integer(), nullable=True),
        sa.Column('hrv_rms', sa.Float(), nullable=True),
        sa.Column('resting_hr', sa.Integer(), nullable=True),
        sa.Column('sleep_quality_score', sa.Integer(), nullable=True),
        sa.Column('actual_wake_time', sa.DateTime(), nullable=True),
        sa.Column('strain_score', sa.Float(), nullable=True),
        sa.Column('synced_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('date'),
    )


def downgrade() -> None:
    op.drop_table('whoop_daily')
    op.drop_table('whoop_tokens')
