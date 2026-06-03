"""migrate gpu pool split_mode from row to layer

Revision ID: 0011_gpu_pool_split_mode_layer
Revises: 0010_gpu_pool_split_mode
Create Date: 2026-06-03 00:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0011_gpu_pool_split_mode_layer"
down_revision: str | None = "0010_gpu_pool_split_mode"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute(sa.text("UPDATE gpu_pools SET split_mode = 'layer' WHERE split_mode = 'row'"))
    op.alter_column("gpu_pools", "split_mode", server_default="layer")


def downgrade() -> None:
    op.alter_column("gpu_pools", "split_mode", server_default="row")
