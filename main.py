from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
import json
import os
from pathlib import Path
import secrets
import smtplib
from typing import Annotated

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import and_, or_, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

import models
import schemas
from database import Base, SessionLocal, engine
from deps import get_current_user, get_db
from security import create_access_token, decode_access_token, hash_password, verify_password


UPLOAD_ROOT = Path("static/uploads")
AVATAR_UPLOAD_DIR = UPLOAD_ROOT / "avatars"
MESSAGE_UPLOAD_DIR = UPLOAD_ROOT / "messages"
FILE_UPLOAD_DIR = UPLOAD_ROOT / "files"
GROUP_UPLOAD_DIR = UPLOAD_ROOT / "groups"
MAX_IMAGE_SIZE = 5 * 1024 * 1024
MAX_FILE_SIZE = 25 * 1024 * 1024
ALLOWED_IMAGE_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
BLOCKED_FILE_EXTENSIONS = {".bat", ".cmd", ".com", ".exe", ".js", ".msi", ".ps1", ".scr", ".vbs"}
PUBLIC_ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
PUBLIC_ID_LENGTH = 6


@asynccontextmanager
async def lifespan(app: FastAPI):
    # При старте приложения создаем таблицы, если их еще нет.
    Base.metadata.create_all(bind=engine)
    _ensure_upload_dirs()
    _ensure_media_columns()
    _ensure_user_identity_columns()
    _ensure_user_public_ids()
    yield


