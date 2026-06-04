"""add tool usage limits to app_settings and tool_calls to token_usage

Revision ID: 0016_tool_usage_limits
Revises: 0015_remove_usage_fallback_model
Create Date: 2026-06-03 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "0016_tool_usage_limits"
down_revision: str | None = "0015_remove_usage_fallback_model"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("app_settings", sa.Column("usage_limit_tools_60_minutes", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("app_settings", sa.Column("usage_limit_tools_24_hours", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("app_settings", sa.Column("usage_limit_tools_7_days", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("app_settings", sa.Column("usage_limit_tools_30_days", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("token_usage", sa.Column("tool_calls", sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    op.drop_column("token_usage", "tool_calls")
    op.drop_column("app_settings", "usage_limit_tools_30_days")
    op.drop_column("app_settings", "usage_limit_tools_7_days")
    op.drop_column("app_settings", "usage_limit_tools_24_hours")
    op.drop_column("app_settings", "usage_limit_tools_60_minutes")
