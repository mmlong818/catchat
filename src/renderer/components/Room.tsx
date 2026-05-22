import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { InviteLink, Peer } from '../../shared/types';
import { buildInviteLink } from '../lib/invite';
import { MeetingClient, type ChatMessage, type FileTransferUpdate } from '../lib/meeting';
import { AudioCapture } from '../lib/audio-capture';
import { TranscriptStore, type Paragraph } from '../lib/transcript';
import { type Avatar as AvatarT } from '../lib/avatars';
import { Avatar } from './Avatar';
import { ConfirmModal } from './Modal';
import { ScreenPicker } from './ScreenPicker';
import { captureScreen } from '../lib/screen-capture';
import { Icon } from './Icon';
import { ChatPanel } from './ChatPanel';
import { AudioLevels } from '../lib/audio-levels';
import { Menu } from './Menu';
import { setIceServers } from '../lib/peer';

interface Props {
  mode: 'host' | 'guest';
  invite: InviteLink;
  name: string;
  avatar: AvatarT;
  onLeave: () => void;
}

type Status = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
type ConfirmKind = 'leave' | 'end' | null;
type SideTab = 'chat' | 'transcript';

const SPEAKING_DECAY_MS = 3000;

function formatDuration(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  if (h > 0) return `${pad(h)}:${pad(m % 60)}:${pad(s % 60)}`;
  return `${pad(m)}:${pad(s % 60)}`;
}

