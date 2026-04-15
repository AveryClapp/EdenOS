"""extend user_memory with observation_count and updated_at

Revision ID: h8i9j0k1l2m3
Revises: g7h8i9j0k1l2
Create Date: 2026-04-14
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'h8i9j0k1l2m3'
down_revision: Union[str, Sequence[str], None] = 'g7h8i9j0k1l2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('user_memory') as batch_op:
        batch_op.add_column(sa.Column('updated_at', sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column('observation_count', sa.Integer(), nullable=False, server_default='1'))


def downgrade() -> None:
    with op.batch_alter_table('user_memory') as batch_op:
        batch_op.drop_column('observation_count')
        batch_op.drop_column('updated_at')
