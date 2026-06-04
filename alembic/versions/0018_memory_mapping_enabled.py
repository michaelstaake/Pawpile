"""add memory_mapping_enabled to model_configs

Revision ID: 0018_memory_mapping_enabled
Revises: 0017_flash_attention_enabled
Create Date: 2026-06-03 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "0018_memory_mapping_enabled"
down_revision: str | None = "0017_flash_attention_enabled"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "model_configs",
        sa.Column("memory_mapping_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
    )


def downgrade() -> None:
    op.drop_column("model_configs", "memory_mapping_enabled")
