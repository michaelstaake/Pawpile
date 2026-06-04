"""add terms settings and acceptance

Revision ID: 0019_terms_and_policies
Revises: 0018_memory_mapping_enabled
Create Date: 2026-06-04 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "0019_terms_and_policies"
down_revision: str | None = "0018_memory_mapping_enabled"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("terms_accepted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "app_settings",
        sa.Column("terms_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "app_settings",
        sa.Column("terms_content", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("app_settings", "terms_content")
    op.drop_column("app_settings", "terms_enabled")
    op.drop_column("users", "terms_accepted_at")
