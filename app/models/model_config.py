from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class ModelConfig(Base):
    __tablename__ = "model_configs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    priority: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    file_name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    file_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    alias: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    system_prompt: Mapped[str] = mapped_column(Text, default="", nullable=False)
    chat_template: Mapped[str] = mapped_column(Text, default="", nullable=False)
    context_length: Mapped[int] = mapped_column(Integer, default=8192, nullable=False)
    gpu_layers: Mapped[int] = mapped_column(Integer, default=-1, nullable=False)
    threads: Mapped[int] = mapped_column(Integer, default=8, nullable=False)
    tool_calling_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    assignment_mode: Mapped[str] = mapped_column(String(32), default="auto", nullable=False)
    pinned_device_id: Mapped[int | None] = mapped_column(ForeignKey("devices.id"), nullable=True)
    activated: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
