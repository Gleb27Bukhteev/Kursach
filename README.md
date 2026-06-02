# Kursach Messenger

Учебный мессенджер на FastAPI, PostgreSQL и обычном HTML/CSS/JavaScript.

## Быстрый старт

Сначала поставить зависимости из `requirements.txt`:

```powershell
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
```

Создать базу данных `messenger_db` в PostgreSQL/pgAdmin и запустить создание таблиц:

```powershell
python create_db.py
```

Запустить сервер:

```powershell
python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

Открыть сайт:

```text
http://127.0.0.1:8000
```

Документация API:

```text
http://127.0.0.1:8000/docs
```

## Что есть в проекте

- регистрация и вход;
- восстановление пароля;
- личные сообщения;
- групповые чаты;
- поиск пользователя по публичному ID;
- аватары пользователей и групп;
- отправка картинок и файлов;
- редактирование и удаление своих сообщений;
- отметка прочтения;
- WebSocket для новых сообщений, статусов и "печатает".

## Основные файлы

```text
main.py                 API, WebSocket, загрузка файлов, главная логика сервера.
database.py             Подключение к PostgreSQL.
models.py               Таблицы SQLAlchemy.
schemas.py              Схемы данных Pydantic.
deps.py                 Подключение к БД и проверка текущего пользователя.
security.py             Пароли и JWT-токены.
create_db.py            Создание таблиц.
requirements.txt        Зависимости Python.
start_lan.bat           Запуск для телефона/локальной сети.
static/auth.html        Вход, регистрация, восстановление пароля.
static/index.html       Страница мессенджера.
static/css/styles.css   Стили.
static/js/shared.js     Общие функции frontend.
static/js/auth.js       Логика авторизации.
static/js/messenger.js  Логика чатов.
static/uploads/         Загруженные файлы и аватары.
md/                     Дополнительные пояснения.
```

## Настройки базы

По умолчанию:

```text
POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=5433
POSTGRES_USER=postgres
POSTGRES_PASSWORD=admin123
POSTGRES_DB=messenger_db
```

Если у вас другой порт или пароль, можно задать в PowerShell:

```powershell
$env:POSTGRES_PORT = "5432"
$env:POSTGRES_PASSWORD = "ваш_пароль"
```

## API

Для закрытых запросов нужен токен:

```text
Authorization: Bearer <access_token>
```

Главные endpoints:

```text
GET  /api/health
GET  /api/health/db

POST /api/auth/register
POST /api/auth/login
POST /api/auth/forgot-password
POST /api/auth/reset-password

GET  /api/users/me
POST /api/users/avatar
GET  /api/users
GET  /api/users/search?public_id=XXXXXX
POST /api/contacts

GET  /api/groups
POST /api/groups
POST /api/groups/{group_id}/members
GET  /api/groups/{group_id}/messages
POST /api/groups/{group_id}/messages

GET    /api/messages?with_user_id=1
POST   /api/messages
POST   /api/messages/image
POST   /api/messages/file
PATCH  /api/messages/{message_id}
DELETE /api/messages/{message_id}
POST   /api/messages/read?with_user_id=1

WS /ws?token=<access_token>
```

## Важные команды

Проверить Python:

```powershell
python -m compileall main.py models.py schemas.py database.py deps.py security.py
```

Проверить JavaScript:

```powershell
node --check static\js\messenger.js
```

Запустить для телефона в одной Wi-Fi сети:

```powershell
.\start_lan.bat
```

Очистить пользователей, чаты и сообщения в базе:

```sql
TRUNCATE TABLE messages, contacts, group_members, groups, users RESTART IDENTITY CASCADE;
```

## Если что-то не работает

- Проверьте, что PostgreSQL запущен.
- Проверьте, что база `messenger_db` создана.
- Если порт PostgreSQL не `5433`, поменяйте `POSTGRES_PORT`.
- Если браузер берет старый JS, увеличьте `v=` у `messenger.js` в `static/index.html`.
- Для входа с телефона запускайте `start_lan.bat` и разрешите Python в Windows Firewall.
