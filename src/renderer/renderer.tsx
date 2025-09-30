import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

type DeviceInfo = {
  id: number;
  name: string;
  hostAPIName?: string;
  maxOutputChannels: number;
};

type SelectOption = {
  value: number;
  label: string;
};

const RECORDING_PATH = 'recordings/meeting.wav';
const LOG_LIMIT = 500;

const App: React.FC = () => {
  const [meetingId, setMeetingId] = useState('');
  const [meetingPassword, setMeetingPassword] = useState('');
  const [userName, setUserName] = useState('Гость');
  const [startDelay, setStartDelay] = useState('5');
  const [autoStopMinutes, setAutoStopMinutes] = useState('0');
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<number | null>(null);
  const [iframeSrc, setIframeSrc] = useState('about:blank');
  const [isRecording, setIsRecording] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [meetingIdError, setMeetingIdError] = useState<string | null>(null);
  const [startDelayError, setStartDelayError] = useState<string | null>(null);
  const [autoStopError, setAutoStopError] = useState<string | null>(null);

  const startTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logContainerRef = useRef<HTMLPreElement | null>(null);

  const appendLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString('ru-RU');
    setLogs((prev) => {
      const next = [...prev, `[${timestamp}] ${message}`];
      return next.length > LOG_LIMIT ? next.slice(next.length - LOG_LIMIT) : next;
    });
  };

  const refreshDevices = async () => {
    try {
      const list = await window.api.listDevices();
      setDevices(list);
      if (list.length === 0) {
        appendLog('Устройства WASAPI не найдены. Проверьте разрешения.');
        setSelectedDeviceId(null);
        return;
      }

      if (selectedDeviceId === null) {
        setSelectedDeviceId(list[0].id);
        return;
      }

      const stillExists = list.some((device) => device.id === selectedDeviceId);
      if (!stillExists) {
        appendLog('Выбранное ранее устройство недоступно. Переключаемся на первое в списке.');
        setSelectedDeviceId(list[0].id);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(`Ошибка получения устройств: ${message}`);
    }
  };

  useEffect(() => {
    refreshDevices();
    const unsubscribe = window.api.onLog((line) => {
      appendLog(line);
    });
    return () => {
      unsubscribe();
      if (startTimeoutRef.current) {
        clearTimeout(startTimeoutRef.current);
      }
      if (stopTimeoutRef.current) {
        clearTimeout(stopTimeoutRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  const deviceOptions = useMemo<SelectOption[]>(
    () =>
      devices.map((device) => ({
        value: device.id,
        label: `${device.name}${device.hostAPIName ? ` (${device.hostAPIName})` : ''}`
      })),
    [devices]
  );

  const parsePositiveNumber = (value: string) => {
    if (value.trim().length === 0) {
      return 0;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return null;
    }
    return parsed;
  };

  const meetingIdIsValid = useMemo(() => {
    if (meetingId.trim().length === 0) {
      return false;
    }
    return /^\d{9,12}$/.test(meetingId.trim());
  }, [meetingId]);

  const buildZoomUrl = () => {
    const trimmedId = meetingId.trim();
    if (!trimmedId) {
      return '';
    }
    const params = new URLSearchParams();
    if (meetingPassword.trim().length > 0) {
      params.set('pwd', meetingPassword.trim());
    }
    params.set('uname', userName.trim() || 'Гость');
    return `https://zoom.us/wc/join/${encodeURIComponent(trimmedId)}?${params.toString()}`;
  };

  const stopTimers = () => {
    if (startTimeoutRef.current) {
      clearTimeout(startTimeoutRef.current);
      startTimeoutRef.current = null;
    }
    if (stopTimeoutRef.current) {
      clearTimeout(stopTimeoutRef.current);
      stopTimeoutRef.current = null;
    }
  };

  const handleStop = async (silent = false) => {
    stopTimers();
    if (!isRecording) {
      if (!silent) {
        appendLog('Запись не активна.');
      }
      return;
    }
    try {
      const result = await window.api.stopAudio();
      if (result?.success) {
        appendLog(`Запись остановлена. Файл: ${result.path ?? RECORDING_PATH}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(`Ошибка остановки записи: ${message}`);
    } finally {
      setIsRecording(false);
    }
  };

  const handleConnectAndRecord = async () => {
    stopTimers();
    if (isRecording) {
      appendLog('Запись уже активна. Сначала остановите текущий сеанс.');
      return;
    }
    const trimmedId = meetingId.trim();
    let hasError = false;
    if (!/^\d{9,12}$/.test(trimmedId)) {
      setMeetingIdError('ID встречи должен содержать 9–12 цифр.');
      appendLog('Введите корректный ID встречи (9–12 цифр).');
      hasError = true;
    } else {
      setMeetingIdError(null);
    }

    const parsedDelay = parsePositiveNumber(startDelay);
    if (parsedDelay === null) {
      setStartDelayError('Значение должно быть неотрицательным числом.');
      appendLog('Проверьте значение задержки перед стартом записи.');
      hasError = true;
    } else {
      setStartDelayError(null);
    }

    const parsedAutoStop = parsePositiveNumber(autoStopMinutes);
    if (parsedAutoStop === null) {
      setAutoStopError('Значение должно быть неотрицательным числом.');
      appendLog('Проверьте значение авто-остановки.');
      hasError = true;
    } else {
      setAutoStopError(null);
    }

    if (hasError) {
      return;
    }

    const url = buildZoomUrl();
    if (!url) {
      appendLog('Введите корректный ID встречи.');
      return;
    }

    appendLog('Открываем веб-клиент Zoom...');
    setIframeSrc(url);

    const delaySeconds = parsedDelay ?? 0;
    const delayMs = delaySeconds * 1000;
    appendLog(`Запуск записи через ${delaySeconds} с.`);

    startTimeoutRef.current = setTimeout(async () => {
      startTimeoutRef.current = null;
      try {
        const result = await window.api.startAudio(selectedDeviceId, RECORDING_PATH);
        if (result && typeof result === 'object' && 'success' in result && result.success) {
          appendLog(`Захват аудио запущен. Путь: ${result.path ?? RECORDING_PATH}`);
          setIsRecording(true);
        } else {
          appendLog('Не удалось запустить запись аудио.');
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        appendLog(`Ошибка запуска записи: ${message}`);
      }
    }, delayMs);

    const autoStop = parsedAutoStop ?? 0;
    if (autoStop > 0) {
      const stopMs = autoStop * 60 * 1000;
      appendLog(`Авто-стоп через ${autoStop} мин.`);
      stopTimeoutRef.current = setTimeout(() => {
        stopTimeoutRef.current = null;
        appendLog('Авто-стоп: время истекло.');
        void handleStop(true);
      }, stopMs);
    }
  };

  const handleProcess = async () => {
    appendLog('Запуск обработки аудио...');
    try {
      const result = await window.api.runProcess(RECORDING_PATH, {});
      if (result && typeof result === 'object' && 'success' in result) {
        appendLog(result.success ? 'Обработка завершена успешно.' : `Обработка завершилась с кодом ${String(result.code)}`);
      } else {
        appendLog('Не удалось получить результат обработки.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(`Ошибка обработки: ${message}`);
    }
  };

  return (
    <div
      style={{
        fontFamily: 'Segoe UI, sans-serif',
        padding: '16px',
        display: 'flex',
        gap: '16px',
        height: '100vh',
        boxSizing: 'border-box'
      }}
    >
      <div style={{ flex: '0 0 360px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <h1 style={{ margin: 0 }}>Псевдосекретарь Zoom</h1>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span>ID встречи</span>
          <input
            value={meetingId}
            onChange={(e) => {
              setMeetingId(e.target.value.replace(/[^\d]/g, ''));
              if (meetingIdError) {
                setMeetingIdError(null);
              }
            }}
            placeholder="123456789"
            aria-invalid={Boolean(meetingIdError)}
          />
          {meetingIdError ? (
            <span style={{ color: '#c0392b', fontSize: '12px' }}>{meetingIdError}</span>
          ) : (
            <span style={{ color: '#666', fontSize: '12px' }}>9–12 цифр, без пробелов</span>
          )}
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span>Пароль</span>
          <input value={meetingPassword} onChange={(e) => setMeetingPassword(e.target.value)} placeholder="Пароль" />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span>Имя</span>
          <input value={userName} onChange={(e) => setUserName(e.target.value)} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span>Задержка (сек)</span>
          <input
            value={startDelay}
            onChange={(e) => {
              setStartDelay(e.target.value);
              if (startDelayError) {
                setStartDelayError(null);
              }
            }}
            type="number"
            min="0"
            aria-invalid={Boolean(startDelayError)}
          />
          {startDelayError && <span style={{ color: '#c0392b', fontSize: '12px' }}>{startDelayError}</span>}
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span>Авто-стоп (мин)</span>
          <input
            value={autoStopMinutes}
            onChange={(e) => {
              setAutoStopMinutes(e.target.value);
              if (autoStopError) {
                setAutoStopError(null);
              }
            }}
            type="number"
            min="0"
            aria-invalid={Boolean(autoStopError)}
          />
          {autoStopError && <span style={{ color: '#c0392b', fontSize: '12px' }}>{autoStopError}</span>}
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span>WASAPI loopback-устройство</span>
          <select
            value={selectedDeviceId ?? ''}
            onChange={(e) => setSelectedDeviceId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">По умолчанию (системное)</option>
            {deviceOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button onClick={handleConnectAndRecord} disabled={!meetingIdIsValid || isRecording}>
            Подключиться и записывать
          </button>
          <button onClick={() => handleStop(false)} disabled={!isRecording}>Стоп</button>
          <button onClick={handleProcess}>Обработать</button>
          <button type="button" onClick={refreshDevices}>Обновить устройства</button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: '8px 0 0' }}>Логи</h2>
          <button type="button" onClick={() => setLogs([])} disabled={logs.length === 0}>
            Очистить
          </button>
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <pre
            ref={logContainerRef}
            style={{
              background: '#111',
              color: '#0f0',
              padding: '12px',
              borderRadius: '4px',
              height: '100%',
              overflow: 'auto',
              margin: 0
            }}
          >
            {logs.join('\n') || 'Логи появятся здесь'}
          </pre>
        </div>
      </div>
      <div style={{ flex: 1, border: '1px solid #ccc', borderRadius: '8px', overflow: 'hidden', minHeight: 0 }}>
        <iframe
          id="zoom"
          title="Zoom Web Client"
          src={iframeSrc}
          style={{ width: '100%', height: '100%', border: 'none' }}
          allow="microphone; camera; fullscreen; autoplay"
        />
      </div>
    </div>
  );
};

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
