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

  const startTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const appendLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString('ru-RU');
    setLogs((prev) => [...prev, `[${timestamp}] ${message}`]);
  };

  const refreshDevices = async () => {
    try {
      const list = await window.api.listDevices();
      setDevices(list);
      if (list.length === 0) {
        appendLog('Устройства WASAPI не найдены. Проверьте разрешения.');
      } else if (selectedDeviceId === null) {
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

  const deviceOptions = useMemo<SelectOption[]>(
    () =>
      devices.map((device) => ({
        value: device.id,
        label: `${device.name}${device.hostAPIName ? ` (${device.hostAPIName})` : ''}`
      })),
    [devices]
  );

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
    const url = buildZoomUrl();
    if (!url) {
      appendLog('Введите корректный ID встречи.');
      return;
    }

    appendLog('Открываем веб-клиент Zoom...');
    setIframeSrc(url);

    const delaySeconds = Math.max(0, Number(startDelay) || 0);
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

    const autoStop = Math.max(0, Number(autoStopMinutes) || 0);
    if (autoStop > 0) {
      const stopMs = autoStop * 60 * 1000;
      appendLog(`Авто-стоп через ${autoStop} мин.`);
      stopTimeoutRef.current = setTimeout(() => {
        stopTimeoutRef.current = null;
        appendLog('Авто-стоп: время истекло.');
        handleStop(true);
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
    <div style={{ fontFamily: 'Segoe UI, sans-serif', padding: '16px', display: 'flex', gap: '16px', height: '100vh', boxSizing: 'border-box' }}>
      <div style={{ flex: '0 0 360px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <h1 style={{ margin: 0 }}>Псевдосекретарь Zoom</h1>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span>ID встречи</span>
          <input value={meetingId} onChange={(e) => setMeetingId(e.target.value)} placeholder="123456789" />
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
          <input value={startDelay} onChange={(e) => setStartDelay(e.target.value)} type="number" min="0" />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span>Авто-стоп (мин)</span>
          <input value={autoStopMinutes} onChange={(e) => setAutoStopMinutes(e.target.value)} type="number" min="0" />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span>WASAPI loopback-устройство</span>
          <select value={selectedDeviceId ?? ''} onChange={(e) => setSelectedDeviceId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">По умолчанию (системное)</option>
            {deviceOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button onClick={handleConnectAndRecord}>Подключиться и записывать</button>
          <button onClick={() => handleStop(false)} disabled={!isRecording}>Стоп</button>
          <button onClick={handleProcess}>Обработать</button>
          <button type="button" onClick={refreshDevices}>Обновить устройства</button>
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <h2 style={{ marginTop: '8px' }}>Логи</h2>
          <pre style={{ background: '#111', color: '#0f0', padding: '12px', borderRadius: '4px', height: '100%', overflow: 'auto' }}>
            {logs.join('\n')}
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
