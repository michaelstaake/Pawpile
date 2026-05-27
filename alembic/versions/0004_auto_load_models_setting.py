"""add auto load models startup setting

Revision ID: 0004_auto_load_models_setting
Revises: 0003_model_priority
Create Date: 2026-05-21
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect as sa_inspect

# revision identifiers, used by Alembic.
revision = "0004_auto_load_models_setting"
down_revision = "0003_model_priority"
branch_labels = None
depends_on = None


def upgrade() -> None:
    existing = {col["name"] for col in sa_inspect(op.get_bind()).get_columns("app_settings")}
    if "auto_load_enabled_models_on_startup" not in existing:
        op.add_column(
            "app_settings",
            sa.Column("auto_load_enabled_models_on_startup", sa.Boolean(), nullable=False, server_default=sa.false()),
        )
        op.execute("UPDATE app_settings SET auto_load_enabled_models_on_startup = 0 WHERE auto_load_enabled_models_on_startup IS NULL")


def downgrade() -> None:
    op.drop_column("app_settings", "auto_load_enabled_models_on_startup")