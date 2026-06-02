import os
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from jose import JWTError, jwt
from passlib.context import CryptContext

SECRET_KEY = os.environ.get("JWT_SECRET", "dev-secret-change-for-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_DAYS = 7

# CryptContext инкапсулирует алгоритм хеширования паролей.
pwd_context = CryptContext(
    # pbkdf2_sha256 has no 72-byte bcrypt input limit and is stable
    # across environments without native bcrypt backend quirks.
    schemes=["pbkdf2_sha256"],
    deprecated="auto",
)


def hash_password(password: str) -> str:
    # Используется при регистрации перед сохранением пользователя в БД.
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    # Используется при входе: сравнивает введенный пароль с хешем из БД.
    return pwd_context.verify(plain, hashed)


def create_access_token(data: dict[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    # JWT хранит служебные данные о пользователе и срок действия, но не хранится на сервере.
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta if expires_delta else timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS)
    )
    to_encode["exp"] = int(expire.timestamp())
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> Optional[dict[str, Any]]:
    # Если подпись или срок действия неверные, возвращаем None вместо падения приложения.
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        return None
