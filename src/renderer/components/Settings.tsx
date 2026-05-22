import { useEffect, useState } from 'react';
import type { AppSettings } from '../global';

interface Props {
  onClose: () => void;
  initialFocus?: 'apiKey';
}

export function Settings({ onClose }: Props) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [dataDir, setDataDir] = useState('');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [status, setStatus] = useState<string>('');

  useEffect(() => {
    Promise.all([window.voiceMeet.settings.get(), window.voiceMeet.settings.getDataDir()])
      .then(([s, dir]) => {
        setSettings(s);
        setDataDir(dir);
        setStatus(s.apiKey ? '状态正常：当前语音模式可用。' : '尚未配置 API Key — 语音转写无法启用。');
      });
  }, []);

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    if (!settings) return;
    setSettings({ ...settings, [key]: value });
  };

  const save = async () => {
    if (!settings) return;
    await window.voiceMeet.settings.set(settings);
    setSavedAt(Date.now());
    setStatus(settings.apiKey ? '状态正常：当前语音模式可用。' : '尚未配置 API Key — 语音转写无法启用。');
    setTimeout(() => setSavedAt(null), 2000);
  };

  const check = async () => {
    if (!settings) return;
    if (!settings.apiKey) {
      setStatus('❌ 未配置 API Key');
      return;
    }
    setStatus('检查中…');
    try {
      const url = new URL(settings.asrEndpoint.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:'));
      await fetch(url.origin, { method: 'HEAD', mode: 'no-cors' });
      setStatus('✅ 端点可达，API Key 已保存（实际能否使用以发起会议时为准）');
    } catch (e: any) {
      setStatus(`⚠️ 端点不可达：${e.message || e}`);
    }
  };

  if (!settings) {
    return (
      <div className="modal-backdrop"><div className="modal">加载中…</div></div>
    );
  }

  const saved = savedAt !== null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal settings" onClick={(e) => e.stopPropagation()} style={{ width: 460, maxWidth: '92vw' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, flex: 1 }}>设置 {saved && <span style={{ fontSize: 12, color: 'var(--success)', fontWeight: 400 }}>· 已保存</span>}</h3>
          <button className="ghost" onClick={onClose}>✕</button>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button className="primary" onClick={save}>保存设置</button>
          <button onClick={check}>检查状态</button>
        </div>

        <Field label="语音识别模式">
          <select
            value={settings.asrMode}
            onChange={(e) => update('asrMode', e.target.value as AppSettings['asrMode'])}
            style={selectStyle}
          >
            <option value="aliyun-funasr">阿里云 FunASR</option>
          </select>
        </Field>

        <Field label="阿里云百炼 API Key">
          <input
            type="password"
            placeholder="填入后保存，会加密保存到本地"
            value={settings.apiKey}
            onChange={(e) => update('apiKey', e.target.value)}
          />
        </Field>

        <Field label="阿里云 FunASR 模型">
          <input value={settings.asrModel} onChange={(e) => update('asrModel', e.target.value)} />
        </Field>

        <Field label="阿里云 FunASR WebSocket">
          <input value={settings.asrEndpoint} onChange={(e) => update('asrEndpoint', e.target.value)} />
        </Field>

        <Field label="信令服务地址">
          <input
            value={settings.signalingUrl}
            onChange={(e) => update('signalingUrl', e.target.value)}
            placeholder="wss://your-signal-server.com"
          />
          <div style={{ fontSize: 11, color: 'var(--t-3)', marginTop: 4 }}>
            房主与所有客人都通过此地址中转信令；媒体（音频/屏幕）仍走 P2P
          </div>
        </Field>

        <Field label="润色模型">
          <input value={settings.polishModel} onChange={(e) => update('polishModel', e.target.value)} />
        </Field>

        <div style={{
          background: '#f0e7ff', borderRadius: 8, padding: 12, marginBottom: 12,
          fontSize: 12,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>本地数据目录</div>
          <div style={{ color: 'var(--t-2)', wordBreak: 'break-all' }}>{dataDir}</div>
        </div>

        <button
          onClick={() => window.voiceMeet.settings.openDataDir()}
          style={{ width: '100%', justifyContent: 'center', marginBottom: 8 }}
        >
          打开数据目录
        </button>

        <div style={{
          padding: '8px 12px',
          background: '#f6f8fa',
          borderRadius: 6,
          color: status.startsWith('✅') ? 'var(--success)' :
                 status.startsWith('❌') || status.startsWith('⚠️') ? 'var(--danger)' : 'var(--t-2)',
          fontSize: 13,
        }}>
          {status || ' '}
        </div>
      </div>
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  border: '1px solid var(--b-1)',
  borderRadius: 6,
  fontSize: 14,
  fontFamily: 'inherit',
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontWeight: 600, marginBottom: 4, fontSize: 13 }}>{label}</label>
      {children}
    </div>
  );
}
