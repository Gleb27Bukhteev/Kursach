from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from database import SessionLocal
import models
from security import decode_access_token

security = HTTPBearer(auto_error=False)


def get_db():
    # FastAPI вызывает эту зависимость для эндпоинтов с db: Session = Depends(get_db).
    # После ответа клиенту finally гарантированно закрывает соединение с БД.
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_user(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(security)],
    db: Annotated[Session, Depends(get_db)],
) -> models.User:
    # Универсальная защита приватных эндпоинтов: достаем Bearer-токен, проверяем его
    # и возвращаем пользователя из БД. Если проверка не прошла - запрос останавливается.
    if creds is None or creds.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Нужен заголовок Authorization: Bearer <токен>",
        )
    payload = decode_access_token(creds.credentials)
    if payload is None or payload.get("sub") is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Недействительный токен",
        )
    try:
        user_id = int(payload["sub"])
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Недействительный токен",
        )
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Пользователь не найден",
        )
    return user
