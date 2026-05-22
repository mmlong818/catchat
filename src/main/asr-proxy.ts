import WebSocket from 'ws';
import { randomUUID } from 'crypto';
import type { WebContents } from 'electron';
import type { AppSettings } from './settings';

interface AsrSession {
  ws: WebSocket;
  taskId: string;
  started: boolean;
  stopping: boolean;
  pendingAudio: Buffer[];
  webContents: WebContents;
}

const sessions = new Map<number, AsrSession>();

export function startAsrSession(webContents: WebContents, settings: AppSettings): { ok: true } | { ok: false; error: string } {
  const apiKey = settings.apiKey;
  if (!apiKey) return { ok: false, error: '阿里云 API Key 未配置，请前往设置填入' };
  const wcId = webContents.id;
  stopAsrSession(wcId);

  const endpoint = settings.asrEndpoint;
  const model = settings.asrModel;
  const taskId = randomUUID().replace(/-/g, '');
  console.log('[asr] connecting to', endpoint, 'model:', model, 'task:', taskId);
  const ws = new WebSocket(endpoint, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'X-DashScope-DataInspection': 'enable',
      'user-agent': 'voice-meet/0.1',
    },
    handshakeTimeout: 60000, // 60s, default is shorter
  });

  // Manual connect timeout — fires only if no open/error event in 30s
  const connectTimer = setTimeout(() => {
    if (ws.readyState === WebSocket.CONNECTING) {
      console.error('[asr] connect timeout 30s — likely firewall/proxy blocking wss');
      try { ws.terminate(); } catch {}
      if (!session.stopping) {
        webContents.send('asr:event', {
          type: 'error',
          message: '连接 DashScope 超时（30 秒）。检查：1) 网络可访问 dashscope.aliyuncs.com 2) Windows 防火墙未拦截 3) 是否需要 HTTP 代理',
        });
      }
    }
  }, 30000);
  ws.once('open', () => clearTimeout(connectTimer));
  ws.once('error', () => clearTimeout(connectTimer));
  ws.once('close', () => clearTimeout(connectTimer));

  const session: AsrSession = { ws, taskId, started: false, stopping: false, pendingAudio: [], webContents };
  sessions.set(wcId, session);

  ws.on('unexpected-response', (_req, res) => {
    let body = '';
    res.on('data', (c) => { body += c.toString(); });
    res.on('end', () => {
      console.error('[asr] handshake rejected', res.statusCode, body);
      if (!session.stopping) {
        webContents.send('asr:event', {
          type: 'error',
          message: `握手失败 HTTP ${res.statusCode}: ${body.slice(0, 200)}`,
        });
      }
    });
  });

  ws.on('open', () => {
    ws.send(JSON.stringify({
      header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
      payload: {
        task_group: 'audio',
        task: 'asr',
        function: 'recognition',
        model,
        input: {},
        parameters: {
          format: 'pcm',
          sample_rate: 16000,
          disfluency_removal_enabled: false,
        },
      },
    }));
  });

  ws.on('message', (raw, isBinary) => {
    if (isBinary) return;
    let msg: any;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    const event = msg.header?.event;
    if (event === 'task-started') {
      session.started = true;
      for (const buf of session.pendingAudio) ws.send(buf);
      session.pendingAudio = [];
      webContents.send('asr:event', { type: 'started' });
    } else if (event === 'result-generated') {
      const sentence = msg.payload?.output?.sentence;
      if (sentence) {
        webContents.send('asr:event', {
          type: 'result',
          text: sentence.text,
          sentenceId: sentence.sentence_id,
          isFinal: sentence.sentence_end === true || msg.payload?.output?.sentence_end === true,
          beginTime: sentence.begin_time,
          endTime: sentence.end_time,
        });
      }
    } else if (event === 'task-finished') {
      webContents.send('asr:event', { type: 'finished' });
      ws.close();
    } else if (event === 'task-failed') {
      webContents.send('asr:event', {
        type: 'error',
        message: msg.header?.error_message || 'task failed',
        code: msg.header?.error_code,
      });
      ws.close();
    }
  });

  ws.on('close', () => {
    if (sessions.get(wcId) === session) sessions.delete(wcId);
    if (!session.stopping) webContents.send('asr:event', { type: 'closed' });
  });

  ws.on('error', (err) => {
    if (session.stopping) return;
    console.error('[asr] ws error:', err);
    webContents.send('asr:event', { type: 'error', message: err.message });
  });

  return { ok: true };
}

export function sendAsrAudio(wcId: number, audio: Buffer) {
  const s = sessions.get(wcId);
  if (!s) return;
  if (!s.started) {
    s.pendingAudio.push(audio);
    return;
  }
  if (s.ws.readyState === WebSocket.OPEN) s.ws.send(audio);
}

export function stopAsrSession(wcId: number) {
  const s = sessions.get(wcId);
  if (!s) return;
  s.stopping = true;
  if (s.ws.readyState === WebSocket.OPEN) {
    try {
      s.ws.send(JSON.stringify({
        header: { action: 'finish-task', task_id: s.taskId, streaming: 'duplex' },
        payload: { input: {} },
      }));
    } catch {}
    setTimeout(() => { try { s.ws.close(); } catch {} }, 500);
  } else {
    try { s.ws.close(); } catch {}
  }
  sessions.delete(wcId);
}
