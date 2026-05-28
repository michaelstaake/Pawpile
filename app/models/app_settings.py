from sqlalchemy import Boolean, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class AppSettings(Base):
    __tablename__ = "app_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    allow_anonymous_chat: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    users_can_register: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    sitename: Mapped[str] = mapped_column(String(255), default="Pawpile", nullable=False)
    active_web_search_provider_id: Mapped[int | None] = mapped_column(Integer, nullable=True)