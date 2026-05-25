from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class GpuPool(Base):
    __tablename__ = "gpu_pools"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False, default="GPU Pool")


class GpuPoolDevice(Base):
    __tablename__ = "gpu_pool_devices"

    pool_id: Mapped[int] = mapped_column(ForeignKey("gpu_pools.id", ondelete="CASCADE"), primary_key=True)
    device_id: Mapped[int] = mapped_column(ForeignKey("devices.id", ondelete="CASCADE"), primary_key=True)
