"""add ssl and letsencrypt settings to app_settings

Revision ID: 0012_ssl_settings
Revises: 0011_gpu_pool_split_mode_layer
Create Date: 2026-06-03 00:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0012_ssl_settings"
down_revision: str | None = "0011_gpu_pool_split_mode_layer"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "app_settings",
        sa.Column("public_url", sa.String(length=512), nullable=False, server_default=""),
    )
    op.add_column(
        "app_settings",
        sa.Column("letsencrypt_email", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "app_settings",
        sa.Column("cloudflare_api_token", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("app_settings", "cloudflare_api_token")
    op.drop_column("app_settings", "letsencrypt_email")
    op.drop_column("app_settings", "public_url")