app = FastAPI(title="Мессенджер", version="1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ConnectionManager:
    """Хранит активные WebSocket-подключения пользователей в памяти сервера."""

    def __init__(self) -> None:
        self._by_user: dict[int, list[WebSocket]] = {}
        self._active_chat_by_user: dict[int, int] = {}

    async def connect(self, user_id: int, websocket: WebSocket) -> None:
        await websocket.accept()
        self._by_user.setdefault(user_id, []).append(websocket)

    def disconnect(self, user_id: int, websocket: WebSocket) -> None:
        conns = self._by_user.get(user_id)
        if not conns:
            return
        if websocket in conns:
            conns.remove(websocket)
        if not conns:
            self._by_user.pop(user_id, None)
            old_chat_user_id = self._active_chat_by_user.pop(user_id, None)
            return old_chat_user_id
        return None

    async def notify_user(self, user_id: int, payload: dict) -> None:
        for ws in list(self._by_user.get(user_id, [])):
            try:
                await ws.send_json(payload)
            except Exception:
                pass

    async def set_active_chat(self, user_id: int, with_user_id: int | None) -> None:
        old_chat_user_id = self._active_chat_by_user.get(user_id)
        if old_chat_user_id == with_user_id:
            return

        if old_chat_user_id is not None:
            await self.notify_user(
                old_chat_user_id,
                {"type": "chat_presence", "user_id": user_id, "active": False},
            )

        if with_user_id is None:
            self._active_chat_by_user.pop(user_id, None)
            return

        self._active_chat_by_user[user_id] = with_user_id
        await self.notify_user(
            with_user_id,
            {"type": "chat_presence", "user_id": user_id, "active": True},
        )


manager = ConnectionManager()


def _normalize_email(email: str) -> str:
    return email.strip().lower()


def _smtp_configured() -> bool:
    required = ("SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD")
    return all(os.environ.get(name) for name in required)


def _send_reset_email(to_email: str, reset_token: str) -> None:
    smtp_host = os.environ["SMTP_HOST"]
    smtp_port = int(os.environ.get("SMTP_PORT", "587"))
    smtp_user = os.environ["SMTP_USER"]
    smtp_password = os.environ["SMTP_PASSWORD"]
    smtp_from = os.environ.get("SMTP_FROM", smtp_user)

    message = EmailMessage()
    message["Subject"] = "Код восстановления пароля"
    message["From"] = smtp_from
    message["To"] = to_email
    message.set_content(
        "Здравствуйте!\n\n"
        f"Ваш код восстановления пароля: {reset_token}\n\n"
        "Код действует 15 минут. Если вы не запрашивали смену пароля, просто игнорируйте это письмо.\n"
    )

    with smtplib.SMTP(smtp_host, smtp_port) as smtp:
        smtp.starttls()
        smtp.login(smtp_user, smtp_password)
        smtp.send_message(message)


def _raise_db_help() -> None:
    raise HTTPException(
        status_code=503,
        detail=(
            "Не удается работать с PostgreSQL. Проверьте, что служба запущена, "
            "а в database.py верны host, port, password и имя базы messenger_db."
        ),
    )


def _ensure_upload_dirs() -> None:
    AVATAR_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    MESSAGE_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    FILE_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    GROUP_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


def _ensure_media_columns() -> None:
    try:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(500)"))
            conn.execute(text("ALTER TABLE messages ADD COLUMN IF NOT EXISTS image_url VARCHAR(500)"))
            conn.execute(text("ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMP WITH TIME ZONE"))
            conn.execute(text("ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE"))
            conn.execute(text("ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMP WITH TIME ZONE"))
            conn.execute(text("ALTER TABLE messages ADD COLUMN IF NOT EXISTS file_url VARCHAR(500)"))
            conn.execute(text("ALTER TABLE messages ADD COLUMN IF NOT EXISTS file_name VARCHAR(255)"))
            conn.execute(text("ALTER TABLE messages ADD COLUMN IF NOT EXISTS file_size INTEGER"))
            conn.execute(text("ALTER TABLE messages ADD COLUMN IF NOT EXISTS file_content_type VARCHAR(120)"))
            conn.execute(text("ALTER TABLE messages ADD COLUMN IF NOT EXISTS group_id INTEGER REFERENCES groups(id)"))
            conn.execute(text("ALTER TABLE messages ALTER COLUMN receiver_id DROP NOT NULL"))
    except SQLAlchemyError:
        _raise_db_help()


def _generate_public_id() -> str:
    return "".join(secrets.choice(PUBLIC_ID_ALPHABET) for _ in range(PUBLIC_ID_LENGTH))


def _create_unique_public_id(db: Session) -> str:
    while True:
        public_id = _generate_public_id()
        exists = db.query(models.User).filter(models.User.public_id == public_id).first()
        if exists is None:
            return public_id


def _normalize_public_id(public_id: str) -> str:
    return public_id.strip().upper()


def _ensure_user_identity_columns() -> None:
    try:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS public_id VARCHAR(8)"))
            conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_public_id ON users (public_id)"))
    except SQLAlchemyError:
        _raise_db_help()


def _ensure_user_public_ids() -> None:
    db = SessionLocal()
    try:
        users = (
            db.query(models.User)
            .filter(or_(models.User.public_id.is_(None), models.User.public_id == ""))
            .all()
        )

        for user in users:
            user.public_id = _create_unique_public_id(db)

        if users:
            db.commit()
    except SQLAlchemyError:
        db.rollback()
        _raise_db_help()
    finally:
        db.close()


def _safe_display_filename(filename: str | None) -> str:
    name = Path(filename or "file").name.strip()
    if not name:
        return "file"
    return name[:255]


async def _save_image_upload(file: UploadFile, target_dir: Path) -> str:
    extension = ALLOWED_IMAGE_TYPES.get(file.content_type or "")
    if extension is None and file.filename:
        suffix = Path(file.filename).suffix.lower()
        if suffix in ALLOWED_IMAGE_EXTENSIONS:
            extension = ".jpg" if suffix == ".jpeg" else suffix

    if extension is None:
        raise HTTPException(status_code=400, detail="Можно загружать только изображения JPG, PNG, WEBP или GIF")

    data = await file.read(MAX_IMAGE_SIZE + 1)
    if not data:
        raise HTTPException(status_code=400, detail="Файл пустой")
    if len(data) > MAX_IMAGE_SIZE:
        raise HTTPException(status_code=400, detail="Картинка слишком большая. Максимум 5 МБ")

    target_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{secrets.token_urlsafe(18)}{extension}"
    path = target_dir / filename
    path.write_bytes(data)
    return "/" + path.as_posix()


async def _save_file_upload(file: UploadFile) -> tuple[str, str, int, str | None]:
    original_name = _safe_display_filename(file.filename)
    suffix = Path(original_name).suffix.lower()

    if suffix in BLOCKED_FILE_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Этот тип файла нельзя загружать")

    data = await file.read(MAX_FILE_SIZE + 1)
    if not data:
        raise HTTPException(status_code=400, detail="Файл пустой")
    if len(data) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="Файл слишком большой. Максимум 25 МБ")

    FILE_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    stored_name = f"{secrets.token_urlsafe(18)}{suffix}"
    path = FILE_UPLOAD_DIR / stored_name
    path.write_bytes(data)
    return "/" + path.as_posix(), original_name, len(data), file.content_type


