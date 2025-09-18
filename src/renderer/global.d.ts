export {};

declare global {
  interface Window {
    api: {
      listDevices: () => Promise<{
        id: number;
        name: string;
        hostAPIName?: string;
        maxOutputChannels: number;
      }[]>;
      startAudio: (deviceId: number | null | undefined, outPath: string) => Promise<{ success?: boolean; path?: string }>;
      stopAudio: () => Promise<{ success?: boolean; path?: string }>;
      runProcess: (wavPath: string, options?: Record<string, unknown>) => Promise<{ success?: boolean; code?: number | null }>;
      onLog: (callback: (message: string) => void) => () => void;
    };
  }
}
