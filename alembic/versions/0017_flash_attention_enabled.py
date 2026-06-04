"""add flash_attention_enabled to model_configs

Revision ID: 0017_flash_attention_enabled
Revises: 0016_tool_usage_limits
Create Date: 2026-06-03 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "0017_flash_attention_enabled"
down_revision: str | None = "0016_tool_usage_limits"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("model_configs", sa.Column("flash_attention_enabled", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    op.drop_column("model_configs", "flash_attention_enabled")
