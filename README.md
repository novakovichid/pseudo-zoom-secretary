# pseudo-zoom-secretary

**Псевдоклиент Zoom с записью и локальной транскрибацией.** Приложение на базе Electron оборачивает веб-клиент Zoom, автоматически включает запись системного звука через WASAPI loopback (PortAudio/naudiodon), а затем обрабатывает аудио локально: фильтрует голосовые участки, выполняет диаризацию по MFCC и распознаёт речь моделью Whisper (faster-whisper).

## Требования

- Node.js 18 или 20, npm
- Python 3.13+
- Установленный `ffmpeg` в `PATH`
- Windows 10/11 с поддержкой WASAPI loopback

## Установка

```bash
npm install
cd py
py -3.13 -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
```

## Скрипты

- `npm run dev` — быстрый запуск Electron (перед стартом автоматически собирает TypeScript).
- `npm start` — запуск приложения в режиме production-пакета (также пересобирает TypeScript).
- `npm run build` — сборка инсталлятора через `electron-builder`.

## Использование

1. Запустите `npm run dev` (или `npm start`).
2. Введите **ID встречи**, **пароль** и **имя** участника.
3. Выберите доступное **WASAPI loopback-устройство** (или оставьте значение по умолчанию).
4. Настройте задержку перед стартом записи и авто-стоп по времени.
5. Нажмите **«Подключиться и записывать»** — через указанное время начнётся захват аудио в `recordings/meeting.wav` (каталог данных приложения в `%APPDATA%/pseudo-zoom-secretary`).
6. По окончании встречи нажмите **«Стоп»**.
7. Для пост-обработки нажмите **«Обработать»**. Скрипт `py/process_audio.py` выполнит VAD → диаризацию → ASR и создаст `transcript_speakers.txt` и `transcript_speakers.srt` рядом с WAV.

## Структура проекта

```
pseudo-zoom-secretary/
  package.json
  electron.vite.config.ts
  src/
    main/
      main.ts
      audio.ts
    preload/
      preload.ts
    renderer/
      index.html
      renderer.tsx
  py/
    process_audio.py
    requirements.txt
  README.md
```

## Примечания

- Интерфейс полностью на русском языке и оптимизирован под Windows.
- Перед записью предупредите участников встречи — соблюдайте законы и внутренние политики.
- Для стабильного распознавания речи убедитесь в наличии достаточных ресурсов CPU и дискового пространства.
