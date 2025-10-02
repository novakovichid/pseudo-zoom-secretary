export type DeviceInfo = {
  id: number;
  name: string;
  hostAPIName?: string;
  maxOutputChannels: number;
};

export type StartAudioResult = {
  success: boolean;
  path: string;
};

export type StopAudioResult = {
  success: boolean;
  path?: string;
};

export type ProcessingResult = {
  success: boolean;
  code: number | null;
};

export type RendererApi = {
  listDevices: () => Promise<DeviceInfo[]>;
  startAudio: (relativePath: string, deviceId?: number) => Promise<StartAudioResult>;
  stopAudio: () => Promise<StopAudioResult>;
  runProcessing: (
    wavRelativePath: string,
    options?: Record<string, unknown>
  ) => Promise<ProcessingResult>;
  onLog: (listener: (line: string) => void) => () => void;
};

export const LOG_CHANNEL = 'log';

export const IPC_CHANNELS = {
  listDevices: 'audio:listDevices',
  startAudio: 'audio:start',
  stopAudio: 'audio:stop',
  runProcessing: 'proc:run',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
