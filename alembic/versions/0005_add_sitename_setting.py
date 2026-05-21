"""add sitename setting

Revision ID: 0005_add_sitename_setting
Revises: 0004_auto_load_models_setting
Create Date: 2026-05-21
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0005_add_sitename_setting"
down_revision = "0004_auto_load_models_setting"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "app_settings",
        sa.Column("sitename", sa.String(length=255), nullable=False, server_default="Pawpile"),
    )
    op.alter_column("app_settings", "sitename", server_default=None)


def downgrade() -> None:
    op.drop_column("app_settings", "sitename")