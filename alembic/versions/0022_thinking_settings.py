"""add thinking capability and default_thinking_enabled to model_configs

Revision ID: 0022_thinking_settings
Revises: 0021_default_package_flag
Create Date: 2026-06-04 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "0022_thinking_settings"
down_revision: str | None = "0021_default_package_flag"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = inspect(conn)
    columns = {column["name"] for column in inspector.get_columns("model_configs")}

    if "default_thinking_enabled" not in columns:
        with op.batch_alter_table("model_configs") as batch_op:
            batch_op.add_column(
                sa.Column(
                    "default_thinking_enabled",
                    sa.Boolean(),
                    nullable=False,
                    server_default=sa.true(),
                )
            )

    if "thinking_capability" not in columns:
        with op.batch_alter_table("model_configs") as batch_op:
            batch_op.add_column(
                sa.Column(
                    "thinking_capability",
                    sa.String(length=16),
                    nullable=False,
                    server_default="auto",
                )
            )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = inspect(conn)
    columns = {column["name"] for column in inspector.get_columns("model_configs")}

    if "thinking_capability" in columns:
        with op.batch_alter_table("model_configs") as batch_op:
            batch_op.drop_column("thinking_capability")

    if "default_thinking_enabled" in columns:
        with op.batch_alter_table("model_configs") as batch_op:
            batch_op.drop_column("default_thinking_enabled")
