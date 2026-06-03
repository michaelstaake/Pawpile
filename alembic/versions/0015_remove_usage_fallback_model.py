"""remove usage fallback model from app_settings

Revision ID: 0015_remove_usage_fallback_model
Revises: 0014_usage_limits
Create Date: 2026-06-03 00:00:00.000000
"""

from collections.abc import Sequence

from alembic import op


revision: str = "0015_remove_usage_fallback_model"
down_revision: str | None = "0014_usage_limits"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column("app_settings", "usage_fallback_model_alias")


def downgrade() -> None:
    import sqlalchemy as sa

    op.add_column(
        "app_settings",
        sa.Column("usage_fallback_model_alias", sa.String(255), nullable=True),
    )
