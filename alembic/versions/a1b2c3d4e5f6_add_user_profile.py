"""add_user_profile

Revision ID: a1b2c3d4e5f6
Revises: 0880ca2c0724
Create Date: 2026-03-02

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = '0880ca2c0724'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'user_profile',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('wake_hour', sa.Integer(), nullable=False),
        sa.Column('chronotype', sa.String(length=20), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )


def downgrade() -> None:
    op.drop_table('user_profile')
