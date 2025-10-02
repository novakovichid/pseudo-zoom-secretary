# pseudo-zoom-secretary

**Псевдоклиент Zoom с записью системного аудио и локальной пост-обработкой.**

Новая версия проекта построена на [Electron](https://www.electronjs.org/), [React](https://react.dev/) и сборщике
[electron-vite](https://github.com/alex8088/electron-vite). Интерфейс открывает веб-клиент Zoom во встроенном iframe,
перехватывает системный звук через WASAPI loopback (`naudiodon`) и запускает Python-скрипт для VAD/диаризации и распознавания речи.

## Требования

- Node.js 18+ (рекомендовано 20 LTS)
- npm
- Python 3.10+
- `ffmpeg` в `PATH`
- Windows 10/11 с поддержкой WASAPI loopback

## Установка

```bash
npm install
cd py
python -m venv .venv
# Windows PowerShell
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## Скрипты npm

| Скрипт             | Назначение                                                                 |
| ------------------ | --------------------------------------------------------------------------- |
| `npm run dev`      | Горячая разработка: запускает Vite для renderer и Electron с HMR.           |
| `npm run build`    | Собирает main/preload/renderer в `dist/` (использует electron-vite).        |
| `npm run preview`  | Запускает уже собранное приложение из `dist/` без упаковки.                 |
| `npm start`        | Собирает проект и запускает production-билд Electron.                       |
| `npm run dist`     | Полная сборка установщика через `electron-builder`.                         |
| `npm run lint`     | Типовой аудит: `tsc --noEmit`.                                              |

## Структура

```
pseudo-zoom-secretary/
  package.json
  electron.vite.config.ts
  electron-builder.config.cjs
  src/
    main/
      index.ts
      audio.ts
    preload/
      index.ts
    renderer/
      index.html
      src/
        App.tsx
        main.tsx
        components/
        hooks/
        styles/
    shared/
      types.ts
  py/
    process_audio.py
    requirements.txt
```

## Использование

1. Запустите `npm run dev`, чтобы открыть приложение с горячей перезагрузкой интерфейса.
2. Введите **ID встречи Zoom** (9–12 цифр), при необходимости пароль и отображаемое имя.
3. Выберите устройство вывода WASAPI (loopback). При старте запись сохранится в `recordings/meeting.wav` внутри каталога данных пользователя (`%APPDATA%/pseudo-zoom-secretary`).
4. Настройте задержку перед стартом и авто-остановку по таймеру, затем нажмите «Подключиться и записывать».
5. После встречи остановите запись и запустите «Обработать запись» — будет вызван `py/process_audio.py`.

## Примечания

- Приложение рассчитано на Windows: Mac/Linux не поддерживают loopback через `naudiodon`.
- Перед записью предупредите участников и соблюдайте политику безопасности вашей организации.
- Для корректной работы Python-обработки убедитесь, что виртуальное окружение активировано и зависимости установлены.
