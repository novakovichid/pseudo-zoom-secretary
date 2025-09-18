import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

type DeviceInfo = {
  id: number;
  name: string;
  hostAPIName?: string;
  maxOutputChannels: number;
};

type LogCallback = (message: string) => void;

declare global {
  interface Window {
    api: {
      listDevices: () => Promise<DeviceInfo[]>;
      startAudio: (deviceId: number | null | undefined, outPath: string) => Promise<unknown>;
      stopAudio: () => Promise<unknown>;
      runProcess: (wavPath: string, options?: Record<string, unknown>) => Promise<unknown>;
      onLog: (callback: LogCallback) => () => void;
    };
  }
}

contextBridge.exposeInMainWorld('api', {
  listDevices: () => ipcRenderer.invoke('audio:listDevices'),
  startAudio: (deviceId: number | null | undefined, outPath: string) =>
    ipcRenderer.invoke('audio:start', outPath, deviceId ?? undefined),
  stopAudio: () => ipcRenderer.invoke('audio:stop'),
  runProcess: (wavPath: string, options: Record<string, unknown> = {}) =>
    ipcRenderer.invoke('proc:run', wavPath, options),
  onLog: (callback: LogCallback) => {
    const listener = (_event: IpcRendererEvent, message: string) => {
      callback(message);
    };
    ipcRenderer.on('log', listener);
    return () => {
      ipcRenderer.removeListener('log', listener);
    };
  }
});
