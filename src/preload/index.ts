import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('voiceMeet', {
  onDeepLink: (cb: (url: string) => void) => {
    ipcRenderer.on('deep-link', (_e, url) => cb(url));
  },
  file: {
    saveToDesktop: (name: string, data: ArrayBuffer) => ipcRenderer.invoke('file:saveToDesktop', name, data),
    reveal: (p: string) => ipcRenderer.invoke('file:reveal', p),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (s: unknown) => ipcRenderer.invoke('settings:set', s),
    openDataDir: () => ipcRenderer.invoke('settings:openDataDir'),
    getDataDir: () => ipcRenderer.invoke('settings:getDataDir'),
  },
  screen: {
    getSources: () => ipcRenderer.invoke('screen:getSources'),
    nativeScreenshot: () => ipcRenderer.invoke('screenshot:native'),
    cancelScreenshot: () => ipcRenderer.invoke('screenshot:cancel'),
  },
  asr: {
    start: () => ipcRenderer.invoke('asr:start'),
    sendAudio: (buf: ArrayBuffer) => ipcRenderer.send('asr:audio', buf),
    stop: () => ipcRenderer.invoke('asr:stop'),
    onEvent: (cb: (event: any) => void) => {
      const handler = (_e: unknown, event: any) => cb(event);
      ipcRenderer.on('asr:event', handler);
      return () => ipcRenderer.off('asr:event', handler);
    },
  },
});

declare global {
  interface Window {
    voiceMeet: {
      startSignaling: (port: number, roomId: string, token: string) => Promise<{ port: number; ip: string }>;
      stopSignaling: () => Promise<void>;
      onDeepLink: (cb: (url: string) => void) => void;
    };
  }
}
