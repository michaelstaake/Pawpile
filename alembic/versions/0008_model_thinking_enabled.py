"""add per-model thinking enabled flag

Revision ID: 0008_model_thinking_enabled
Revises: 0007_activity_log
Create Date: 2026-05-23
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect as sa_inspect

# revision identifiers, used by Alembic.
revision = "0008_model_thinking_enabled"
down_revision = "0007_activity_log"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    existing = {col["name"] for col in sa_inspect(bind).get_columns("model_configs")}
    if "thinking_enabled" not in existing:
        with op.batch_alter_table("model_configs") as batch_op:
            batch_op.add_column(sa.Column("thinking_enabled", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    op.drop_column("model_configs", "thinking_enabled")
