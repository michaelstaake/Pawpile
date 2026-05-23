"""add activity_logs table

Revision ID: 0007_activity_log
Revises: 0006_model_tool_calling_enabled
Create Date: 2026-05-23
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0007_activity_log"
down_revision = "0006_model_tool_calling_enabled"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "activity_logs",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("event_type", sa.String(64), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("username", sa.String(120), nullable=True),
        sa.Column("ip_address", sa.String(45), nullable=True),
        sa.Column("details", sa.Text(), nullable=True),
    )
    op.create_index("ix_activity_logs_created_at", "activity_logs", ["created_at"])
    op.create_index("ix_activity_logs_event_type", "activity_logs", ["event_type"])


def downgrade() -> None:
    op.drop_index("ix_activity_logs_event_type", table_name="activity_logs")
    op.drop_index("ix_activity_logs_created_at", table_name="activity_logs")
    op.drop_table("activity_logs")
