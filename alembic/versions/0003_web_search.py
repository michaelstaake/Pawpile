"""add web search providers

Revision ID: 0003_web_search
Revises: 0002_add_api_key_last_used_at
Create Date: 2026-05-28 00:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0003_web_search"
down_revision: str | None = "0002_add_api_key_last_used_at"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "web_search_providers",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("provider_type", sa.String(64), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("api_key", sa.Text(), nullable=True),
        sa.Column("result_count", sa.Integer(), nullable=False, server_default="5"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("provider_type"),
    )
    op.create_index("ix_web_search_providers_id", "web_search_providers", ["id"])

    op.add_column(
        "model_configs",
        sa.Column("web_search_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "app_settings",
        sa.Column("active_web_search_provider_id", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("app_settings", "active_web_search_provider_id")
    op.drop_column("model_configs", "web_search_enabled")
    op.drop_index("ix_web_search_providers_id", table_name="web_search_providers")
    op.drop_table("web_search_providers")
