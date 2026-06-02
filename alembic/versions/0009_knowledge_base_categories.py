"""add knowledge base categories

Revision ID: 0009_knowledge_base_categories
Revises: 0008_cost_pricing
Create Date: 2026-06-02 00:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "0009_knowledge_base_categories"
down_revision: str | None = "0008_cost_pricing"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = inspect(conn)

    # A prior failed SQLite migration can leave this revision partially applied.
    existing_tables = set(inspector.get_table_names())

    if "knowledge_base_categories" not in existing_tables:
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
        existing_tables.add("knowledge_base_categories")

    category_indexes = {index["name"] for index in inspector.get_indexes("knowledge_base_categories")}
    if op.f("ix_knowledge_base_categories_id") not in category_indexes:
        op.create_index(op.f("ix_knowledge_base_categories_id"), "knowledge_base_categories", ["id"], unique=False)
    if op.f("ix_knowledge_base_categories_user_id") not in category_indexes:
        op.create_index(op.f("ix_knowledge_base_categories_user_id"), "knowledge_base_categories", ["user_id"], unique=False)

    document_columns = {column["name"] for column in inspector.get_columns("knowledge_base_documents")}
    document_indexes = {index["name"] for index in inspector.get_indexes("knowledge_base_documents")}
    document_foreign_keys = {foreign_key.get("name") for foreign_key in inspector.get_foreign_keys("knowledge_base_documents")}

    if (
        "category_id" not in document_columns
        or op.f("ix_knowledge_base_documents_category_id") not in document_indexes
        or "fk_knowledge_base_documents_category_id" not in document_foreign_keys
    ):
        with op.batch_alter_table("knowledge_base_documents") as batch_op:
            if "category_id" not in document_columns:
                batch_op.add_column(sa.Column("category_id", sa.Integer(), nullable=True))
            if op.f("ix_knowledge_base_documents_category_id") not in document_indexes:
                batch_op.create_index(op.f("ix_knowledge_base_documents_category_id"), ["category_id"], unique=False)
            if "fk_knowledge_base_documents_category_id" not in document_foreign_keys:
                batch_op.create_foreign_key(
                    "fk_knowledge_base_documents_category_id",
                    "knowledge_base_categories",
                    ["category_id"],
                    ["id"],
                    ondelete="SET NULL",
                )

    # Create a Default category for each existing user and assign their documents to it.
    users = conn.execute(sa.text("SELECT id FROM users")).fetchall()
    default_category_ids = {}

    for user in users:
        user_id = user[0]
        existing_default = conn.execute(
            sa.text(
                "SELECT id FROM knowledge_base_categories "
                "WHERE user_id = :user_id AND is_default = true LIMIT 1"
            ).bindparams(user_id=user_id)
        ).fetchone()
        if existing_default is not None:
            default_category_ids[user_id] = existing_default[0]
            continue

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
    with op.batch_alter_table("knowledge_base_documents") as batch_op:
        batch_op.drop_constraint("fk_knowledge_base_documents_category_id", type_="foreignkey")
        batch_op.drop_index(op.f("ix_knowledge_base_documents_category_id"))
        batch_op.drop_column("category_id")
    op.drop_index(op.f("ix_knowledge_base_categories_user_id"), table_name="knowledge_base_categories")
    op.drop_index(op.f("ix_knowledge_base_categories_id"), table_name="knowledge_base_categories")
    op.drop_table("knowledge_base_categories")
