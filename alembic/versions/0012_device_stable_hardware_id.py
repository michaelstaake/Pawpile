"""add stable hardware identifier fields to devices

Revision ID: 0012_device_stable_hardware_id
Revises: 0011_remove_auto_load_models_setting
Create Date: 2026-05-26
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect as sa_inspect

# revision identifiers, used by Alembic.
revision = "0012_device_stable_hardware_id"
down_revision = "0011_remove_auto_load_models_setting"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    existing = {col["name"] for col in sa_inspect(bind).get_columns("devices")}
    cols_to_add = []
    if "stable_hardware_id" not in existing:
        cols_to_add.append(sa.Column("stable_hardware_id", sa.String(length=160), nullable=True))
    if "stable_hardware_id_source" not in existing:
        cols_to_add.append(sa.Column("stable_hardware_id_source", sa.String(length=32), nullable=True))
    if cols_to_add:
        with op.batch_alter_table("devices") as batch_op:
            for col in cols_to_add:
                batch_op.add_column(col)


def downgrade() -> None:
    with op.batch_alter_table("devices") as batch_op:
        batch_op.drop_column("stable_hardware_id_source")
        batch_op.drop_column("stable_hardware_id")