"""add gpu pool tables

Revision ID: 0009_gpu_pool
Revises: 0008_model_thinking_enabled
Create Date: 2026-05-24
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0009_gpu_pool"
down_revision = "0008_model_thinking_enabled"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "gpu_pools",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_gpu_pools_id"), "gpu_pools", ["id"], unique=False)

    op.create_table(
        "gpu_pool_devices",
        sa.Column("pool_id", sa.Integer(), nullable=False),
        sa.Column("device_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["device_id"], ["devices.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["pool_id"], ["gpu_pools.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("pool_id", "device_id"),
    )

    op.add_column(
        "model_configs",
        sa.Column("pinned_pool_id", sa.Integer(), sa.ForeignKey("gpu_pools.id"), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("model_configs", "pinned_pool_id")
    op.drop_table("gpu_pool_devices")
    op.drop_index(op.f("ix_gpu_pools_id"), table_name="gpu_pools")
    op.drop_table("gpu_pools")
