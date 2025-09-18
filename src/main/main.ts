import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { listOutputDevices, startAudioCapture, stopAudioCapture } from './audio';

let mainWindow: BrowserWindow | null = null;
let dataRoot: string | null = null;

function getPythonScriptPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'py', 'process_audio.py');
  }
  return path.join(app.getAppPath(), 'py', 'process_audio.py');
}

function resolveDataPath(relativePath: string): string {
  if (!dataRoot) {
    dataRoot = path.join(app.getPath('userData'), 'pseudo-zoom-secretary');
    if (!fs.existsSync(dataRoot)) {
      fs.mkdirSync(dataRoot, { recursive: true });
    }
  }
  const resolved = path.join(dataRoot, relativePath);
  const dir = path.dirname(resolved);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return resolved;
}

function sendLog(message: string) {
  if (mainWindow) {
    mainWindow.webContents.send('log', message);
  }
  console.log(message);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      sandbox: false
    }
  });

  const rendererPath = path.join(__dirname, '../renderer/index.html');
  mainWindow.loadFile(rendererPath);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
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

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopAudioCapture();
});

ipcMain.handle('audio:listDevices', async () => {
  return listOutputDevices();
});

ipcMain.handle('audio:start', async (_event, outPath: string, deviceId?: number) => {
  try {
    const resolved = resolveDataPath(outPath);
    const filePath = startAudioCapture(resolved, deviceId);
    sendLog(`Запись начата: ${filePath}`);
    return { success: true, path: filePath };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendLog(`Ошибка запуска записи: ${message}`);
    throw error;
  }
});

ipcMain.handle('audio:stop', async () => {
  const pathCompleted = stopAudioCapture();
  if (pathCompleted) {
    sendLog(`Запись остановлена: ${pathCompleted}`);
    return { success: true, path: pathCompleted };
  }
  sendLog('Запись не была активна.');
  return { success: false };
});

ipcMain.handle('proc:run', async (event, wavRelativePath: string, options: Record<string, unknown> = {}) => {
  const wavPath = resolveDataPath(wavRelativePath);
  const scriptPath = getPythonScriptPath();
  const pythonCmd = getPythonCommand();

  return new Promise<{ success: boolean; code: number | null }>((resolve, reject) => {
    if (!fs.existsSync(wavPath)) {
      const msg = `Файл не найден: ${wavPath}`;
      sendLog(msg);
      resolve({ success: false, code: -1 });
      return;
    }

    if (!fs.existsSync(scriptPath)) {
      const msg = `Скрипт обработки не найден: ${scriptPath}`;
      sendLog(msg);
      resolve({ success: false, code: -1 });
      return;
    }

    const args = [scriptPath, wavPath, JSON.stringify(options ?? {})];
    sendLog(`Запуск обработки: ${pythonCmd} ${args.join(' ')}`);

    const child = spawn(pythonCmd, args, {
      cwd: app.getAppPath(),
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8'
      }
    });

    const logStream = (data: Buffer) => {
      const text = data.toString('utf-8');
      text.split(/\r?\n/).forEach((line) => {
        if (line.trim().length > 0) {
          event.sender.send('log', line);
        }
      });
    };

    child.stdout.on('data', logStream);
    child.stderr.on('data', logStream);

    child.on('error', (err) => {
      const message = err instanceof Error ? err.message : String(err);
      sendLog(`Ошибка запуска Python: ${message}`);
      reject(err);
    });

    child.on('close', (code) => {
      sendLog(`Обработка завершена, код ${code ?? 'null'}`);
      resolve({ success: code === 0, code });
    });
  });
});
