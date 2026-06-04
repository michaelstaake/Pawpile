"""add user packages for usage limits

Revision ID: 0020_user_packages
Revises: 0019_terms_and_policies
Create Date: 2026-06-04 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision: str = "0020_user_packages"
down_revision: str | None = "0019_terms_and_policies"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def _seed_packages(conn) -> None:
    if conn.execute(sa.text("SELECT id FROM packages WHERE id = 1")).first() is None:
        conn.execute(
            sa.text(
                "INSERT INTO packages (id, name, is_admin_package, "
                "usage_limit_tokens_60_minutes, usage_limit_tokens_24_hours, "
                "usage_limit_tokens_7_days, usage_limit_tokens_30_days, "
                "usage_limit_tools_60_minutes, usage_limit_tools_24_hours, "
                "usage_limit_tools_7_days, usage_limit_tools_30_days) "
                "VALUES (1, 'Unlimited', 1, 0, 0, 0, 0, 0, 0, 0, 0)"
            )
        )
    if conn.execute(sa.text("SELECT id FROM packages WHERE id = 2")).first() is None:
        conn.execute(
            sa.text(
                "INSERT INTO packages (id, name, is_admin_package, "
                "usage_limit_tokens_60_minutes, usage_limit_tokens_24_hours, "
                "usage_limit_tokens_7_days, usage_limit_tokens_30_days, "
                "usage_limit_tools_60_minutes, usage_limit_tools_24_hours, "
                "usage_limit_tools_7_days, usage_limit_tools_30_days) "
                "VALUES (2, 'Default', 0, 0, 0, 0, 0, 0, 0, 0, 0)"
            )
        )


def upgrade() -> None:
    conn = op.get_bind()
    inspector = inspect(conn)

    # A prior failed SQLite migration can leave this revision partially applied.
    if "packages" not in set(inspector.get_table_names()):
        op.create_table(
            "packages",
            sa.Column("id", sa.Integer(), primary_key=True, index=True),
            sa.Column("name", sa.String(120), unique=True, nullable=False),
            sa.Column("is_admin_package", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("usage_limit_tokens_60_minutes", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("usage_limit_tokens_24_hours", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("usage_limit_tokens_7_days", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("usage_limit_tokens_30_days", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("usage_limit_tools_60_minutes", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("usage_limit_tools_24_hours", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("usage_limit_tools_7_days", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("usage_limit_tools_30_days", sa.Integer(), nullable=False, server_default="0"),
        )

    _seed_packages(conn)

    user_columns = {column["name"] for column in inspector.get_columns("users")}
    if "package_id" not in user_columns:
        op.add_column(
            "users",
            sa.Column("package_id", sa.Integer(), nullable=True),
        )

    conn.execute(sa.text("UPDATE users SET package_id = 1 WHERE is_admin = 1 AND package_id IS NULL"))
    conn.execute(
        sa.text("UPDATE users SET package_id = 2 WHERE is_admin = 0 AND package_id IS NULL")
    )

    user_foreign_keys = {foreign_key.get("name") for foreign_key in inspector.get_foreign_keys("users")}
    if "fk_users_package_id_packages" not in user_foreign_keys:
        with op.batch_alter_table("users") as batch_op:
            batch_op.create_foreign_key(
                "fk_users_package_id_packages",
                "packages",
                ["package_id"],
                ["id"],
                ondelete="SET NULL",
            )


def downgrade() -> None:
    user_foreign_keys = {foreign_key.get("name") for foreign_key in inspect(op.get_bind()).get_foreign_keys("users")}
    if "fk_users_package_id_packages" in user_foreign_keys:
        with op.batch_alter_table("users") as batch_op:
            batch_op.drop_constraint("fk_users_package_id_packages", type_="foreignkey")

    user_columns = {column["name"] for column in inspect(op.get_bind()).get_columns("users")}
    if "package_id" in user_columns:
        op.drop_column("users", "package_id")

    if "packages" in set(inspect(op.get_bind()).get_table_names()):
        op.drop_table("packages")
