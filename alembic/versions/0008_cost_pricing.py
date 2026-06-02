"""add cost pricing settings to app_settings

Revision ID: 0008_cost_pricing
Revises: 0007_knowledge_base
Create Date: 2026-06-02 00:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0008_cost_pricing"
down_revision: str | None = "0007_knowledge_base"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "app_settings",
        sa.Column("input_price_per_1m", sa.Float(), nullable=False, server_default="0"),
    )
    op.add_column(
        "app_settings",
        sa.Column("output_price_per_1m", sa.Float(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("app_settings", "output_price_per_1m")
    op.drop_column("app_settings", "input_price_per_1m")
