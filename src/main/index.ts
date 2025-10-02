import { app, BrowserWindow, ipcMain } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { listOutputDevices, startAudioCapture, stopAudioCapture } from './audio';
import type { DeviceInfo, ProcessingResult, StartAudioResult, StopAudioResult } from '../shared/types';
import { IPC_CHANNELS, LOG_CHANNEL } from '../shared/types';

let mainWindow: BrowserWindow | null = null;
let dataRoot: string | null = null;

const RECORDINGS_DIR = 'recordings';

function resolveRendererUrl() {
  if (process.env['ELECTRON_RENDERER_URL']) {
    return process.env['ELECTRON_RENDERER_URL'];
  }
  return path.join(__dirname, '../renderer/index.html');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const rendererEntry = resolveRendererUrl();
  if (rendererEntry.startsWith('http')) {
    mainWindow.loadURL(rendererEntry);
  } else {
    mainWindow.loadFile(rendererEntry);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function sendLog(message: string) {
  if (mainWindow) {
    mainWindow.webContents.send(LOG_CHANNEL, message);
  }
  console.log(message);
}

function getPythonCommand(): string {
  if (process.env.PYTHON) {
    return process.env.PYTHON;
  }
  if (process.platform === 'win32') {
    return 'python';
  }
  return 'python3';
}

function getPythonScriptPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'py', 'process_audio.py');
  }
  return path.join(app.getAppPath(), 'py', 'process_audio.py');
}

function ensureDataRoot(): string {
  if (!dataRoot) {
    dataRoot = path.join(app.getPath('userData'), 'pseudo-zoom-secretary');
    if (!fs.existsSync(dataRoot)) {
      fs.mkdirSync(dataRoot, { recursive: true });
    }
  }
  return dataRoot;
}

function resolveDataPath(relativePath: string): string {
  const root = ensureDataRoot();
  const absolutePath = path.join(root, relativePath);
  const directory = path.dirname(absolutePath);
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
  return absolutePath;
}

function wireAudioHandlers() {
  ipcMain.handle(IPC_CHANNELS.listDevices, async (): Promise<DeviceInfo[]> => {
    return listOutputDevices();
  });

  ipcMain.handle(
    IPC_CHANNELS.startAudio,
    async (_event, relativePath: string, deviceId?: number): Promise<StartAudioResult> => {
      const resolvedPath = resolveDataPath(relativePath);
      const fullPath = startAudioCapture(resolvedPath, deviceId);
      sendLog(`Запись начата: ${fullPath}`);
      return { success: true, path: fullPath };
    },
  );

  ipcMain.handle(IPC_CHANNELS.stopAudio, async (): Promise<StopAudioResult> => {
    const completed = stopAudioCapture();
    if (completed) {
      sendLog(`Запись остановлена: ${completed}`);
      return { success: true, path: completed };
    }

    sendLog('Запись не была активна.');
    return { success: false };
  });
}

function wireProcessingHandler() {
  ipcMain.handle(
    IPC_CHANNELS.runProcessing,
    async (event, wavRelativePath: string, options: Record<string, unknown> = {}): Promise<ProcessingResult> => {
      const wavPath = resolveDataPath(wavRelativePath);
      const scriptPath = getPythonScriptPath();
      const pythonCmd = getPythonCommand();

      if (!fs.existsSync(wavPath)) {
        const message = `Файл не найден: ${wavPath}`;
        sendLog(message);
        return { success: false, code: -1 };
      }

      if (!fs.existsSync(scriptPath)) {
        const message = `Скрипт обработки не найден: ${scriptPath}`;
        sendLog(message);
        return { success: false, code: -1 };
      }

      return new Promise((resolve, reject) => {
        const args = [scriptPath, wavPath, JSON.stringify(options ?? {})];
        sendLog(`Запуск обработки: ${pythonCmd} ${args.join(' ')}`);

        const child = spawn(pythonCmd, args, {
          cwd: app.getAppPath(),
          env: {
            ...process.env,
            PYTHONIOENCODING: 'utf-8',
          },
        });

        const forwardLog = (data: Buffer) => {
          data
            .toString('utf-8')
            .split(/\r?\n/)
            .filter((line) => line.trim().length > 0)
            .forEach((line) => {
              event.sender.send(LOG_CHANNEL, line);
            });
        };

        child.stdout.on('data', forwardLog);
        child.stderr.on('data', forwardLog);

        child.on('error', (error) => {
          const message = error instanceof Error ? error.message : String(error);
          sendLog(`Ошибка запуска Python: ${message}`);
          reject(error);
        });

        child.on('close', (code) => {
          sendLog(`Обработка завершена, код ${code ?? 'null'}`);
          resolve({ success: code === 0, code });
        });
      });
    },
  );
}

function registerIpcHandlers() {
  wireAudioHandlers();
  wireProcessingHandler();
}

async function prepareDirectories() {
  const root = ensureDataRoot();
  const recordingsPath = path.join(root, RECORDINGS_DIR);
  if (!fs.existsSync(recordingsPath)) {
    fs.mkdirSync(recordingsPath, { recursive: true });
  }
}

app.whenReady().then(async () => {
  await prepareDirectories();
  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', () => {
  stopAudioCapture();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
