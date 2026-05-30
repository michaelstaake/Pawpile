from datetime import datetime, timedelta, timezone

from sqlalchemy import desc, func
from sqlalchemy.orm import Session

from app.models.token_usage import TokenUsage
from app.models.user import User


PROCESS_STARTED_AT = datetime.now(timezone.utc)


def _coalesce_token_count(value: int | None) -> int | None:
    if value is None or value <= 0:
        return None

    return value


def normalize_token_usage(
    total_tokens: int | None,
    *,
    input_tokens: int | None = None,
    output_tokens: int | None = None,
) -> tuple[int, int, int] | None:
    normalized_input_tokens = _coalesce_token_count(input_tokens) or 0
    normalized_output_tokens = _coalesce_token_count(output_tokens) or 0
    normalized_total_tokens = _coalesce_token_count(total_tokens)

    if normalized_total_tokens is None:
        normalized_total_tokens = normalized_input_tokens + normalized_output_tokens

    if normalized_total_tokens <= 0 and normalized_input_tokens <= 0 and normalized_output_tokens <= 0:
        return None

    return normalized_total_tokens, normalized_input_tokens, normalized_output_tokens


def record_token_usage(
    db: Session,
    *,
    user_id: int | None,
    total_tokens: int | None,
    input_tokens: int | None = None,
    output_tokens: int | None = None,
) -> bool:
    normalized_usage = normalize_token_usage(
        total_tokens,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
    )
    if normalized_usage is None:
        return False

    normalized_total_tokens, normalized_input_tokens, normalized_output_tokens = normalized_usage
    db.add(
        TokenUsage(
            user_id=user_id if user_id and user_id > 0 else None,
            total_tokens=normalized_total_tokens,
            input_tokens=normalized_input_tokens,
            output_tokens=normalized_output_tokens,
        )
    )
    db.commit()
    return True


def build_token_usage_summary(db: Session) -> dict:
    now = datetime.now(timezone.utc)

    return {
        "since_startup": _aggregate_token_usage(db, since=PROCESS_STARTED_AT),
        "last_1_hour": _aggregate_token_usage(db, since=now - timedelta(hours=1)),
        "last_24_hours": _aggregate_token_usage(db, since=now - timedelta(hours=24)),
        "last_7_days": _aggregate_token_usage(db, since=now - timedelta(days=7)),
        "last_30_days": _aggregate_token_usage(db, since=now - timedelta(days=30)),
        "forever": _aggregate_token_usage(db),
        "top_user_last_24_hours": _aggregate_top_user(db, since=now - timedelta(hours=24)),
        "top_user_forever": _aggregate_top_user(db),
    }


def _aggregate_token_usage(db: Session, *, since: datetime | None = None) -> dict:
    query = db.query(
        func.coalesce(func.sum(TokenUsage.total_tokens), 0),
        func.coalesce(func.sum(TokenUsage.input_tokens), 0),
        func.coalesce(func.sum(TokenUsage.output_tokens), 0),
    )
    if since is not None:
        query = query.filter(TokenUsage.created_at >= since)

    total_tokens, input_tokens, output_tokens = query.one()
    return {
        "total_tokens": int(total_tokens or 0),
        "input_tokens": int(input_tokens or 0),
        "output_tokens": int(output_tokens or 0),
    }


def _aggregate_top_user(db: Session, *, since: datetime | None = None) -> dict | None:
    query = (
        db.query(
            User.username.label("username"),
            func.coalesce(func.sum(TokenUsage.total_tokens), 0).label("total_tokens"),
            func.coalesce(func.sum(TokenUsage.input_tokens), 0).label("input_tokens"),
            func.coalesce(func.sum(TokenUsage.output_tokens), 0).label("output_tokens"),
        )
        .join(User, User.id == TokenUsage.user_id)
        .filter(TokenUsage.user_id.is_not(None))
        .group_by(User.id, User.username)
        .order_by(desc("total_tokens"), User.username.asc())
    )
    if since is not None:
        query = query.filter(TokenUsage.created_at >= since)

    row = query.first()
    if row is None or int(row.total_tokens or 0) <= 0:
        return None

    return {
        "username": row.username,
        "total_tokens": int(row.total_tokens or 0),
        "input_tokens": int(row.input_tokens or 0),
        "output_tokens": int(row.output_tokens or 0),
    }