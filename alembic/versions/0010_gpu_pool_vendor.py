"""add gpu pool vendor

Revision ID: 0010_gpu_pool_vendor
Revises: 0009_gpu_pool
Create Date: 2026-05-26
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0010_gpu_pool_vendor"
down_revision = "0009_gpu_pool"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "gpu_pools",
        sa.Column("vendor", sa.String(length=32), nullable=True),
    )
    op.execute("UPDATE gpu_pools SET vendor = 'nvidia' WHERE vendor IS NULL")
    op.alter_column("gpu_pools", "vendor", existing_type=sa.String(length=32), nullable=False)


def downgrade() -> None:
    op.drop_column("gpu_pools", "vendor")