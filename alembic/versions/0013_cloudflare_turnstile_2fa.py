"""add cloudflare turnstile and 2fa settings to app_settings

Revision ID: 0013_cloudflare_turnstile_2fa
Revises: 0012_ssl_settings
Create Date: 2026-06-03 00:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0013_cloudflare_turnstile_2fa"
down_revision: str | None = "0012_ssl_settings"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "app_settings",
        sa.Column("cloudflare_turnstile_enabled", sa.Boolean(), nullable=False, server_default="0"),
    )
    op.add_column(
        "app_settings",
        sa.Column("cloudflare_turnstile_site_key", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "app_settings",
        sa.Column("cloudflare_turnstile_secret_key", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "app_settings",
        sa.Column("two_factor_enabled", sa.Boolean(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("app_settings", "two_factor_enabled")
    op.drop_column("app_settings", "cloudflare_turnstile_secret_key")
    op.drop_column("app_settings", "cloudflare_turnstile_site_key")
    op.drop_column("app_settings", "cloudflare_turnstile_enabled")
