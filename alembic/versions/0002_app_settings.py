"""add app settings

Revision ID: 0002_app_settings
Revises: 0001_initial
Create Date: 2026-05-20
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0002_app_settings"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "app_settings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("allow_anonymous_chat", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("users_can_register", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.PrimaryKeyConstraint("id"),
    )
    op.bulk_insert(
        sa.table(
            "app_settings",
            sa.column("id", sa.Integer()),
            sa.column("allow_anonymous_chat", sa.Boolean()),
            sa.column("users_can_register", sa.Boolean()),
        ),
        [{"id": 1, "allow_anonymous_chat": True, "users_can_register": False}],
    )


def downgrade() -> None:
    op.drop_table("app_settings")