"""add model priority

Revision ID: 0003_model_priority
Revises: 0002_app_settings
Create Date: 2026-05-20
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0003_model_priority"
down_revision = "0002_app_settings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("model_configs", sa.Column("priority", sa.Integer(), nullable=True))

    model_configs = sa.table(
        "model_configs",
        sa.column("id", sa.Integer()),
        sa.column("priority", sa.Integer()),
    )

    connection = op.get_bind()
    rows = connection.execute(sa.select(model_configs.c.id).order_by(model_configs.c.id.asc())).fetchall()
    for index, row in enumerate(rows):
        connection.execute(
            model_configs.update().where(model_configs.c.id == row.id).values(priority=index)
        )

    op.alter_column("model_configs", "priority", nullable=False)


def downgrade() -> None:
    op.drop_column("model_configs", "priority")