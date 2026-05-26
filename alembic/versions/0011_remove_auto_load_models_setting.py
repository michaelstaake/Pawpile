"""remove auto load models startup setting

Revision ID: 0011_remove_auto_load_models_setting
Revises: 0010_gpu_pool_vendor
Create Date: 2026-05-26
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0011_remove_auto_load_models_setting"
down_revision = "0010_gpu_pool_vendor"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("app_settings") as batch_op:
        batch_op.drop_column("auto_load_enabled_models_on_startup")


def downgrade() -> None:
    op.add_column(
        "app_settings",
        sa.Column("auto_load_enabled_models_on_startup", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.execute("UPDATE app_settings SET auto_load_enabled_models_on_startup = 0 WHERE auto_load_enabled_models_on_startup IS NULL")
    op.alter_column("app_settings", "auto_load_enabled_models_on_startup", server_default=None)
