"""persist chat message metadata

Revision ID: 0013_chat_message_metadata
Revises: 0012_device_stable_hardware_id
Create Date: 2026-05-26
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0013_chat_message_metadata"
down_revision = "0012_device_stable_hardware_id"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("chat_messages") as batch_op:
        batch_op.add_column(sa.Column("model_name", sa.String(length=120), nullable=True))
        batch_op.add_column(sa.Column("prompt_tokens", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("completion_tokens", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("total_tokens", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("elapsed_seconds", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("tokens_per_second", sa.Float(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("chat_messages") as batch_op:
        batch_op.drop_column("tokens_per_second")
        batch_op.drop_column("elapsed_seconds")
        batch_op.drop_column("total_tokens")
        batch_op.drop_column("completion_tokens")
        batch_op.drop_column("prompt_tokens")
        batch_op.drop_column("model_name")