# Объяснение проекта

`Kursach Messenger` - учебный веб-мессенджер. Сервер написан на FastAPI, данные хранятся в PostgreSQL, интерфейс сделан на HTML/CSS/JavaScript без отдельного frontend-фреймворка.

## Как работает

1. Пользователь открывает `/`.
2. `static/auth.html` показывает вход, регистрацию или восстановление пароля.
3. После входа сервер выдает JWT-токен.
4. Frontend сохраняет токен в `localStorage`.
5. Пользователь попадает на `/app`.
6. `static/js/messenger.js` загружает профиль, контакты, группы и подключает WebSocket.
7. Сообщения отправляются через REST API.
8. WebSocket сообщает о новых сообщениях, редактировании, удалении, прочтении и статусе "печатает".

## Главные части

```text
main.py                 Роуты API, WebSocket, загрузка файлов.
database.py             Подключение к PostgreSQL.
models.py               Таблицы БД.
schemas.py              Проверка данных через Pydantic.
deps.py                 Зависимости FastAPI.
security.py             Хеширование паролей и JWT.
static/auth.html        Страница входа.
static/index.html       Страница мессенджера.
static/js/auth.js       Логика входа/регистрации.
static/js/messenger.js  Логика чатов.
```

## Что умеет приложение

- регистрация и вход;
- восстановление пароля;
- публичный ID пользователя;
- поиск и добавление контактов;
- личные чаты;
- группы;
- аватары;
- картинки и файлы;
- редактирование и удаление сообщений;
- отметка прочтения;
- WebSocket-уведомления.

## База данных

Основные таблицы:

```text
users           Пользователи.
contacts        Контакты пользователей.
groups          Группы.
group_members   Участники групп.
messages        Сообщения.
```

`messages` может хранить личное сообщение или сообщение группы. Для личного сообщения заполнен `receiver_id`, для группового - `group_id`.

## API кратко

```text
POST /api/auth/register
POST /api/auth/login
GET  /api/users/me
GET  /api/users
GET  /api/users/search
POST /api/contacts
GET  /api/groups
POST /api/groups
GET  /api/messages
POST /api/messages
PATCH /api/messages/{message_id}
DELETE /api/messages/{message_id}
WS   /ws
```

Полный список удобнее смотреть в Swagger:

```text
http://127.0.0.1:8000/docs
```

## Почему нужен токен

После входа сервер возвращает JWT. Frontend отправляет его в заголовке:

```text
Authorization: Bearer <token>
```

Так сервер понимает, какой пользователь делает запрос.
