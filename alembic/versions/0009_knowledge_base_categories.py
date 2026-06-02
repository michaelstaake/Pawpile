"""add knowledge base categories

Revision ID: 0009_knowledge_base_categories
Revises: 0008_cost_pricing
Create Date: 2026-06-02 00:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0009_knowledge_base_categories"
down_revision: str | None = "0008_cost_pricing"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    # Create categories table
    op.create_table(
        "knowledge_base_categories",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default="f"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_knowledge_base_categories_id"), "knowledge_base_categories", ["id"], unique=False)
    op.create_index(op.f("ix_knowledge_base_categories_user_id"), "knowledge_base_categories", ["user_id"], unique=False)

    # Add category_id to documents
    op.add_column(
        "knowledge_base_documents",
        sa.Column("category_id", sa.Integer(), nullable=True),
    )
    op.create_index(op.f("ix_knowledge_base_documents_category_id"), "knowledge_base_documents", ["category_id"], unique=False)
    op.create_foreign_key(
        "fk_knowledge_base_documents_category_id",
        "knowledge_base_documents",
        "knowledge_base_categories",
        ["category_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # Create a Default category for each existing user and assign their documents to it
    conn = op.get_bind()
    users = conn.execute(sa.text("SELECT id FROM users")).fetchall()
    default_category_ids = {}

    for user in users:
        user_id = user[0]
        result = conn.execute(
            sa.text(
                "INSERT INTO knowledge_base_categories (user_id, name, is_default) "
                "VALUES (:user_id, 'Default', true) RETURNING id"
            ).bindparams(user_id=user_id)
        )
        cat_id = result.fetchone()[0]
        default_category_ids[user_id] = cat_id

    # Assign existing documents to their user's Default category
    for user_id, cat_id in default_category_ids.items():
        conn.execute(
            sa.text(
                "UPDATE knowledge_base_documents SET category_id = :cat_id WHERE user_id = :user_id AND category_id IS NULL"
            ).bindparams(cat_id=cat_id, user_id=user_id)
        )


def downgrade() -> None:
    op.drop_column("knowledge_base_documents", "category_id")
    op.drop_index(op.f("ix_knowledge_base_documents_category_id"), table_name="knowledge_base_documents")
    op.drop_index(op.f("ix_knowledge_base_categories_user_id"), table_name="knowledge_base_categories")
    op.drop_index(op.f("ix_knowledge_base_categories_id"), table_name="knowledge_base_categories")
    op.drop_table("knowledge_base_categories")
