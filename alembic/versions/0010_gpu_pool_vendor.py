"""add gpu pool vendor

Revision ID: 0010_gpu_pool_vendor
Revises: 0009_gpu_pool
Create Date: 2026-05-26
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect as sa_inspect

# revision identifiers, used by Alembic.
revision = "0010_gpu_pool_vendor"
down_revision = "0009_gpu_pool"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    existing = {col["name"] for col in sa_inspect(bind).get_columns("gpu_pools")}
    if "vendor" not in existing:
        with op.batch_alter_table("gpu_pools") as batch_op:
            batch_op.add_column(sa.Column("vendor", sa.String(length=32), nullable=False, server_default=sa.text("'nvidia'")))
        op.execute("UPDATE gpu_pools SET vendor = 'nvidia' WHERE vendor IS NULL")


def downgrade() -> None:
    op.drop_column("gpu_pools", "vendor")