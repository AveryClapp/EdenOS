"""add cal_source to schedule_blocks

Revision ID: a7b8c9d0e1f2
Revises: f6a7b8c9d0e1
Create Date: 2026-03-26

"""
from alembic import op
import sqlalchemy as sa

revision = 'a7b8c9d0e1f2'
down_revision = 'f6a7b8c9d0e1'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('schedule_blocks') as batch_op:
        batch_op.add_column(sa.Column('cal_source', sa.String(20), nullable=True))


def downgrade():
    with op.batch_alter_table('schedule_blocks') as batch_op:
        batch_op.drop_column('cal_source')
