"""adaptive_scheduling

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-03-02

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'c3d4e5f6a7b8'
down_revision: Union[str, Sequence[str], None] = 'b2c3d4e5f6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'user_memory',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('category', sa.String(50), nullable=False),
        sa.Column('content', sa.String(2000), nullable=False),
        sa.Column('confidence', sa.Float(), nullable=False),
        sa.Column('source', sa.String(200), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.add_column('schedule_blocks', sa.Column('is_draft', sa.Boolean(), nullable=False, server_default='0'))
    op.add_column('user_profile', sa.Column('autonomy_level', sa.Integer(), nullable=False, server_default='2'))
    op.add_column('user_profile', sa.Column('planning_time', sa.String(5), nullable=False, server_default='21:00'))
    op.add_column('user_profile', sa.Column('planning_auto_lock_minutes', sa.Integer(), nullable=False, server_default='60'))


def downgrade() -> None:
    op.drop_column('user_profile', 'planning_auto_lock_minutes')
    op.drop_column('user_profile', 'planning_time')
    op.drop_column('user_profile', 'autonomy_level')
    op.drop_column('schedule_blocks', 'is_draft')
    op.drop_table('user_memory')
