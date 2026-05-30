"""add token usage table

Revision ID: 0006_token_usage
Revises: 0005_background_theme_settings
Create Date: 2026-05-30 00:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0006_token_usage"
down_revision: str | None = "0005_background_theme_settings"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "token_usage",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("input_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("output_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_token_usage_created_at"), "token_usage", ["created_at"], unique=False)
    op.create_index(op.f("ix_token_usage_id"), "token_usage", ["id"], unique=False)
    op.create_index(op.f("ix_token_usage_total_tokens"), "token_usage", ["total_tokens"], unique=False)
    op.create_index(op.f("ix_token_usage_user_id"), "token_usage", ["user_id"], unique=False)
    op.create_index("ix_token_usage_user_id_created_at", "token_usage", ["user_id", "created_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_token_usage_user_id_created_at", table_name="token_usage")
    op.drop_index(op.f("ix_token_usage_user_id"), table_name="token_usage")
    op.drop_index(op.f("ix_token_usage_total_tokens"), table_name="token_usage")
    op.drop_index(op.f("ix_token_usage_id"), table_name="token_usage")
    op.drop_index(op.f("ix_token_usage_created_at"), table_name="token_usage")
    op.drop_table("token_usage")