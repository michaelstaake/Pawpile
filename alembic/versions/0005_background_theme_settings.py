"""add background theme settings

Revision ID: 0005_background_theme_settings
Revises: 0004_add_serper_provider
Create Date: 2026-05-29 00:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0005_background_theme_settings"
down_revision: str | None = "0004_add_serper_provider"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "app_settings",
        sa.Column("background_color", sa.String(length=7), nullable=False, server_default="#efe8d2"),
    )
    op.add_column(
        "app_settings",
        sa.Column("background_image_path", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "app_settings",
        sa.Column("background_image_mode", sa.String(length=16), nullable=False, server_default="fill"),
    )


def downgrade() -> None:
    op.drop_column("app_settings", "background_image_mode")
    op.drop_column("app_settings", "background_image_path")
    op.drop_column("app_settings", "background_color")