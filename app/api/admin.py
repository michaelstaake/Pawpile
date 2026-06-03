from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.api.deps import get_admin_user, get_current_user
from app.core.activity_logger import log_event
from app.core.app_settings import get_or_create_app_settings
from app.core.config import get_settings
from app.core.db import get_db
from app.core.security import generate_api_key, hash_api_key, hash_password
from app.core.token_usage import get_user_token_usage
from app.models.api_key import ApiKey
from app.models.user import User
from app.utils.schemas import ApiKeyCreateRequest, AppSettingsResponse, AppSettingsUpdateRequest, UserCreateRequest, UserUpdateRequest

router = APIRouter(prefix="/api/admin", tags=["admin"])
app_config = get_settings()
BACKGROUND_IMAGE_MAX_BYTES = 10 * 1024 * 1024
BACKGROUND_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png"}


@router.get("/settings", response_model=AppSettingsResponse)
def get_settings(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> AppSettingsResponse:
    app_settings = get_or_create_app_settings(db)
    return _serialize_app_settings(app_settings)


@router.patch("/settings", response_model=AppSettingsResponse)
def update_settings(payload: AppSettingsUpdateRequest, admin_user: User = Depends(get_admin_user), db: Session = Depends(get_db)) -> AppSettingsResponse:
    app_settings = get_or_create_app_settings(db)

    if payload.users_can_register is not None:
        app_settings.users_can_register = payload.users_can_register
    if payload.sitename is not None:
        app_settings.sitename = payload.sitename
    if payload.background_color is not None:
        app_settings.background_color = payload.background_color
    if payload.background_image_mode is not None:
        app_settings.background_image_mode = payload.background_image_mode
    if payload.knowledge_base_enabled is not None:
        app_settings.knowledge_base_enabled = payload.knowledge_base_enabled
    if payload.input_price_per_1m is not None:
        app_settings.input_price_per_1m = payload.input_price_per_1m
    if payload.output_price_per_1m is not None:
        app_settings.output_price_per_1m = payload.output_price_per_1m
    if payload.public_url is not None:
        app_settings.public_url = payload.public_url
    if payload.cloudflare_turnstile_enabled is not None:
        app_settings.cloudflare_turnstile_enabled = payload.cloudflare_turnstile_enabled
    if payload.cloudflare_turnstile_site_key is not None:
        app_settings.cloudflare_turnstile_site_key = payload.cloudflare_turnstile_site_key
    if payload.cloudflare_turnstile_secret_key is not None:
        app_settings.cloudflare_turnstile_secret_key = payload.cloudflare_turnstile_secret_key
    if payload.two_factor_enabled is not None:
        app_settings.two_factor_enabled = payload.two_factor_enabled

    db.add(app_settings)
    db.commit()
    db.refresh(app_settings)
    log_event(db, "admin.settings_changed", user_id=admin_user.id, username=admin_user.username)
    return _serialize_app_settings(app_settings)


@router.post("/settings/background-image", response_model=AppSettingsResponse)
async def upload_background_image(
    file: UploadFile = File(...),
    admin_user: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
) -> AppSettingsResponse:
    extension = Path(file.filename or "").suffix.lower()
    if extension not in BACKGROUND_IMAGE_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Background image must be a JPG or PNG file")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Background image upload was empty")
    if len(content) > BACKGROUND_IMAGE_MAX_BYTES:
        raise HTTPException(status_code=400, detail="Background image must be 10 MB or smaller")

    app_settings = get_or_create_app_settings(db)
    backgrounds_directory = _backgrounds_directory()
    backgrounds_directory.mkdir(parents=True, exist_ok=True)

    _delete_background_file(app_settings.background_image_path)

    stored_name = f"background-{uuid4().hex}{extension}"
    destination = backgrounds_directory / stored_name
    destination.write_bytes(content)

    app_settings.background_image_path = f"/static/backgrounds/{stored_name}"
    db.add(app_settings)
    db.commit()
    db.refresh(app_settings)
    log_event(db, "admin.settings_changed", user_id=admin_user.id, username=admin_user.username)
    return _serialize_app_settings(app_settings)


@router.delete("/settings/background-image", response_model=AppSettingsResponse)
def delete_background_image(admin_user: User = Depends(get_admin_user), db: Session = Depends(get_db)) -> AppSettingsResponse:
    app_settings = get_or_create_app_settings(db)
    _delete_background_file(app_settings.background_image_path)
    app_settings.background_image_path = None
    db.add(app_settings)
    db.commit()
    db.refresh(app_settings)
    log_event(db, "admin.settings_changed", user_id=admin_user.id, username=admin_user.username)
    return _serialize_app_settings(app_settings)


@router.get("/users")
def list_users(_: User = Depends(get_admin_user), db: Session = Depends(get_db)) -> list[dict]:
    rows = db.query(User).order_by(User.id.asc()).all()
    return [_serialize_user(u) for u in rows]


@router.get("/users/token-usage")
def get_users_token_usage(_: User = Depends(get_admin_user), db: Session = Depends(get_db)) -> list[dict]:
    app_settings = get_or_create_app_settings(db)
    users = db.query(User).order_by(User.username.asc()).all()
    user_ids = [u.id for u in users]
    return get_user_token_usage(db, user_ids=user_ids, input_price_per_1m=app_settings.input_price_per_1m or 0.0, output_price_per_1m=app_settings.output_price_per_1m or 0.0)


