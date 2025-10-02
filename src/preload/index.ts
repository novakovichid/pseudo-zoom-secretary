import { contextBridge, ipcRenderer } from 'electron';
import type { RendererApi } from '../shared/types';
import { IPC_CHANNELS, LOG_CHANNEL } from '../shared/types';

const api: RendererApi = {
  listDevices: () => ipcRenderer.invoke(IPC_CHANNELS.listDevices),
  startAudio: (relativePath, deviceId) =>
    ipcRenderer.invoke(IPC_CHANNELS.startAudio, relativePath, deviceId),
  stopAudio: () => ipcRenderer.invoke(IPC_CHANNELS.stopAudio),
  runProcessing: (wavRelativePath, options) =>
    ipcRenderer.invoke(IPC_CHANNELS.runProcessing, wavRelativePath, options ?? {}),
  onLog: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, line: string) => {
      listener(line);
    };

    ipcRenderer.on(LOG_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(LOG_CHANNEL, handler);
    };
  },
};

contextBridge.exposeInMainWorld('api', api);

declare global {
  interface Window {
    api: RendererApi;
  }
}
