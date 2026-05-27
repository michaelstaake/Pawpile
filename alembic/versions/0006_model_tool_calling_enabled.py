"""add per-model tool calling flag

Revision ID: 0006_model_tool_calling_enabled
Revises: 0005_add_sitename_setting
Create Date: 2026-05-21
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect as sa_inspect

# revision identifiers, used by Alembic.
revision = "0006_model_tool_calling_enabled"
down_revision = "0005_add_sitename_setting"
branch_labels = None
depends_on = None


def upgrade() -> None:
    existing = {col["name"] for col in sa_inspect(op.get_bind()).get_columns("model_configs")}
    if "tool_calling_enabled" not in existing:
        op.add_column(
            "model_configs",
            sa.Column("tool_calling_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        )


def downgrade() -> None:
    op.drop_column("model_configs", "tool_calling_enabled")