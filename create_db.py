import models  # noqa: F401 — нужно, чтобы Base зарегистрировал таблицы

from sqlalchemy.exc import OperationalError

from database import Base, engine

print("Создаю таблицы...")
print("(Если менялась структура моделей — удалите старые таблицы в pgAdmin и запустите снова.)")
try:
    Base.metadata.create_all(bind=engine)
except OperationalError:
    print()
    print("Не удалось подключиться к PostgreSQL (чаще всего — неверный пароль или другой порт).")
    print("Сервер ответил: пользователь «postgres» не прошёл проверку по паролю.")
    try:
        u = engine.url
        print()
        print("Сейчас скрипт подключается так (пароль скрыт):")
        print(" ", u.render_as_string(hide_password=True))
    except Exception:
        pass
    print()
    print("Что сделать:")
    print("  1) В pgAdmin: правый клик по серверу → Properties → Connection — сравните Host и Port.")
    print("     Если порт не 5433, в PowerShell: $env:POSTGRES_PORT = \"5432\"  (ваш порт)")
    print("  2) Сбросьте переменные, которые часто мешают только в консоли:")
    print("       Remove-Item Env:PGPASSWORD, Env:POSTGRES_PASSWORD -ErrorAction SilentlyContinue")
    print("       python create_db.py")
    print("  3) Если пароль точно admin123 — в pgAdmin Query Tool выполните:")
    print("       ALTER ROLE postgres WITH LOGIN PASSWORD 'admin123';")
    print("  4) Явно задать пароль для скрипта: $env:POSTGRES_PASSWORD = \"admin123\"")
    print("  5) База messenger_db должна существовать (Create → Database в pgAdmin).")
    print()
    raise
print("Таблицы успешно созданы!")