export function Room({ mode, invite, name, avatar, onLeave }: Props) {
  const clientRef = useRef<MeetingClient | null>(null);
  const captureRef = useRef<AudioCapture | null>(null);
  const storeRef = useRef<TranscriptStore>(new TranscriptStore());
  const audioContainerRef = useRef<HTMLDivElement>(null);
  const screenVideoRef = useRef<HTMLVideoElement>(null);
  const blobUrlsRef = useRef<Map<string, { url: string; name: string; saved?: string }>>(new Map());
  const levelsRef = useRef<AudioLevels>(new AudioLevels());
  const [audioLevels, setAudioLevels] = useState<Map<string, number>>(new Map());

  const [peers, setPeers] = useState<Peer[]>([]);
  const [status, setStatus] = useState<Status>('connecting');
  const [muted, setMuted] = useState(true);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paragraphs, setParagraphs] = useState<Paragraph[]>([]);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const [asrOn, setAsrOn] = useState(false);
  const [asrUnavailable, setAsrUnavailable] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmKind>(null);
  const [endedBanner, setEndedBanner] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [fileTransfers, setFileTransfers] = useState<FileTransferUpdate[]>([]);
  const [sharing, setSharing] = useState(false);
  const [screenPickerOpen, setScreenPickerOpen] = useState(false);
  const [imageUrls, setImageUrls] = useState<Map<string, string>>(new Map());
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null);
  const [remoteScreens, setRemoteScreens] = useState<Map<string, MediaStream>>(new Map());
  const [activeScreenPeerId, setActiveScreenPeerId] = useState<string | null>(null);
  const [sideTab, setSideTab] = useState<SideTab>('chat');
  const [sideCollapsed, setSideCollapsed] = useState(false);
  const [speakingMap, setSpeakingMap] = useState<Map<string, number>>(new Map());
  const [snippingHint, setSnippingHint] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [savedToast, setSavedToast] = useState<{ name: string; path: string } | null>(null);
  const [meetingStart] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());

  // Meeting timer
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Audio levels polling
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const m = levelsRef.current.all();
      // Only update state if values change meaningfully
      setAudioLevels((prev) => {
        let diff = prev.size !== m.size;
        if (!diff) for (const [k, v] of m) if (Math.abs((prev.get(k) ?? 0) - v) > 0.02) { diff = true; break; }
        return diff ? m : prev;
      });
      raf = window.setTimeout(tick as any, 80);
    };
    tick();
    return () => clearTimeout(raf);
  }, []);

  // Speaking decay
  useEffect(() => {
    const id = setInterval(() => {
      const t = Date.now();
      setSpeakingMap((prev) => {
        const next = new Map(prev);
        let changed = false;
        for (const [k, v] of next) if (t - v > SPEAKING_DECAY_MS) { next.delete(k); changed = true; }
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);


  const peerById = useMemo(() => {
    const m: Record<string, Peer> = {};
    for (const p of peers) m[p.id] = p;
    return m;
  }, [peers]);

  const selfPeer = clientRef.current?.self;
  const isCurrentlyHost = selfPeer ? peerById[selfPeer.id]?.isHost ?? selfPeer.isHost : mode === 'host';
  const selfId = selfPeer?.id || '';

  useEffect(() => {
    let cancelled = false;
    let unsubStore: (() => void) | null = null;
    const store = storeRef.current;

    (async () => {
      const s = await window.voiceMeet.settings.get();
      if (cancelled) return;
      // Apply custom ICE servers from settings (if any)
      if (s.iceServersJson?.trim()) {
        try { setIceServers(JSON.parse(s.iceServersJson)); }
        catch (e) { console.error('[room] invalid iceServersJson', e); setIceServers(null); }
      } else {
        setIceServers(null);
      }
      const signalingUrl = invite.signal || s.signalingUrl;
      const client = new MeetingClient({ invite, name, isHost: mode === 'host', avatar, signalingUrl });
      clientRef.current = client;
      unsubStore = store.subscribe(setParagraphs);

      client.on('peersChanged', setPeers);
      client.on('status', setStatus);
      client.on('remoteStream', attachAudio);
      client.on('remoteStreamRemoved', detachAudio);
      client.on('chat', (m) => setChatMessages((prev) => [...prev, m]));
      client.on('fileTransfer', (update) => {
        setFileTransfers((prev) => {
          const idx = prev.findIndex((f) => f.id === update.id);
          if (idx >= 0) { const next = prev.slice(); next[idx] = update; return next; }
          return [...prev, update];
        });
        if (update.state === 'done' && update.blob && !blobUrlsRef.current.has(update.id)) {
          const url = URL.createObjectURL(update.blob);
          blobUrlsRef.current.set(update.id, { url, name: update.name });
          const isImg = update.blob.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(update.name);
          if (isImg) setImageUrls((prev) => new Map(prev).set(update.id, url));
          if (update.direction === 'in') {
            update.blob.arrayBuffer().then((buf) =>
              window.voiceMeet.file.saveToDesktop(update.name, buf).then((saved) => {
                const e = blobUrlsRef.current.get(update.id); if (e) e.saved = saved;
                setSavedToast({ name: update.name, path: saved });
                setTimeout(() => setSavedToast((cur) => (cur?.path === saved ? null : cur)), 4500);
              }),
            );
          }
        }
      });
      client.on('data', (peerId, payload) => {
        if (payload.kind === 'transcript') {
          store.ingest(payload.entry);
          setSpeakingMap((prev) => new Map(prev).set(peerId, Date.now()));
        } else if (payload.kind === 'transcript-history') {
          for (const e of payload.entries) store.ingest(e);
        }
      });
      client.on('peerReady', (peerId) => {
        if (!client.isHost || peerId === client.self.id) return;
        const snapshot = storeRef.current.snapshot();
        const entries = snapshot
          .filter((p) => p.text)
          .map((p) => ({
            id: p.id, speaker: p.speaker, speakerName: p.speakerName,
            text: p.text, ts: p.startTs, isFinal: true,
          }));
        if (entries.length > 0) client.sendTo(peerId, { kind: 'transcript-history', entries });
      });
      client.on('screenShareChanged', (sh) => {
        setSharing(sh);
        setLocalScreenStream(sh ? client.getScreenStream() : null);
      });
      client.on('remoteScreenTrack', (peerId, track, stream) => {
        console.log('[room] remoteScreenTrack from', peerId, 'streamId:', stream.id,
          'tracks:', stream.getTracks().map((t) => `${t.kind}(${t.readyState})`).join(','),
          'track muted:', track.muted, 'enabled:', track.enabled);
        setRemoteScreens((prev) => new Map(prev).set(peerId, stream));
        setActiveScreenPeerId(peerId);
      });
      client.on('remoteScreenEnded', (peerId) => {
        setRemoteScreens((prev) => { const n = new Map(prev); n.delete(peerId); return n; });
        setActiveScreenPeerId((cur) => (cur === peerId ? null : cur));
      });
      client.on('meetingEnded', (reason) => {
        setEndedBanner(reason || '会议已结束');
        stopAsr();
        // Auto-exit back to lobby for non-host peers (host already navigates away).
        if (!client.isHost) {
          setTimeout(() => { client.leave(); onLeave(); }, 2500);
        }
      });

      try {
        await client.start();
        const ls = client.getLocalStream();
        if (ls) levelsRef.current.attach(client.self.id, ls);
        startAsr(client);
      } catch (e: any) {
        setError(`无法访问麦克风：${e.message || e}`);
      }
    })();

    return () => {
      cancelled = true;
      unsubStore?.();
      stopAsr();
      clientRef.current?.leave();
      clientRef.current = null;
      audioContainerRef.current?.replaceChildren();
      levelsRef.current.close();
      for (const { url } of blobUrlsRef.current.values()) URL.revokeObjectURL(url);
      blobUrlsRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  useEffect(() => { transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [paragraphs]);

  useEffect(() => {
    const video = screenVideoRef.current;
    if (!video) return;
    let stream: MediaStream | null = null;
    if (activeScreenPeerId) stream = remoteScreens.get(activeScreenPeerId) ?? null;
    else if (localScreenStream) stream = localScreenStream;
    // Only re-assign if stream actually changed — re-setting srcObject triggers a
    // fresh load that interrupts the current play(), causing "interrupted by new load" errors.
    if (video.srcObject === stream) return;
    video.srcObject = stream;
    if (stream) {
      console.log('[room] attach video stream', stream.id, 'video tracks:', stream.getVideoTracks().length);
      // Explicit play() — autoPlay is policy-gated even with muted in some Electron configs
      video.play().then(() => console.log('[room] video playing')).catch((e) => console.error('[room] play failed', e));
    }
  }, [activeScreenPeerId, remoteScreens, localScreenStream]);

  const startAsr = async (client: MeetingClient) => {
    const localStream = client.getLocalStream();
    if (!localStream) return;
    const result = await window.voiceMeet.asr.start();
    if (!result.ok) {
      // Silent disable — show non-blocking hint, not red error
      setAsrOn(false);
      setAsrUnavailable(result.error || '未配置 API Key');
      return;
    }
    setAsrUnavailable(null);
    const unsub = window.voiceMeet.asr.onEvent((event) => {
      if (event.type === 'result') {
        if (!event.text) return;
        const entry = {
          id: event.sentenceId || `${client.self.id}-${Date.now()}`,
          speaker: client.self.id,
          speakerName: client.self.name,
          text: event.text,
          ts: Date.now(),
          isFinal: event.isFinal,
        };
        storeRef.current.ingest(entry);
        setSpeakingMap((prev) => new Map(prev).set(client.self.id, Date.now()));
        client.broadcast({ kind: 'transcript', entry });
      } else if (event.type === 'error') setError(`转写错误：${event.message}`);
      else if (event.type === 'started') setAsrOn(true);
      else if (event.type === 'closed') setAsrOn(false);
    });
    (startAsr as any)._unsub = unsub;
    const capture = new AudioCapture();
    captureRef.current = capture;
    await capture.start(localStream, (chunk) => window.voiceMeet.asr.sendAudio(chunk));
  };

  const stopAsr = async () => {
    (startAsr as any)._unsub?.();
    await captureRef.current?.stop();
    captureRef.current = null;
    try { await window.voiceMeet.asr.stop(); } catch {}
    setAsrOn(false);
  };

  const attachAudio = (peerId: string, stream: MediaStream) => {
    const container = audioContainerRef.current; if (!container) return;
    const key = `${peerId}:${stream.id}`;
    let el = container.querySelector<HTMLAudioElement>(`audio[data-key="${key}"]`);
    if (!el) {
      el = document.createElement('audio');
      el.dataset.key = key;
      el.dataset.peer = peerId;
      el.autoplay = true;
      container.appendChild(el);
    }
    el.srcObject = stream;
    // attach level only for primary (first) audio stream of a peer
    if (!levelsRef.current.ids().some((id) => id === peerId)) {
      levelsRef.current.attach(peerId, stream);
    }
  };
  const detachAudio = (peerId: string) => {
    const els = audioContainerRef.current?.querySelectorAll(`audio[data-peer="${peerId}"]`);
    els?.forEach((el) => el.remove());
    levelsRef.current.detach(peerId);
  };

  const copyInvite = async () => {
    await navigator.clipboard.writeText(buildInviteLink(invite));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const toggleMute = () => {
    const next = !muted;
    clientRef.current?.setMuted(next);
    setMuted(next);
  };

  const exportTranscript = () => {
    storeRef.current.flush();
    const md = storeRef.current.toMarkdown(`会议-${invite.roomId}`);
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `会议纪要-${invite.roomId}-${new Date().toISOString().slice(0, 10)}.md`;
    a.click(); URL.revokeObjectURL(url);
  };

  const handlePickScreen = async (sourceId: string, _name: string, withAudio: boolean) => {
    setScreenPickerOpen(false);
    try {
      const stream = await captureScreen(sourceId, withAudio);
      await clientRef.current?.startScreenShare(stream);
    } catch (e: any) { setError(`无法共享屏幕：${e.message || e}`); }
  };

  const handleScreenshot = async () => {
    setSnippingHint(true);
    try {
      const result = await window.voiceMeet.screen.nativeScreenshot();
      setSnippingHint(false);
      if (result.error) { setError(`截图失败：${result.error}`); return; }
      if (result.timeout || result.cancelled) return;
      if (result.png) {
        const file = new File([result.png], `screenshot-${Date.now()}.png`, { type: 'image/png' });
        setPendingFiles((prev) => [...prev, file]);
        setSideTab('chat');
      }
    } catch (e: any) { setSnippingHint(false); setError(`截图失败：${e.message || e}`); }
  };

  const handleLeave = async () => {
    if (isCurrentlyHost) {
      try {
        await clientRef.current?.transferHostAndLeave();
        await new Promise((r) => setTimeout(r, 500));
      } catch (e: any) {
        clientRef.current?.endMeeting('房主已离开（转移失败：' + (e?.message || '未知') + '）');
        await new Promise((r) => setTimeout(r, 300));
      }
    }
    clientRef.current?.leave();
    onLeave();
  };
  const handleEndMeeting = () => {
    clientRef.current?.endMeeting('房主结束了会议');
    setTimeout(handleLeave, 200);
  };

  const statusLabel = { connecting: '连接中', connected: '已连接', reconnecting: '重连中', disconnected: '已断开' }[status];
  const isSharing = !!(activeScreenPeerId || localScreenStream);
  const sharerName = activeScreenPeerId ? (peerById[activeScreenPeerId]?.name || '未知') : '你';
  const galleryCount = peers.length;
  const galleryCls = 'gallery ' + (galleryCount > 6 ? 'count-many' : `count-${galleryCount}`);

  // Sort peers so recent speakers come first (auto-reorder)
  const orderedPeers = useMemo(() => {
    return [...peers].sort((a, b) => {
      const at = speakingMap.get(a.id) || 0;
      const bt = speakingMap.get(b.id) || 0;
      if (at !== bt) return bt - at;
      return a.joinedAt - b.joinedAt;
    });
  }, [peers, speakingMap]);
  const roomCls = 'room' + (sideCollapsed ? ' side-collapsed' : '');

  return (
    <div className={roomCls}>
      <div className="stage">
        {/* Floating overlay: timer + tiny status dots */}
        <div className="stage-overlay">
          {endedBanner ? (
            <span style={{ color: 'var(--warn)' }}>{endedBanner}</span>
          ) : (
            <>
              <span>{formatDuration(now - meetingStart)}</span>
              {status !== 'connected' && (
                <span className="dot warn" title={statusLabel} />
              )}
              {!asrUnavailable && asrOn && <span className="dot ok" title="实时转写中" />}
              {asrUnavailable && <span className="dot muted" title={asrUnavailable} />}
            </>
          )}
        </div>

        {error && (
          <div style={{
            position: 'absolute', top: 60, left: '50%', transform: 'translateX(-50%)',
            background: 'var(--danger-soft)', color: 'var(--danger)',
            padding: '8px 16px', borderRadius: 'var(--r-full)', fontSize: 13, zIndex: 10,
          }}>{error}</div>
        )}
        <div className={'stage-inner' + (isSharing ? ' sharing' : '')}>
          {peers.length <= 1 && !isSharing && (
            <button
              className="dock-btn"
              onClick={copyInvite}
              style={{
                position: 'absolute',
                top: 60,
                left: '50%',
                transform: 'translateX(-50%)',
                width: 'auto', height: 36,
                padding: '0 18px',
                borderRadius: 'var(--r-full)',
                background: 'var(--bg-elev-solid)',
                fontSize: 13, fontWeight: 500,
                gap: 8,
                boxShadow: 'var(--sh-1)',
                zIndex: 5,
              }}
            >
              <Icon name="link" size={14} />
              {copied ? '✓ 已复制邀请链接' : '复制邀请链接 · 让朋友加入'}
            </button>
          )}
          {isSharing ? (
            <>
              <div className="share-area">
                <video ref={screenVideoRef} autoPlay playsInline muted />
                <div className="label">
                  <Icon name="screen-share" size={14} />
                  {sharerName} 正在共享
                </div>
                {remoteScreens.size > 1 && (
                  <div className="switcher">
                    {[...remoteScreens.keys()].map((pid) => (
                      <button key={pid} className={pid === activeScreenPeerId ? 'primary' : ''}
                        onClick={() => setActiveScreenPeerId(pid)}
                        style={{ fontSize: 11, padding: '4px 10px', height: 'auto' }}>
                        {peerById[pid]?.name || pid.slice(0, 4)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="mini-strip">
                {orderedPeers.map((p) => (
                  <PeerTile key={p.id} peer={p} self={p.id === selfId} level={audioLevels.get(p.id) || 0} mini />
                ))}
              </div>
            </>
          ) : (
            <div className={galleryCls}>
              {peers.map((p) => (
                <PeerTile key={p.id} peer={p} self={p.id === selfId} level={audioLevels.get(p.id) || 0} />
              ))}
            </div>
          )}
        </div>
        <div ref={audioContainerRef} style={{ display: 'none' }} />
      </div>

      <button
        className="side-handle"
        onClick={() => setSideCollapsed((v) => !v)}
        title={sideCollapsed ? '展开侧栏' : '收起侧栏'}
      >
        <Icon name={sideCollapsed ? 'chevron-left' : 'chevron-right'} size={16} />
      </button>

      <aside className="side-panel">
          <div className="side-tabs">
            <button
              className={'side-tab' + (sideTab === 'chat' ? ' active' : '')}
              onClick={() => setSideTab('chat')}
            >聊天</button>
            <button
              className={'side-tab' + (sideTab === 'transcript' ? ' active' : '')}
              onClick={() => setSideTab('transcript')}
            >转写</button>
            <button
              className="side-more"
              onClick={exportTranscript}
              title="导出会议纪要"
            >
              <Icon name="download" size={16} />
            </button>
          </div>
          <div className="tab-content">
            {sideTab === 'chat' ? (
              <ChatPanel
                selfId={selfId}
                messages={chatMessages}
                files={fileTransfers}
                imageUrls={imageUrls}
                pendingFiles={pendingFiles}
                setPendingFiles={setPendingFiles}
                onSend={(t) => clientRef.current?.sendChat(t)}
                onSendFile={(f) => clientRef.current?.sendFile(f).catch(console.error)}
                onScreenshot={handleScreenshot}
                onDownload={(id) => {
                  const e = blobUrlsRef.current.get(id); if (!e) return;
                  if (e.saved) window.voiceMeet.file.reveal(e.saved);
                  else { const a = document.createElement('a'); a.href = e.url; a.download = e.name; a.click(); }
                }}
                onPreviewImage={(url) => setPreviewImage(url)}
              />
            ) : (
              <div className="transcript">
                {asrUnavailable ? (
                  <div style={{ color: 'var(--t-3)', textAlign: 'center', marginTop: 40, fontSize: 12, padding: 16 }}>
                    转写功能未配置 API Key<br />
                    <span style={{ fontSize: 11 }}>在大厅设置中填入阿里云百炼 Key 即可启用</span>
                  </div>
                ) : paragraphs.length === 0 ? (
                  <div style={{ color: 'var(--t-3)', textAlign: 'center', marginTop: 40, fontSize: 12 }}>
                    等待发言…
                  </div>
                ) : paragraphs.map((p) => {
                  const speaker = peerById[p.speaker];
                  const showPartial = !!p.partial && !p.text;
                  return (
                    <div key={p.id} className={'transcript-entry' + (showPartial ? ' partial' : '')}>
                      <Avatar avatar={(speaker?.avatar as AvatarT) || undefined} name={p.speakerName} size="sm" />
                      <div className="body">
                        <div className="meta">
                          <span className="speaker">{p.speakerName}</span>
                          <span className="ts">{new Date(p.startTs).toLocaleTimeString('zh-CN', { hour12: false })}</span>
                        </div>
                        <div className="text">
                          {p.text}{p.partial && <span style={{ color: 'var(--t-3)' }}>{p.text ? ' ' : ''}{p.partial}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={transcriptEndRef} />
              </div>
            )}
          </div>
        </aside>

      <div className="dock">
        <div className="dock-tray">
          <button
            className={'dock-btn' + (muted ? ' state-off' : '')}
            onClick={toggleMute}
            data-label={muted ? '取消静音' : '静音'}
          >
            <Icon name={muted ? 'mic-off' : 'mic'} size={20} />
          </button>
          {sharing ? (
            <button
              className="dock-btn state-off"
              onClick={() => clientRef.current?.stopScreenShare()}
              data-label="停止共享"
            >
              <Icon name="screen-stop" size={20} />
            </button>
          ) : (
            <button
              className="dock-btn"
              onClick={() => setScreenPickerOpen(true)}
              data-label="共享屏幕"
            >
              <Icon name="screen-share" size={20} />
            </button>
          )}

          <button
            className="dock-btn"
            onClick={copyInvite}
            data-label={copied ? '已复制邀请链接' : '复制邀请链接'}
          >
            <Icon name="link" size={20} />
          </button>

          <span className="dock-sep" />

          {isCurrentlyHost ? (
            <Menu
              position="top"
              items={[
                { label: '我先离开（会议继续）', icon: <Icon name="leave" size={16} />, onClick: handleLeave },
                { label: '结束所有人会议', icon: <Icon name="close" size={16} />, onClick: handleEndMeeting, danger: true },
              ]}
              trigger={(open) => (
                <button className="dock-btn leave" onClick={open} data-label="离开/结束">
                  <Icon name="phone-off" size={18} />
                </button>
              )}
            />
          ) : (
            <button
              className="dock-btn leave"
              onClick={() => setConfirm('leave')}
              data-label="离开会议"
            >
              <Icon name="phone-off" size={18} />
            </button>
          )}
        </div>
      </div>

      {screenPickerOpen && (
        <ScreenPicker
          onPick={(id, name, withAudio) => handlePickScreen(id, name, withAudio)}
          onCancel={() => setScreenPickerOpen(false)}
        />
      )}

      {savedToast && (
        <div style={{
          position: 'fixed', bottom: 80, right: 24, zIndex: 150,
          background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(16px)',
          padding: '12px 16px', borderRadius: 'var(--r-2)',
          boxShadow: 'var(--sh-3)', border: '1px solid var(--b-1)',
          display: 'flex', alignItems: 'center', gap: 12, maxWidth: 320,
          animation: 'fadeUp var(--d-slow) var(--ease-out)',
        }}>
          <Icon name="download" size={18} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: 'var(--t-3)', marginBottom: 2 }}>已保存到桌面</div>
            <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {savedToast.name}
            </div>
          </div>
          <button
            className="ghost icon-btn"
            onClick={() => window.voiceMeet.file.reveal(savedToast.path)}
            title="打开位置"
            style={{ flexShrink: 0 }}
          >
            <Icon name="link" size={14} />
          </button>
        </div>
      )}

      {snippingHint && (
        <div style={{
          position: 'fixed', bottom: 90, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.85)', color: '#fff',
          padding: '10px 18px', borderRadius: 8, fontSize: 13,
          boxShadow: '0 4px 16px rgba(0,0,0,0.2)', zIndex: 200,
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span>系统截图工具已打开，请框选区域。完成后会显示在输入框预览。</span>
          <button onClick={() => { window.voiceMeet.screen.cancelScreenshot(); setSnippingHint(false); }}
            style={{ background: 'rgba(255,255,255,0.2)', color: '#fff', border: 'none', padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>
            取消
          </button>
        </div>
      )}

      {previewImage && createPortal(
        <div className="modal-backdrop" onClick={() => setPreviewImage(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative' }}>
            <button onClick={() => setPreviewImage(null)} title="关闭"
              style={{
                position: 'absolute', top: -12, right: -12, width: 32, height: 32, borderRadius: '50%',
                background: '#fff', border: '1px solid var(--b-1)', cursor: 'pointer', padding: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'var(--sh-2)',
              }}>
              <Icon name="close" size={18} />
            </button>
            <img src={previewImage} alt="预览" style={{ maxWidth: '90vw', maxHeight: '90vh', borderRadius: 6, display: 'block' }} />
          </div>
        </div>,
        document.body,
      )}

      {confirm === 'leave' && (
        <ConfirmModal
          title={isCurrentlyHost ? '离开但保留会议？' : '确认离开会议？'}
          body={isCurrentlyHost ? '会议将继续，房主权限将按加入顺序转移给下一位参会者。' : '你将退出当前会议。'}
          confirmText="离开" danger
          onConfirm={handleLeave} onCancel={() => setConfirm(null)}
        />
      )}
      {confirm === 'end' && (
        <ConfirmModal
          title="结束会议？"
          body="将通知所有参会者会议已结束。此操作不可撤销。"
          confirmText="结束所有人会议" danger
          onConfirm={handleEndMeeting} onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

function PeerTile({ peer, self, level, mini }: { peer: Peer; self: boolean; level: number; mini?: boolean }) {
  const av = peer.avatar as AvatarT | undefined;
  const bg = av?.kind === 'image' ? '#222' : (av?.bg || 'linear-gradient(135deg,#6366f1,#8b5cf6)');
  // Audio level — only show ring if not muted (level > 0.05 threshold filters out noise)
  const active = !peer.micMuted && level > 0.05;
  const ringSize = active ? Math.min(28, 6 + level * 24) : 0;
  const ringOpacity = active ? Math.min(1, 0.3 + level * 0.7) : 0;
  return (
    <div
      className={'tile' + (active ? ' speaking' : '') + (mini ? ' mini' : '')}
      data-mic={peer.micMuted ? 'off' : 'on'}
    >
      <div
        className="tile-avatar"
        style={{
          background: bg,
          boxShadow: active
            ? `0 0 0 ${ringSize * 0.4}px rgba(22, 163, 74, ${ringOpacity * 0.5}), 0 0 0 ${ringSize}px rgba(22, 163, 74, ${ringOpacity * 0.2})`
            : '0 8px 24px rgba(0,0,0,0.08)',
          transition: 'box-shadow 100ms ease-out',
        }}
      >
        {av?.kind === 'image' ? <img src={av.value} alt={peer.name} />
          : av?.kind === 'preset' ? <span>{av.value}</span>
          : <span>{initialFor(peer.name)}</span>}
      </div>
      {peer.isHost && (
        <div className="crown-badge">
          <Icon name="crown" size={12} />
          房主
        </div>
      )}
      <div className="tile-footer">
        <span className={'mic-icon ' + (peer.micMuted === false ? 'on' : '')}>
          <Icon name={peer.micMuted === false ? 'mic' : 'mic-off'} size={14} />
        </span>
        <span className="name">{peer.name}</span>
        {self && <span className="self-tag">(我)</span>}
      </div>
    </div>
  );
}

function initialFor(name: string) {
  const t = (name || '?').trim();
  if (!t) return '?';
  const ch = t[0];
  return /[a-zA-Z]/.test(ch) ? ch.toUpperCase() : ch;
}
