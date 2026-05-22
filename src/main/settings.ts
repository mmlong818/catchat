import { app, safeStorage, shell } from 'electron';
import fs from 'fs';
import path from 'path';

export interface AppSettings {
  asrMode: 'aliyun-funasr';
  apiKey: string;          // 明文返回给渲染层；磁盘上加密
  asrModel: string;
  asrEndpoint: string;
  polishModel: string;
  signalingUrl: string;    // 公共信令服务 URL（wss://...）
  iceServersJson: string;  // RTCIceServer[] JSON; '' = use defaults
}

const DEFAULTS: AppSettings = {
  asrMode: 'aliyun-funasr',
  apiKey: '',
  asrModel: 'fun-asr-realtime',
  asrEndpoint: 'wss://dashscope.aliyuncs.com/api-ws/v1/inference',
  polishModel: 'qwen-plus',
  signalingUrl: 'wss://catchat-signal.onrender.com',
  iceServersJson: '',
};

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

interface StoredSettings extends Omit<AppSettings, 'apiKey' | 'signalingUrl' | 'iceServersJson'> {
  apiKeyEnc: string | null;
  signalingUrl?: string;
  iceServersJson?: string;
}

export function loadSettings(): AppSettings {
  const p = settingsPath();
  if (!fs.existsSync(p)) return { ...DEFAULTS };
  try {
    const raw: StoredSettings = JSON.parse(fs.readFileSync(p, 'utf-8'));
    let apiKey = '';
    if (raw.apiKeyEnc) {
      if (safeStorage.isEncryptionAvailable()) {
        try {
          apiKey = safeStorage.decryptString(Buffer.from(raw.apiKeyEnc, 'base64'));
        } catch (e) {
          console.error('[settings] decrypt failed', e);
        }
      } else {
        // fallback: stored as plain base64
        apiKey = Buffer.from(raw.apiKeyEnc, 'base64').toString('utf-8');
      }
    }
    return {
      asrMode: raw.asrMode || DEFAULTS.asrMode,
      apiKey,
      asrModel: raw.asrModel || DEFAULTS.asrModel,
      asrEndpoint: raw.asrEndpoint || DEFAULTS.asrEndpoint,
      polishModel: raw.polishModel || DEFAULTS.polishModel,
      signalingUrl: (raw as any).signalingUrl || DEFAULTS.signalingUrl,
      iceServersJson: (raw as any).iceServersJson ?? DEFAULTS.iceServersJson,
    };
  } catch (e) {
    console.error('[settings] load failed', e);
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: AppSettings) {
  const p = settingsPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  let apiKeyEnc: string | null = null;
  if (s.apiKey) {
    if (safeStorage.isEncryptionAvailable()) {
      apiKeyEnc = safeStorage.encryptString(s.apiKey).toString('base64');
    } else {
      apiKeyEnc = Buffer.from(s.apiKey, 'utf-8').toString('base64');
    }
  }
  const stored: StoredSettings = {
    asrMode: s.asrMode,
    apiKeyEnc,
    asrModel: s.asrModel,
    asrEndpoint: s.asrEndpoint,
    polishModel: s.polishModel,
    signalingUrl: s.signalingUrl,
    iceServersJson: s.iceServersJson,
  };
  fs.writeFileSync(p, JSON.stringify(stored, null, 2), 'utf-8');
}

export function getDataDir() {
  return app.getPath('userData');
}

export function openDataDir() {
  return shell.openPath(getDataDir());
}