def _is_group_member(db: Session, group_id: int, user_id: int) -> bool:
    return (
        db.query(models.GroupMember)
        .filter(models.GroupMember.group_id == group_id, models.GroupMember.user_id == user_id)
        .first()
        is not None
    )


def _group_to_out(db: Session, group: models.Group) -> schemas.GroupOut:
    members = (
        db.query(models.User)
        .join(models.GroupMember, models.GroupMember.user_id == models.User.id)
        .filter(models.GroupMember.group_id == group.id)
        .order_by(models.User.username)
        .all()
    )
    return schemas.GroupOut(
        id=group.id,
        title=group.title,
        avatar_url=group.avatar_url,
        members=[
            schemas.GroupMemberOut(
                id=member.id,
                username=member.username,
                public_id=member.public_id,
                avatar_url=member.avatar_url,
            )
            for member in members
        ],
    )


def _message_to_out(message: models.Message) -> schemas.MessageOut:
    return schemas.MessageOut(
        id=message.id,
        sender_id=message.sender_id,
        receiver_id=message.receiver_id,
        group_id=message.group_id,
        sender_username=message.sender.username if message.sender else None,
        text=message.text,
        image_url=message.image_url,
        file_url=message.file_url,
        file_name=message.file_name,
        file_size=message.file_size,
        file_content_type=message.file_content_type,
        created_at=message.created_at,
        edited_at=message.edited_at,
        deleted_at=message.deleted_at,
        read_at=message.read_at,
    )


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/health/db")
def health_db(db: Session = Depends(get_db)):
    try:
        db.execute(text("SELECT 1"))
        return {"database": "ok"}
    except SQLAlchemyError:
        _raise_db_help()


