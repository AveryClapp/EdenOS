"""extensions

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-03-03
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'e5f6a7b8c9d0'
down_revision: Union[str, Sequence[str], None] = 'd4e5f6a7b8c9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('schedule_blocks', sa.Column('reasoning', sa.Text(), nullable=True))

    op.create_table(
        'plan_explanations',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('date', sa.Date(), nullable=False),
        sa.Column('summary', sa.Text(), nullable=False),
        sa.Column('full_reasoning', sa.Text(), nullable=False),  # JSON string
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )

    op.create_table(
        'rl_episodes',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('scheduled_at', sa.DateTime(), nullable=False),
        sa.Column('state', sa.Text(), nullable=False),   # JSON string
        sa.Column('action', sa.Text(), nullable=False),  # JSON string
        sa.Column('reward', sa.Float(), nullable=True),
        sa.Column('reward_computed_at', sa.DateTime(), nullable=True),
        sa.Column('episode_complete', sa.Boolean(), nullable=False, server_default='0'),
        sa.PrimaryKeyConstraint('id'),
    )


def downgrade() -> None:
    op.drop_table('rl_episodes')
    op.drop_table('plan_explanations')
    op.drop_column('schedule_blocks', 'reasoning')
