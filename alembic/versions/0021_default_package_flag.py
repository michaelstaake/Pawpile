"""add is_default_package flag to protect Default package

Revision ID: 0021_default_package_flag
Revises: 0020_user_packages
Create Date: 2026-06-04 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision: str = "0021_default_package_flag"
down_revision: str | None = "0020_user_packages"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = inspect(conn)

    if "is_default_package" not in set(
        column["name"] for column in inspector.get_columns("packages")
    ):
        with op.batch_alter_table("packages") as batch_op:
            batch_op.add_column(
                sa.Column(
                    "is_default_package",
                    sa.Boolean(),
                    nullable=False,
                    server_default=sa.false(),
                )
            )

    conn.execute(
        sa.text(
            "UPDATE packages SET is_default_package = 1 WHERE name = 'Default' AND is_default_package = 0"
        )
    )

    if conn.execute(sa.text("SELECT id FROM packages WHERE id = 2")).first() is None:
        conn.execute(
            sa.text(
                "INSERT INTO packages (id, name, is_admin_package, is_default_package, "
                "usage_limit_tokens_60_minutes, usage_limit_tokens_24_hours, "
                "usage_limit_tokens_7_days, usage_limit_tokens_30_days, "
                "usage_limit_tools_60_minutes, usage_limit_tools_24_hours, "
                "usage_limit_tools_7_days, usage_limit_tools_30_days) "
                "VALUES (2, 'Default', 0, 1, 0, 0, 0, 0, 0, 0, 0, 0)"
            )
        )


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(sa.text("UPDATE packages SET is_default_package = 0 WHERE name = 'Default'"))

    if "is_default_package" in set(
        column["name"] for column in inspect(conn).get_columns("packages")
    ):
        with op.batch_alter_table("packages") as batch_op:
            batch_op.drop_column("is_default_package")
