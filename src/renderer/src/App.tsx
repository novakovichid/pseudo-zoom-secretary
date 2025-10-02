import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import SectionCard from './components/SectionCard';
import { useLogBuffer } from './hooks/useLogBuffer';
import type { DeviceInfo } from '../../shared/types';

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
  const [isStarting, setIsStarting] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [meetingIdError, setMeetingIdError] = useState<string | null>(null);
  const [startDelayError, setStartDelayError] = useState<string | null>(null);
  const [autoStopError, setAutoStopError] = useState<string | null>(null);

  const { lines: logs, push: pushLog } = useLogBuffer(LOG_LIMIT);
  const logContainerRef = useRef<HTMLDivElement | null>(null);
  const startTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const appendLog = useCallback(
    (message: string) => {
      const timestamp = new Date().toLocaleTimeString('ru-RU');
      pushLog(`[${timestamp}] ${message}`);
    },
    [pushLog],
  );

  const refreshDevices = useCallback(async () => {
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

      const exists = list.some((device) => device.id === selectedDeviceId);
      if (!exists) {
        appendLog('Выбранное ранее устройство недоступно. Переключаемся на первое в списке.');
        setSelectedDeviceId(list[0].id);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(`Ошибка получения устройств: ${message}`);
    }
  }, [appendLog, selectedDeviceId]);

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
  }, [appendLog, refreshDevices]);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  const deviceOptions = useMemo(
    () =>
      devices.map((device) => ({
        value: device.id,
        label: `${device.name}${device.hostAPIName ? ` (${device.hostAPIName})` : ''}`,
      })),
    [devices],
  );

  const meetingIdIsValid = useMemo(() => {
    if (meetingId.trim().length === 0) {
      return false;
    }
    return /^\d{9,12}$/.test(meetingId.trim());
  }, [meetingId]);

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

  const buildZoomUrl = useCallback(() => {
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
  }, [meetingId, meetingPassword, userName]);

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

  const startRecording = useCallback(async () => {
    if (isRecording) {
      appendLog('Запись уже активна.');
      return;
    }

    try {
      setIsStarting(true);
      const result = await window.api.startAudio(RECORDING_PATH, selectedDeviceId ?? undefined);
      if (result.success) {
        setIsRecording(true);
        appendLog(`Запись начата. Файл: ${result.path}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(`Ошибка запуска записи: ${message}`);
    } finally {
      setIsStarting(false);
    }
  }, [appendLog, isRecording, selectedDeviceId]);

  const handleStop = useCallback(
    async (silent = false) => {
      stopTimers();
      if (!isRecording) {
        if (!silent) {
          appendLog('Запись не активна.');
        }
        return;
      }

      try {
        const result = await window.api.stopAudio();
        if (result.success) {
          appendLog(`Запись остановлена. Файл: ${result.path ?? RECORDING_PATH}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        appendLog(`Ошибка остановки записи: ${message}`);
      } finally {
        setIsRecording(false);
      }
    },
    [appendLog, isRecording],
  );

  const handleConnectAndRecord = async () => {
    stopTimers();

    if (isRecording) {
      appendLog('Запись уже активна. Сначала остановите текущий сеанс.');
      return;
    }

    let hasError = false;

    if (!/^\d{9,12}$/.test(meetingId.trim())) {
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

    const zoomUrl = buildZoomUrl();
    if (!zoomUrl) {
      appendLog('Не удалось сформировать ссылку на Zoom.');
      return;
    }

    setIframeSrc(zoomUrl);
    appendLog('Открываем веб-клиент Zoom...');

    const delayMs = parsedDelay! * 1000;
    if (delayMs === 0) {
      await startRecording();
    } else {
      appendLog(`Старт записи через ${parsedDelay} сек.`);
      startTimeoutRef.current = setTimeout(() => {
        startRecording();
        startTimeoutRef.current = null;
      }, delayMs);
    }

    if (parsedAutoStop && parsedAutoStop > 0) {
      const autoStopMs = parsedAutoStop * 60 * 1000;
      appendLog(`Авто-остановка через ${parsedAutoStop} мин.`);
      stopTimeoutRef.current = setTimeout(() => {
        handleStop(true).catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          appendLog(`Ошибка авто-остановки: ${message}`);
        });
        stopTimeoutRef.current = null;
      }, autoStopMs);
    }
  };

  const handleProcessRecording = async () => {
    setIsProcessing(true);
    try {
      appendLog('Запускаем обработку записи...');
      const result = await window.api.runProcessing(RECORDING_PATH, {});
      if (result.success) {
        appendLog('Обработка завершена успешно.');
      } else {
        appendLog(`Скрипт завершился с кодом ${result.code}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(`Ошибка обработки: ${message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const statusBadge = (
    <span className={`status-badge${isRecording ? ' status-badge--active' : ''}`}>
      <span className="status-dot" />
      {isRecording ? 'Запись активна' : 'Запись не активна'}
    </span>
  );

  return (
    <main>
      <SectionCard
        title="Подключение и запись"
        description="Введите данные встречи и управляйте записью системного аудио."
        actions={statusBadge}
      >
        <div className="form-grid">
          <label>
            ID встречи
            <input value={meetingId} onChange={(event) => setMeetingId(event.target.value)} placeholder="1234567890" />
            {meetingIdError && <span className="error-message">{meetingIdError}</span>}
          </label>
          <label>
            Пароль
            <input value={meetingPassword} onChange={(event) => setMeetingPassword(event.target.value)} placeholder="Пароль (опционально)" />
          </label>
          <label>
            Имя участника
            <input value={userName} onChange={(event) => setUserName(event.target.value)} placeholder="Отображаемое имя" />
          </label>
          <label>
            Устройство вывода (WASAPI)
            <select
              value={selectedDeviceId ?? ''}
              onChange={(event) => setSelectedDeviceId(event.target.value ? Number(event.target.value) : null)}
            >
              {deviceOptions.length === 0 && <option value="">Устройства не найдены</option>}
              {deviceOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Задержка перед стартом (сек)
            <input value={startDelay} onChange={(event) => setStartDelay(event.target.value)} />
            {startDelayError && <span className="error-message">{startDelayError}</span>}
          </label>
          <label>
            Авто-остановка (мин)
            <input value={autoStopMinutes} onChange={(event) => setAutoStopMinutes(event.target.value)} />
            {autoStopError && <span className="error-message">{autoStopError}</span>}
          </label>
          <div className="form-grid__full button-group">
            <button
              className="button"
              type="button"
              onClick={handleConnectAndRecord}
              disabled={!meetingIdIsValid || isRecording || isStarting}
            >
              {isStarting ? 'Запуск...' : 'Подключиться и записывать'}
            </button>
            <button className="button button--danger" type="button" onClick={() => handleStop()} disabled={!isRecording}>
              Стоп
            </button>
            <button className="button button--outline" type="button" onClick={refreshDevices}>
              Обновить устройства
            </button>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Логи" description="Сообщения приложения и скриптов Python.">
        <div ref={logContainerRef} className="log-viewer">
          {logs.length === 0 ? (
            <p>Логи появятся после запуска приложения.</p>
          ) : (
            logs.map((log, index) => <div key={`${index}-${log}`}>{log}</div>)
          )}
        </div>
        <div className="button-group">
          <button
            className="button button--outline"
            type="button"
            onClick={() => appendLog('────────────────────')}
          >
            Добавить разделитель
          </button>
          <button
            className="button button--outline"
            type="button"
            onClick={async () => {
              if (logs.length === 0) {
                appendLog('Буфер логов пуст.');
                return;
              }
              if (!navigator.clipboard) {
                appendLog('Буфер обмена недоступен в текущем контексте.');
                return;
              }
              try {
                await navigator.clipboard.writeText(logs.join('\n'));
                appendLog('Логи скопированы в буфер обмена.');
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                appendLog(`Не удалось скопировать логи: ${message}`);
              }
            }}
          >
            Скопировать
          </button>
        </div>
      </SectionCard>

      <SectionCard
        title="Zoom"
        description="Веб-клиент Zoom открывается в iframe. Авторизуйтесь и управляйте встречей."
      >
        <iframe className="zoom-frame" src={iframeSrc} title="Zoom Web Client" allow="microphone; camera; display-capture" />
        <div className="button-group">
          <button
            className="button"
            type="button"
            onClick={handleProcessRecording}
            disabled={isRecording || isProcessing}
          >
            {isProcessing ? 'Обработка...' : 'Обработать запись'}
          </button>
        </div>
      </SectionCard>
    </main>
  );
};

export default App;
