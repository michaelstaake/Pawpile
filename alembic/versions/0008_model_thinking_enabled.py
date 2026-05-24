"""add per-model thinking enabled flag

Revision ID: 0008_model_thinking_enabled
Revises: 0007_activity_log
Create Date: 2026-05-23
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0008_model_thinking_enabled"
down_revision = "0007_activity_log"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "model_configs",
        sa.Column("thinking_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.alter_column("model_configs", "thinking_enabled", server_default=None)


def downgrade() -> None:
    op.drop_column("model_configs", "thinking_enabled")