@app.post("/api/auth/register", response_model=schemas.UserOut)
def register(data: schemas.UserCreate, db: Session = Depends(get_db)):
    email = _normalize_email(data.email)

    try:
        if db.query(models.User).filter(models.User.email == email).first():
            raise HTTPException(status_code=400, detail="Такая почта уже зарегистрирована")
        if db.query(models.User).filter(models.User.username == data.username).first():
            raise HTTPException(status_code=400, detail="Такой никнейм уже занят")

        user = models.User(
            email=email,
            username=data.username,
            public_id=_create_unique_public_id(db),
            hashed_password=hash_password(data.password),
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return user
    except HTTPException:
        raise
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Почта или никнейм уже заняты")
    except SQLAlchemyError:
        db.rollback()
        _raise_db_help()


@app.post("/api/auth/login", response_model=schemas.Token)
def login(data: schemas.UserLogin, db: Session = Depends(get_db)):
    try:
        user = db.query(models.User).filter(models.User.email == _normalize_email(data.email)).first()
    except SQLAlchemyError:
        _raise_db_help()

    if user is None or not verify_password(data.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Неверная почта или пароль")

    token = create_access_token({"sub": str(user.id)})
    return schemas.Token(access_token=token)


@app.post("/api/auth/forgot-password", response_model=schemas.ForgotPasswordOut)
def forgot_password(data: schemas.ForgotPasswordRequest, db: Session = Depends(get_db)):
    email = _normalize_email(data.email)
    user = db.query(models.User).filter(models.User.email == email).first()

    if user is None:
        raise HTTPException(status_code=404, detail="Такая почта не зарегистрирована")

    reset_token = f"{secrets.randbelow(1_000_000):06d}"
    user.reset_token = reset_token
    user.reset_token_expires = datetime.now(timezone.utc) + timedelta(minutes=15)

    try:
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        _raise_db_help()

    if _smtp_configured():
        try:
            _send_reset_email(email, reset_token)
        except Exception:
            raise HTTPException(status_code=500, detail="Не удалось отправить письмо с кодом")
        return schemas.ForgotPasswordOut(message="Код восстановления отправлен на почту.")

    # Учебный режим: если SMTP не настроен, показываем код, чтобы проект можно было защитить локально.
    return schemas.ForgotPasswordOut(
        message="SMTP не настроен. Учебный код восстановления показан на экране.",
        dev_reset_token=reset_token,
    )


@app.post("/api/auth/reset-password")
def reset_password(data: schemas.ResetPasswordRequest, db: Session = Depends(get_db)):
    email = _normalize_email(data.email)
    user = db.query(models.User).filter(models.User.email == email).first()
    now = datetime.now(timezone.utc)

    if user is None:
        raise HTTPException(status_code=404, detail="Такая почта не зарегистрирована")

    if (
        user.reset_token != data.reset_token
        or user.reset_token_expires is None
        or user.reset_token_expires < now
    ):
        raise HTTPException(status_code=400, detail="Неверный или просроченный код восстановления")

    user.hashed_password = hash_password(data.new_password)
    user.reset_token = None
    user.reset_token_expires = None

    try:
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        _raise_db_help()

    return {"ok": True, "message": "Пароль изменен. Теперь можно войти."}


@app.get("/api/users/me", response_model=schemas.UserOut)
def me(current: Annotated[models.User, Depends(get_current_user)]):
    return current


@app.post("/api/users/avatar", response_model=schemas.UserOut)
async def upload_avatar(
    avatar: UploadFile = File(...),
    db: Session = Depends(get_db),
    current: models.User = Depends(get_current_user),
):
    avatar_url = await _save_image_upload(avatar, AVATAR_UPLOAD_DIR)
    current.avatar_url = avatar_url

    try:
        db.commit()
        db.refresh(current)
        return current
    except SQLAlchemyError:
        db.rollback()
        _raise_db_help()


@app.get("/api/users", response_model=list[schemas.UserOut])
def list_users(
    db: Session = Depends(get_db),
    current: models.User = Depends(get_current_user),
):
    contacts = db.query(models.Contact.contact_id).filter(models.Contact.owner_id == current.id).all()
    contact_ids = {row[0] for row in contacts}

    messages = (
        db.query(models.Message.sender_id, models.Message.receiver_id)
        .filter(or_(models.Message.sender_id == current.id, models.Message.receiver_id == current.id))
        .all()
    )
    peer_ids = {
        receiver_id if sender_id == current.id else sender_id
        for sender_id, receiver_id in messages
    }
    peer_ids.discard(None)
    user_ids = contact_ids | peer_ids

    if not user_ids:
        return []

    return (
        db.query(models.User)
        .filter(models.User.id.in_(user_ids), models.User.id != current.id)
        .order_by(models.User.username)
        .all()
    )


@app.get("/api/users/search", response_model=schemas.UserOut)
def find_user_by_public_id(
    public_id: str,
    db: Session = Depends(get_db),
    current: models.User = Depends(get_current_user),
):
    normalized_id = _normalize_public_id(public_id)
    if normalized_id == current.public_id:
        raise HTTPException(status_code=400, detail="Это ваш ID")

    user = db.query(models.User).filter(models.User.public_id == normalized_id).first()
    if user is None:
        raise HTTPException(status_code=404, detail="Пользователь с таким ID не найден")
    return user


@app.post("/api/contacts", response_model=schemas.UserOut)
def add_contact(
    data: schemas.ContactCreate,
    db: Session = Depends(get_db),
    current: models.User = Depends(get_current_user),
):
    public_id = _normalize_public_id(data.public_id)
    contact = db.query(models.User).filter(models.User.public_id == public_id).first()

    if contact is None:
        raise HTTPException(status_code=404, detail="Пользователь с таким ID не найден")
    if contact.id == current.id:
        raise HTTPException(status_code=400, detail="Нельзя добавить себя")

    exists = (
        db.query(models.Contact)
        .filter(models.Contact.owner_id == current.id, models.Contact.contact_id == contact.id)
        .first()
    )
    if exists is None:
        db.add(models.Contact(owner_id=current.id, contact_id=contact.id))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
        except SQLAlchemyError:
            db.rollback()
            _raise_db_help()

    return contact


@app.get("/api/groups", response_model=list[schemas.GroupOut])
def list_groups(
    db: Session = Depends(get_db),
    current: models.User = Depends(get_current_user),
):
    groups = (
        db.query(models.Group)
        .join(models.GroupMember, models.GroupMember.group_id == models.Group.id)
        .filter(models.GroupMember.user_id == current.id)
        .order_by(models.Group.created_at.desc())
        .all()
    )
    return [_group_to_out(db, group) for group in groups]


@app.post("/api/groups", response_model=schemas.GroupOut)
async def create_group(
    title: str = Form(...),
    member_ids: str = Form(""),
    avatar: UploadFile | None = File(None),
    db: Session = Depends(get_db),
    current: models.User = Depends(get_current_user),
):
    title = title.strip()
    if len(title) < 2:
        raise HTTPException(status_code=400, detail="Название группы должно быть не короче 2 символов")
    if len(title) > 80:
        raise HTTPException(status_code=400, detail="Название группы слишком длинное")

    raw_ids = {
        _normalize_public_id(item)
        for item in member_ids.replace(",", " ").split()
        if item.strip()
    }
    raw_ids.discard(current.public_id)

    members = []
    if raw_ids:
        members = db.query(models.User).filter(models.User.public_id.in_(raw_ids)).all()
        found_ids = {member.public_id for member in members}
        missing_ids = sorted(raw_ids - found_ids)
        if missing_ids:
            raise HTTPException(status_code=404, detail="Не найдены ID: " + ", ".join(missing_ids))

    avatar_url = None
    if avatar and avatar.filename:
        avatar_url = await _save_image_upload(avatar, GROUP_UPLOAD_DIR)

    group = models.Group(title=title, avatar_url=avatar_url, creator_id=current.id)
    db.add(group)
    db.flush()
    db.add(models.GroupMember(group_id=group.id, user_id=current.id))

    for member in members:
        db.add(models.GroupMember(group_id=group.id, user_id=member.id))

    try:
        db.commit()
        db.refresh(group)
        return _group_to_out(db, group)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Не удалось создать группу")
    except SQLAlchemyError:
        db.rollback()
        _raise_db_help()


@app.post("/api/groups/{group_id}/members", response_model=schemas.GroupOut)
def add_group_members(
    group_id: int,
    data: schemas.GroupMembersAdd,
    db: Session = Depends(get_db),
    current: models.User = Depends(get_current_user),
):
    group = db.query(models.Group).filter(models.Group.id == group_id).first()
    if group is None:
        raise HTTPException(status_code=404, detail="Группа не найдена")
    if not _is_group_member(db, group_id, current.id):
        raise HTTPException(status_code=403, detail="Вы не состоите в этой группе")

    public_ids = {
        _normalize_public_id(public_id)
        for public_id in data.public_ids
        if public_id.strip()
    }
    public_ids.discard(current.public_id)

    if not public_ids:
        return _group_to_out(db, group)

    users = db.query(models.User).filter(models.User.public_id.in_(public_ids)).all()
    found_ids = {user.public_id for user in users}
    missing_ids = sorted(public_ids - found_ids)
    if missing_ids:
        raise HTTPException(status_code=404, detail="Не найдены ID: " + ", ".join(missing_ids))

    existing_ids = {
        row[0]
        for row in db.query(models.GroupMember.user_id)
        .filter(models.GroupMember.group_id == group_id)
        .all()
    }

    for user in users:
        if user.id not in existing_ids:
            db.add(models.GroupMember(group_id=group_id, user_id=user.id))

    try:
        db.commit()
        db.refresh(group)
        return _group_to_out(db, group)
    except IntegrityError:
        db.rollback()
        return _group_to_out(db, group)
    except SQLAlchemyError:
        db.rollback()
        _raise_db_help()


@app.get("/api/groups/{group_id}/messages", response_model=list[schemas.MessageOut])
def group_messages(
    group_id: int,
    db: Session = Depends(get_db),
    current: models.User = Depends(get_current_user),
):
    if not _is_group_member(db, group_id, current.id):
        raise HTTPException(status_code=403, detail="Вы не состоите в этой группе")

    messages = (
        db.query(models.Message)
        .filter(models.Message.group_id == group_id)
        .order_by(models.Message.created_at)
        .all()
    )
    return [_message_to_out(message) for message in messages]


@app.post("/api/groups/{group_id}/messages", response_model=schemas.MessageOut)
async def send_group_message(
    group_id: int,
    data: schemas.MessageUpdate,
    db: Session = Depends(get_db),
    current: models.User = Depends(get_current_user),
):
    if not _is_group_member(db, group_id, current.id):
        raise HTTPException(status_code=403, detail="Вы не состоите в этой группе")

    try:
        msg = models.Message(
            sender_id=current.id,
            receiver_id=None,
            group_id=group_id,
            text=data.text,
        )
        db.add(msg)
        db.commit()
        db.refresh(msg)

        member_ids = [
            row[0]
            for row in db.query(models.GroupMember.user_id)
            .filter(models.GroupMember.group_id == group_id, models.GroupMember.user_id != current.id)
            .all()
        ]
        for user_id in member_ids:
            await manager.notify_user(
                user_id,
                {"type": "new_group_message", "group_id": group_id, "from_user_id": current.id},
            )

        return _message_to_out(msg)
    except SQLAlchemyError:
        db.rollback()
        _raise_db_help()


def _message_peer_id(message: models.Message, current_user_id: int) -> int:
    return message.receiver_id if message.sender_id == current_user_id else message.sender_id


def _group_member_ids(db: Session, group_id: int) -> list[int]:
    return [
        row[0]
        for row in db.query(models.GroupMember.user_id)
        .filter(models.GroupMember.group_id == group_id)
        .all()
    ]


async def _notify_message_change(db: Session, msg: models.Message, event_type: str, current_user_id: int) -> None:
    # Уведомляет участников чата, что сообщение изменили или удалили.
    payload = {"type": event_type, "message_id": msg.id, "from_user_id": current_user_id}

    if msg.group_id is not None:
        payload["group_id"] = msg.group_id
        for user_id in _group_member_ids(db, msg.group_id):
            await manager.notify_user(user_id, payload)
        return

    if msg.receiver_id is not None:
        await manager.notify_user(msg.receiver_id, payload)

    await manager.notify_user(current_user_id, payload)


@app.post("/api/messages", response_model=schemas.MessageOut)
async def send_message(
    data: schemas.MessageCreate,
    db: Session = Depends(get_db),
    current: models.User = Depends(get_current_user),
):
    try:
        if data.receiver_id == current.id:
            raise HTTPException(status_code=400, detail="Нельзя отправить сообщение самому себе")

        receiver = db.query(models.User).filter(models.User.id == data.receiver_id).first()
        if receiver is None:
            raise HTTPException(status_code=404, detail="Получатель не найден")

        msg = models.Message(
            sender_id=current.id,
            receiver_id=data.receiver_id,
            text=data.text,
        )
        db.add(msg)
        db.commit()
        db.refresh(msg)

        await manager.notify_user(
            data.receiver_id,
            {"type": "new_message", "from_user_id": current.id},
        )
        return msg
    except HTTPException:
        raise
    except SQLAlchemyError:
        db.rollback()
        _raise_db_help()


@app.post("/api/messages/image", response_model=schemas.MessageOut)
async def send_image_message(
    receiver_id: int = Form(...),
    image: UploadFile = File(...),
    db: Session = Depends(get_db),
    current: models.User = Depends(get_current_user),
):
    try:
        if receiver_id == current.id:
            raise HTTPException(status_code=400, detail="Нельзя отправить сообщение самому себе")

        receiver = db.query(models.User).filter(models.User.id == receiver_id).first()
        if receiver is None:
            raise HTTPException(status_code=404, detail="Получатель не найден")

        image_url = await _save_image_upload(image, MESSAGE_UPLOAD_DIR)
        msg = models.Message(
            sender_id=current.id,
            receiver_id=receiver_id,
            text="",
            image_url=image_url,
        )
        db.add(msg)
        db.commit()
        db.refresh(msg)

        await manager.notify_user(
            receiver_id,
            {"type": "new_message", "from_user_id": current.id},
        )
        return msg
    except HTTPException:
        raise
    except SQLAlchemyError:
        db.rollback()
        _raise_db_help()


@app.post("/api/messages/file", response_model=schemas.MessageOut)
async def send_file_message(
    receiver_id: int = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current: models.User = Depends(get_current_user),
):
    try:
        if receiver_id == current.id:
            raise HTTPException(status_code=400, detail="Нельзя отправить сообщение самому себе")

        receiver = db.query(models.User).filter(models.User.id == receiver_id).first()
        if receiver is None:
            raise HTTPException(status_code=404, detail="Получатель не найден")

        file_url, file_name, file_size, file_content_type = await _save_file_upload(file)
        is_image = (file_content_type or "").startswith("image/")
        msg = models.Message(
            sender_id=current.id,
            receiver_id=receiver_id,
            text="",
            image_url=file_url if is_image else None,
            file_url=file_url,
            file_name=file_name,
            file_size=file_size,
            file_content_type=file_content_type,
        )
        db.add(msg)
        db.commit()
        db.refresh(msg)

        await manager.notify_user(
            receiver_id,
            {"type": "new_message", "from_user_id": current.id},
        )
        return msg
    except HTTPException:
        raise
    except SQLAlchemyError:
        db.rollback()
        _raise_db_help()


@app.patch("/api/messages/{message_id}", response_model=schemas.MessageOut)
async def edit_message(
    message_id: int,
    data: schemas.MessageUpdate,
    db: Session = Depends(get_db),
    current: models.User = Depends(get_current_user),
):
    try:
        msg = db.query(models.Message).filter(models.Message.id == message_id).first()
        if msg is None:
            raise HTTPException(status_code=404, detail="Сообщение не найдено")
        if msg.sender_id != current.id:
            raise HTTPException(status_code=403, detail="Можно редактировать только свои сообщения")
        if msg.deleted_at is not None:
            raise HTTPException(status_code=400, detail="Удаленное сообщение нельзя редактировать")
        if msg.image_url or msg.file_url:
            raise HTTPException(status_code=400, detail="Вложение редактировать нельзя")

        msg.text = data.text
        msg.edited_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(msg)

        await _notify_message_change(db, msg, "message_updated", current.id)
        return msg
    except HTTPException:
        raise
    except SQLAlchemyError:
        db.rollback()
        _raise_db_help()


@app.delete("/api/messages/{message_id}")
async def delete_message(
    message_id: int,
    db: Session = Depends(get_db),
    current: models.User = Depends(get_current_user),
):
    try:
        msg = db.query(models.Message).filter(models.Message.id == message_id).first()
        if msg is None:
            raise HTTPException(status_code=404, detail="Сообщение не найдено")
        if msg.sender_id != current.id:
            raise HTTPException(status_code=403, detail="Можно удалить только свои сообщения")
        if msg.deleted_at is None:
            msg.deleted_at = datetime.now(timezone.utc)
            msg.text = ""
            msg.image_url = None
            msg.file_url = None
            msg.file_name = None
            msg.file_size = None
            msg.file_content_type = None
            db.commit()

        await _notify_message_change(db, msg, "message_deleted", current.id)
        return {"ok": True}
    except HTTPException:
        raise
    except SQLAlchemyError:
        db.rollback()
        _raise_db_help()


@app.post("/api/messages/read")
async def mark_messages_read(
    with_user_id: int,
    db: Session = Depends(get_db),
    current: models.User = Depends(get_current_user),
):
    try:
        now = datetime.now(timezone.utc)
        messages = (
            db.query(models.Message)
            .filter(
                models.Message.sender_id == with_user_id,
                models.Message.receiver_id == current.id,
                models.Message.read_at.is_(None),
            )
            .all()
        )

        for msg in messages:
            msg.read_at = now

        if messages:
            db.commit()
            await manager.notify_user(
                with_user_id,
                {"type": "messages_read", "by_user_id": current.id},
            )

        return {"ok": True, "read": len(messages)}
    except SQLAlchemyError:
        db.rollback()
        _raise_db_help()


@app.get("/api/messages", response_model=list[schemas.MessageOut])
def conversation(
    with_user_id: int,
    db: Session = Depends(get_db),
    current: models.User = Depends(get_current_user),
):
    try:
        other = db.query(models.User).filter(models.User.id == with_user_id).first()
        if other is None:
            raise HTTPException(status_code=404, detail="Пользователь не найден")

        q = (
            db.query(models.Message)
            .filter(
                or_(
                    and_(
                        models.Message.sender_id == current.id,
                        models.Message.receiver_id == with_user_id,
                    ),
                    and_(
                        models.Message.sender_id == with_user_id,
                        models.Message.receiver_id == current.id,
                    ),
                )
            )
            .order_by(models.Message.created_at)
        )
        return q.all()
    except HTTPException:
        raise
    except SQLAlchemyError:
        _raise_db_help()


@app.websocket("/ws")
async def websocket_updates(
    websocket: WebSocket,
    token: str | None = Query(None),
):
    if not token:
        await websocket.close(code=4401)
        return

    payload = decode_access_token(token)
    if payload is None or payload.get("sub") is None:
        await websocket.close(code=4401)
        return

    try:
        user_id = int(payload["sub"])
    except (TypeError, ValueError):
        await websocket.close(code=4401)
        return

    db = SessionLocal()
    try:
        user = db.query(models.User).filter(models.User.id == user_id).first()
        if user is None:
            await websocket.close(code=4401)
            return
    finally:
        db.close()

    await manager.connect(user_id, websocket)
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                event = json.loads(raw)
            except json.JSONDecodeError:
                continue

            if event.get("type") == "active_chat":
                with_user_id = event.get("with_user_id")
                if with_user_id is None:
                    await manager.set_active_chat(user_id, None)
                else:
                    try:
                        await manager.set_active_chat(user_id, int(with_user_id))
                    except (TypeError, ValueError):
                        await manager.set_active_chat(user_id, None)
            elif event.get("type") == "typing":
                try:
                    to_user_id = int(event.get("to_user_id"))
                except (TypeError, ValueError):
                    continue

                await manager.notify_user(
                    to_user_id,
                    {
                        "type": "typing",
                        "from_user_id": user_id,
                        "typing": bool(event.get("typing")),
                    },
                )
    except WebSocketDisconnect:
        old_chat_user_id = manager.disconnect(user_id, websocket)
        if old_chat_user_id is not None:
            await manager.notify_user(
                old_chat_user_id,
                {"type": "chat_presence", "user_id": user_id, "active": False},
            )


app.mount("/static", StaticFiles(directory="static"), name="static")
app.mount("/logo", StaticFiles(directory="logo"), name="logo")


@app.get("/")
def read_index():
    return FileResponse("static/auth.html")


@app.get("/app")
def read_app():
    return FileResponse("static/index.html")
