# Восстановление backup базы

В проекте есть файл `messenger_db.backup`. Его можно использовать, если нужно восстановить старую базу.

## Через pgAdmin

1. Открыть pgAdmin.
2. Создать базу `messenger_db`, если ее нет.
3. Нажать правой кнопкой по базе.
4. Выбрать `Restore`.
5. В `Filename` выбрать `messenger_db.backup`.
6. Запустить восстановление.

## Перед восстановлением

Если в базе уже есть таблицы и данные, лучше сначала очистить или пересоздать базу.

Очистить текущие данные:

```sql
TRUNCATE TABLE messages, contacts, group_members, groups, users RESTART IDENTITY CASCADE;
```

Если структура сильно отличается, проще удалить базу `messenger_db`, создать заново и восстановить backup.

## После восстановления

Запустить проект:

```powershell
python -m uvicorn main:app --reload
```

Проверить:

```text
http://127.0.0.1:8000/api/health/db
```
