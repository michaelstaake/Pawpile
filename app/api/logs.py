from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_admin_user
from app.core.db import get_db
from app.models.activity_log import ActivityLog
from app.models.user import User

router = APIRouter(prefix="/api/logs", tags=["logs"])

CATEGORY_PREFIXES: dict[str, str] = {
    "auth": "auth.%",
    "models": "model.%",
    "devices": "device.%",
    "chat": "chat.%",
    "admin": "admin.%",
}


@router.get("")
def list_logs(
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    event_category: str | None = Query(default=None),
    search: str | None = Query(default=None),
) -> dict:
    query = db.query(ActivityLog)

    if event_category and event_category in CATEGORY_PREFIXES:
        query = query.filter(ActivityLog.event_type.like(CATEGORY_PREFIXES[event_category]))

    if search:
        term = f"%{search}%"
        query = query.filter(
            ActivityLog.username.like(term)
            | ActivityLog.details.like(term)
            | ActivityLog.event_type.like(term)
        )

    total = query.count()
    items = (
        query.order_by(ActivityLog.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [_serialize(item) for item in items],
    }


def _serialize(log: ActivityLog) -> dict:
    return {
        "id": log.id,
        "created_at": log.created_at.isoformat() if log.created_at else None,
        "event_type": log.event_type,
        "user_id": log.user_id,
        "username": log.username,
        "ip_address": log.ip_address,
        "details": log.details,
    }