@router.post("/users")
def create_user(payload: UserCreateRequest, admin_user: User = Depends(get_admin_user), db: Session = Depends(get_db)) -> dict:
    _ensure_user_uniqueness(db, payload.username, payload.email)

    user = User(
        username=payload.username,
        email=payload.email,
        password_hash=hash_password(payload.password),
        is_admin=payload.is_admin,
        is_active=payload.is_active,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    log_event(db, "admin.user_created", user_id=admin_user.id, username=admin_user.username, details={"new_username": user.username})
    return {"status": "ok", "user": _serialize_user(user)}


@router.patch("/users/{user_id}")
def update_user(user_id: int, payload: UserUpdateRequest, admin_user: User = Depends(get_admin_user), db: Session = Depends(get_db)) -> dict:
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    new_username = payload.username if payload.username is not None else user.username
    new_email = payload.email if payload.email is not None else user.email
    _ensure_user_uniqueness(db, new_username, new_email, excluded_user_id=user.id)

    would_be_admin = payload.is_admin if payload.is_admin is not None else user.is_admin
    would_be_active = payload.is_active if payload.is_active is not None else user.is_active
    if user.is_admin and (not would_be_admin or not would_be_active):
        remaining_admins = (
            db.query(User)
            .filter(User.id != user.id, User.is_admin.is_(True), User.is_active.is_(True))
            .count()
        )
        if remaining_admins == 0:
            raise HTTPException(status_code=400, detail="At least one active admin user is required")

    if payload.username is not None:
        user.username = payload.username
    if payload.email is not None:
        user.email = payload.email
    if payload.password is not None:
        user.password_hash = hash_password(payload.password)
    if payload.is_admin is not None:
        user.is_admin = payload.is_admin
    if payload.is_active is not None:
        user.is_active = payload.is_active

    db.add(user)
    db.commit()
    db.refresh(user)
    log_event(db, "admin.user_updated", user_id=admin_user.id, username=admin_user.username, details={"target_username": user.username})
    return {"status": "ok", "user": _serialize_user(user)}


@router.get("/api-keys")
def list_api_keys(_: User = Depends(get_admin_user), db: Session = Depends(get_db)) -> list[dict]:
    rows = db.query(ApiKey, User).join(User, User.id == ApiKey.user_id).order_by(ApiKey.created_at.desc(), ApiKey.id.desc()).all()
    return [_serialize_api_key(api_key, user) for api_key, user in rows]


@router.post("/users/{user_id}/api-keys")
def create_api_key_for_user(user_id: int, payload: ApiKeyCreateRequest, _: User = Depends(get_admin_user), db: Session = Depends(get_db)) -> dict:
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    plain_text_key = generate_api_key()
    api_key = ApiKey(user_id=user.id, name=payload.name, key_hash=hash_api_key(plain_text_key))
    db.add(api_key)
    db.commit()
    db.refresh(api_key)
    return {"status": "ok", "api_key": _serialize_api_key(api_key, user), "plain_text_key": plain_text_key}


@router.delete("/api-keys/{key_id}")
def revoke_api_key(key_id: int, _: User = Depends(get_admin_user), db: Session = Depends(get_db)) -> dict:
    api_key = db.query(ApiKey).filter(ApiKey.id == key_id).first()
    if not api_key:
        raise HTTPException(status_code=404, detail="API key not found")
    db.delete(api_key)
    db.commit()
    return {"status": "ok"}


def _serialize_user(user: User) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "is_admin": user.is_admin,
        "is_active": user.is_active,
    }


def _serialize_api_key(api_key: ApiKey, user: User) -> dict:
    return {
        "id": api_key.id,
        "user_id": api_key.user_id,
        "user_username": user.username,
        "name": api_key.name,
        "created_at": api_key.created_at.isoformat() if api_key.created_at else None,
    }


def _ensure_user_uniqueness(db: Session, username: str, email: str, excluded_user_id: int | None = None) -> None:
    username_query = db.query(User).filter(User.username == username)
    email_query = db.query(User).filter(User.email == email)
    if excluded_user_id is not None:
        username_query = username_query.filter(User.id != excluded_user_id)
        email_query = email_query.filter(User.id != excluded_user_id)

    if username_query.first():
        raise HTTPException(status_code=409, detail="A user with that username already exists")
    if email_query.first():
        raise HTTPException(status_code=409, detail="A user with that email already exists")


def _serialize_app_settings(app_settings) -> AppSettingsResponse:
    return AppSettingsResponse(
        users_can_register=app_settings.users_can_register,
        sitename=app_settings.sitename,
        background_color=app_settings.background_color,
        background_image_path=app_settings.background_image_path,
        background_image_mode=app_settings.background_image_mode,
        knowledge_base_enabled=app_settings.knowledge_base_enabled,
        input_price_per_1m=app_settings.input_price_per_1m,
        output_price_per_1m=app_settings.output_price_per_1m,
        public_url=app_settings.public_url or "",
        cloudflare_turnstile_enabled=app_settings.cloudflare_turnstile_enabled,
        cloudflare_turnstile_site_key=app_settings.cloudflare_turnstile_site_key,
        cloudflare_turnstile_secret_key=app_settings.cloudflare_turnstile_secret_key,
        two_factor_enabled=app_settings.two_factor_enabled,
    )


def _backgrounds_directory() -> Path:
    return Path(app_config.data_dir) / "backgrounds"


def _delete_background_file(background_image_path: str | None) -> None:
    if not background_image_path or not background_image_path.startswith("/static/backgrounds/"):
        return

    file_path = _backgrounds_directory() / Path(background_image_path).name
    if file_path.exists():
        file_path.unlink()
