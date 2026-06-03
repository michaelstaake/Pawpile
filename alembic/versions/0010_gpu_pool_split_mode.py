"""add split_mode to gpu_pools

Revision ID: 0010_gpu_pool_split_mode
Revises: 0009_knowledge_base_categories
Create Date: 2026-06-03 00:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0010_gpu_pool_split_mode"
down_revision: str | None = "0009_knowledge_base_categories"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "gpu_pools",
        sa.Column("split_mode", sa.String(length=16), nullable=False, server_default="row"),
    )


def downgrade() -> None:
    op.drop_column("gpu_pools", "split_mode")
