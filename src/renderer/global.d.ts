export {};

export interface AsrEvent {
  type: 'started' | 'closed' | 'finished';
}
export interface AsrResultEvent {
  type: 'result';
  text: string;
  sentenceId: string;
  isFinal: boolean;
  beginTime: number;
  endTime: number;
}
export interface AsrErrorEvent {
  type: 'error';
  message: string;
  code?: string;
}
export type AsrAnyEvent = AsrEvent | AsrResultEvent | AsrErrorEvent;

export interface AppSettings {
  asrMode: 'aliyun-funasr';
  apiKey: string;
  asrModel: string;
  asrEndpoint: string;
  polishModel: string;
  signalingUrl: string;
}

declare global {
  const __APP_VERSION__: string;
  interface Window {
    voiceMeet: {
      onDeepLink: (cb: (url: string) => void) => void;
      file: {
        saveToDesktop: (name: string, data: ArrayBuffer) => Promise<string>;
        reveal: (path: string) => Promise<void>;
      };
      settings: {
        get: () => Promise<AppSettings>;
        set: (s: AppSettings) => Promise<boolean>;
        openDataDir: () => Promise<string>;
        getDataDir: () => Promise<string>;
      };
      screen: {
        getSources: () => Promise<Array<{ id: string; name: string; thumbnail: string; isScreen: boolean }>>;
        setActiveSource: (sourceId: string, withAudio: boolean) => Promise<void>;
        nativeScreenshot: () => Promise<{ png?: ArrayBuffer; error?: string; timeout?: boolean; cancelled?: boolean }>;
        cancelScreenshot: () => Promise<void>;
      };
      asr: {
        start: () => Promise<{ ok: boolean; error?: string }>;
        sendAudio: (buf: ArrayBuffer) => void;
        stop: () => Promise<void>;
        onEvent: (cb: (event: AsrAnyEvent) => void) => () => void;
      };
    };
  }
}
