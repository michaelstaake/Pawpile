"""add serper web search provider

Revision ID: 0004_add_serper_provider
Revises: 0003_web_search
Create Date: 2026-05-28 00:00:01.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0004_add_serper_provider"
down_revision: str | None = "0003_web_search"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    existing = bind.execute(
        sa.text(
            "SELECT 1 FROM web_search_providers WHERE provider_type = :provider_type"
        ),
        {"provider_type": "serper"},
    ).scalar()

    if existing is None:
        bind.execute(
            sa.text(
                """
                INSERT INTO web_search_providers (
                    provider_type,
                    enabled,
                    api_key,
                    result_count,
                    created_at,
                    updated_at
                ) VALUES (
                    :provider_type,
                    :enabled,
                    :api_key,
                    :result_count,
                    CURRENT_TIMESTAMP,
                    CURRENT_TIMESTAMP
                )
                """
            ),
            {
                "provider_type": "serper",
                "enabled": False,
                "api_key": None,
                "result_count": 5,
            },
        )


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(
        sa.text(
            "DELETE FROM web_search_providers WHERE provider_type = :provider_type"
        ),
        {"provider_type": "serper"},
    )