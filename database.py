import os
import urllib.parse

from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

def _postgres_password() -> str:
    # Не читаем PGPASSWORD: в Windows он часто остаётся от других программ и ломает вход,
    # тогда как pgAdmin берёт пароль только из сохранённого подключения.
    raw = os.environ.get("POSTGRES_PASSWORD")
    if raw is not None and str(raw).strip() != "":
        return str(raw).strip()
    return "admin123"


password = _postgres_password()
username = os.environ.get("POSTGRES_USER", "postgres")
host = os.environ.get("POSTGRES_HOST", "127.0.0.1")
port = os.environ.get("POSTGRES_PORT", "5433")
db_name = os.environ.get("POSTGRES_DB", "messenger_db")

# postgresql+psycopg — драйвер psycopg 3. На Windows с локалью RU/DE и т.п. psycopg2
# часто даёт UnicodeDecodeError при разборе сообщений сервера (не UTF-8).
DATABASE_URL = (
    f"postgresql+psycopg://{username}:{urllib.parse.quote(password)}"
    f"@{host}:{port}/{db_name}"
)

# engine - общий объект подключения SQLAlchemy к PostgreSQL.
engine = create_engine(DATABASE_URL)
# SessionLocal создает отдельную сессию БД на каждый HTTP-запрос.
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
# Base - базовый класс, от которого наследуются ORM-модели User и Message.
Base = declarative_base()
