from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.security import create_access_token, hash_password, verify_password
from app.models.user import User
from app.utils.schemas import BootstrapAdminRequest, BootstrapStatusResponse, LoginRequest, LoginResponse

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/bootstrap-status", response_model=BootstrapStatusResponse)
def bootstrap_status(db: Session = Depends(get_db)) -> BootstrapStatusResponse:
    has_users = db.query(User.id).first() is not None
    return BootstrapStatusResponse(requires_setup=not has_users)


@router.post("/bootstrap-admin", response_model=LoginResponse)
def bootstrap_admin(payload: BootstrapAdminRequest, db: Session = Depends(get_db)) -> LoginResponse:
    if db.query(User.id).first() is not None:
        raise HTTPException(status_code=409, detail="Initial admin has already been created")

    admin_user = User(
        username=payload.username,
        email=payload.email,
        password_hash=hash_password(payload.password),
        is_admin=True,
        is_active=True,
    )
    db.add(admin_user)
    db.commit()
    token = create_access_token(admin_user.username)
    return LoginResponse(access_token=token)


@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> LoginResponse:
    user = db.query(User).filter(User.username == payload.username, User.is_active.is_(True)).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    token = create_access_token(user.username)
    return LoginResponse(access_token=token)
