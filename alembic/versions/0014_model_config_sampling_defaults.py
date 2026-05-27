"""add model config sampling defaults

Revision ID: 0014_model_config_sampling_defaults
Revises: 0013_chat_message_metadata
Create Date: 2026-05-26
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect as sa_inspect

# revision identifiers, used by Alembic.
revision = "0014_model_config_sampling_defaults"
down_revision = "0013_chat_message_metadata"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    existing = {col["name"] for col in sa_inspect(bind).get_columns("model_configs")}
    cols_to_add = []
    if "temperature" not in existing:
        cols_to_add.append(sa.Column("temperature", sa.Float(), nullable=False, server_default="0.7"))
    if "top_p" not in existing:
        cols_to_add.append(sa.Column("top_p", sa.Float(), nullable=False, server_default="0.95"))

    if cols_to_add:
        with op.batch_alter_table("model_configs") as batch_op:
            for col in cols_to_add:
                batch_op.add_column(col)


def downgrade() -> None:
    with op.batch_alter_table("model_configs") as batch_op:
        batch_op.drop_column("top_p")
        batch_op.drop_column("temperature")