"""persist chat message metadata

Revision ID: 0013_chat_message_metadata
Revises: 0012_device_stable_hardware_id
Create Date: 2026-05-26
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect as sa_inspect

# revision identifiers, used by Alembic.
revision = "0013_chat_message_metadata"
down_revision = "0012_device_stable_hardware_id"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    existing = {col["name"] for col in sa_inspect(bind).get_columns("chat_messages")}
    new_cols = [
        ("model_name",        sa.Column("model_name",        sa.String(length=120), nullable=True)),
        ("prompt_tokens",     sa.Column("prompt_tokens",     sa.Integer(),          nullable=True)),
        ("completion_tokens", sa.Column("completion_tokens", sa.Integer(),          nullable=True)),
        ("total_tokens",      sa.Column("total_tokens",      sa.Integer(),          nullable=True)),
        ("elapsed_seconds",   sa.Column("elapsed_seconds",   sa.Float(),            nullable=True)),
        ("tokens_per_second", sa.Column("tokens_per_second", sa.Float(),            nullable=True)),
    ]
    cols_to_add = [col_def for col_name, col_def in new_cols if col_name not in existing]
    if cols_to_add:
        with op.batch_alter_table("chat_messages") as batch_op:
            for col in cols_to_add:
                batch_op.add_column(col)


def downgrade() -> None:
    with op.batch_alter_table("chat_messages") as batch_op:
        batch_op.drop_column("tokens_per_second")
        batch_op.drop_column("elapsed_seconds")
        batch_op.drop_column("total_tokens")
        batch_op.drop_column("completion_tokens")
        batch_op.drop_column("prompt_tokens")
        batch_op.drop_column("model_name")