from datetime import datetime

from pydantic import BaseModel, Field


EMAIL_PATTERN = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"


class UserCreate(BaseModel):
    # Данные, которые frontend отправляет при регистрации.
    email: str = Field(..., min_length=5, max_length=255, pattern=EMAIL_PATTERN)
    username: str = Field(..., min_length=2, max_length=50)
    password: str = Field(..., min_length=4, max_length=128)


class UserLogin(BaseModel):
    email: str = Field(..., min_length=5, max_length=255, pattern=EMAIL_PATTERN)
    password: str


class UserOut(BaseModel):
    # Наружу отдаем только безопасные данные, без пароля и хеша.
    model_config = {"from_attributes": True}

    id: int
    email: str
    username: str
    public_id: str
    avatar_url: str | None = None


class ContactCreate(BaseModel):
    public_id: str = Field(..., min_length=4, max_length=8)


class GroupMemberOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    username: str
    public_id: str
    avatar_url: str | None = None


class GroupOut(BaseModel):
    id: int
    title: str
    avatar_url: str | None = None
    members: list[GroupMemberOut] = []


class GroupMembersAdd(BaseModel):
    public_ids: list[str] = Field(default_factory=list, max_length=100)


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class ForgotPasswordRequest(BaseModel):
    email: str = Field(..., min_length=5, max_length=255, pattern=EMAIL_PATTERN)


class ForgotPasswordOut(BaseModel):
    message: str
    dev_reset_token: str | None = None


class ResetPasswordRequest(BaseModel):
    email: str = Field(..., min_length=5, max_length=255, pattern=EMAIL_PATTERN)
    reset_token: str = Field(..., min_length=6, max_length=64)
    new_password: str = Field(..., min_length=4, max_length=128)


class MessageCreate(BaseModel):
    receiver_id: int = Field(..., ge=1)
    text: str = Field(..., min_length=1, max_length=2000)


class MessageUpdate(BaseModel):
    text: str = Field(..., min_length=1, max_length=2000)


class MessageOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    sender_id: int
    receiver_id: int | None = None
    group_id: int | None = None
    sender_username: str | None = None
    text: str
    image_url: str | None = None
    file_url: str | None = None
    file_name: str | None = None
    file_size: int | None = None
    file_content_type: str | None = None
    created_at: datetime
    edited_at: datetime | None = None
    deleted_at: datetime | None = None
    read_at: datetime | None = None
