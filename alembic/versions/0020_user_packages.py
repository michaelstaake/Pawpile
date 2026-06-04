"""add user packages for usage limits

Revision ID: 0020_user_packages
Revises: 0019_terms_and_policies
Create Date: 2026-06-04 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0020_user_packages"
down_revision: str | None = "0019_terms_and_policies"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
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

    # Insert the Unlimited package (for admins - all limits = 0 means unlimited)
    op.execute(
        "INSERT INTO packages (id, name, is_admin_package, "
        "usage_limit_tokens_60_minutes, usage_limit_tokens_24_hours, "
        "usage_limit_tokens_7_days, usage_limit_tokens_30_days, "
        "usage_limit_tools_60_minutes, usage_limit_tools_24_hours, "
        "usage_limit_tools_7_days, usage_limit_tools_30_days) "
        "VALUES (1, 'Unlimited', 1, 0, 0, 0, 0, 0, 0, 0, 0)"
    )

    # Insert the Default package (for standard users - all limits = 0 means unlimited until configured)
    op.execute(
        "INSERT INTO packages (id, name, is_admin_package, "
        "usage_limit_tokens_60_minutes, usage_limit_tokens_24_hours, "
        "usage_limit_tokens_7_days, usage_limit_tokens_30_days, "
        "usage_limit_tools_60_minutes, usage_limit_tools_24_hours, "
        "usage_limit_tools_7_days, usage_limit_tools_30_days) "
        "VALUES (2, 'Default', 0, 0, 0, 0, 0, 0, 0, 0, 0)"
    )

    # Add package_id to users table
    op.add_column(
        "users",
        sa.Column("package_id", sa.Integer(), nullable=True),
    )

    # Assign admin users to the Unlimited package (id=1)
    op.execute(
        "UPDATE users SET package_id = 1 WHERE is_admin = 1"
    )

    # Assign non-admin users to the Default package (id=2)
    op.execute(
        "UPDATE users SET package_id = 2 WHERE is_admin = 0 AND package_id IS NULL"
    )

    # Add foreign key constraint
    op.create_foreign_key(
        "fk_users_package_id_packages",
        "users",
        "packages",
        ["package_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_users_package_id_packages", "users", type_="foreignkey")
    op.drop_column("users", "package_id")
    op.drop_table("packages")
