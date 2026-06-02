"""add knowledge base tables and settings

Revision ID: 0007_knowledge_base
Revises: 0006_token_usage
Create Date: 2026-06-01 00:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0007_knowledge_base"
down_revision: str | None = "0006_token_usage"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    # Add rag_enabled column to model_configs
    op.add_column(
        "model_configs",
        sa.Column("rag_enabled", sa.Boolean(), nullable=False, server_default="false"),
    )

    # Add knowledge_base_enabled column to app_settings
    op.add_column(
        "app_settings",
        sa.Column("knowledge_base_enabled", sa.Boolean(), nullable=False, server_default="false"),
    )

    # Create knowledge_base_documents table
    op.create_table(
        "knowledge_base_documents",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("content", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_knowledge_base_documents_id"), "knowledge_base_documents", ["id"], unique=False)
    op.create_index(op.f("ix_knowledge_base_documents_user_id"), "knowledge_base_documents", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_knowledge_base_documents_user_id"), table_name="knowledge_base_documents")
    op.drop_index(op.f("ix_knowledge_base_documents_id"), table_name="knowledge_base_documents")
    op.drop_table("knowledge_base_documents")
    op.drop_column("app_settings", "knowledge_base_enabled")
    op.drop_column("model_configs", "rag_enabled")
