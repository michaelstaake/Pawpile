"""add usage limit settings to app_settings

Revision ID: 0014_usage_limits
Revises: 0013_cloudflare_turnstile_2fa
Create Date: 2026-06-03 00:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0014_usage_limits"
down_revision: str | None = "0013_cloudflare_turnstile_2fa"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "app_settings",
        sa.Column("usage_limit_tokens_60_minutes", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "app_settings",
        sa.Column("usage_limit_tokens_24_hours", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "app_settings",
        sa.Column("usage_limit_tokens_7_days", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "app_settings",
        sa.Column("usage_limit_tokens_30_days", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "app_settings",
        sa.Column("usage_fallback_model_alias", sa.String(255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("app_settings", "usage_fallback_model_alias")
    op.drop_column("app_settings", "usage_limit_tokens_30_days")
    op.drop_column("app_settings", "usage_limit_tokens_7_days")
    op.drop_column("app_settings", "usage_limit_tokens_24_hours")
    op.drop_column("app_settings", "usage_limit_tokens_60_minutes")
