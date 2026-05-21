"""add per-model tool calling flag

Revision ID: 0006_model_tool_calling_enabled
Revises: 0005_add_sitename_setting
Create Date: 2026-05-21
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0006_model_tool_calling_enabled"
down_revision = "0005_add_sitename_setting"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "model_configs",
        sa.Column("tool_calling_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.alter_column("model_configs", "tool_calling_enabled", server_default=None)


def downgrade() -> None:
    op.drop_column("model_configs", "tool_calling_enabled")