"""add calendar tokens

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-03-14
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'f6a7b8c9d0e1'
down_revision: Union[str, Sequence[str], None] = 'e5f6a7b8c9d0'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'gcal_tokens',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('access_token', sa.String(2000), nullable=False),
        sa.Column('refresh_token', sa.String(2000), nullable=False),
        sa.Column('token_type', sa.String(50), nullable=False),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.Column('scope', sa.String(500), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )

    op.create_table(
        'outlook_tokens',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('access_token', sa.String(2000), nullable=False),
        sa.Column('refresh_token', sa.String(2000), nullable=False),
        sa.Column('token_type', sa.String(50), nullable=False),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.Column('scope', sa.String(500), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )

    # Extend task_source enum to include "outlook"
    # batch_alter_table is required for SQLite column modifications
    with op.batch_alter_table('tasks') as batch_op:
        batch_op.alter_column(
            'source',
            type_=sa.Enum('manual', 'github', 'gcal', 'outlook', name='task_source'),
            existing_type=sa.Enum('manual', 'github', 'gcal', name='task_source'),
            existing_nullable=False,
        )


def downgrade() -> None:
    with op.batch_alter_table('tasks') as batch_op:
        batch_op.alter_column(
            'source',
            type_=sa.Enum('manual', 'github', 'gcal', name='task_source'),
            existing_type=sa.Enum('manual', 'github', 'gcal', 'outlook', name='task_source'),
            existing_nullable=False,
        )

    op.drop_table('outlook_tokens')
    op.drop_table('gcal_tokens')
