import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
import bcrypt
from jose import jwt

from app.core.config import get_settings


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))


def create_access_token(subject: str) -> str:
    settings = get_settings()
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_access_token_expire_minutes)
    payload = {"sub": subject, "exp": expire}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def generate_api_key() -> str:
    return f"ppk_{secrets.token_urlsafe(32)}"


def hash_api_key(api_key: str) -> str:
    return hashlib.sha256(api_key.encode("utf-8")).hexdigest()


def verify_api_key(api_key: str, key_hash: str) -> bool:
    return hmac.compare_digest(hash_api_key(api_key), key_hash)


async def verify_cloudflare_turnstile(secret_key: str, token: str) -> bool:
    import logging

    import httpx

    logger = logging.getLogger(__name__)

    async with httpx.AsyncClient(timeout=10) as client:
        try:
            response = await client.post(
                "https://challenges.cloudflare.com/turnstile/v0/siteverify",
                data={
                    "secret": secret_key,
                    "response": token,
                },
            )
     data = response.json()
    except Exception:
      logger.exception("Failed to parse Cloudflare Turnstile verification response")
      return False

    logger.info("Cloudflare Turnstile response: %s", data)

    success = data.get("success", False)
    score = data.get("score")
    error_codes = data.get("error-codes", [])

        if not success:
            logger.warning(
                "Cloudflare Turnstile verification failed: %s",
                error_codes,
                extra={"error_codes": error_codes, "score": score},
            )
            return False

        if "score" in data and score < 0.2:
            logger.info(
                "Cloudflare Turnstile score below explicit widget threshold (0.2): %s",
                score,
                extra={"score": score, "error_codes": error_codes},
            )
            return False

        return True
