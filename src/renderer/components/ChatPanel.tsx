import { useEffect, useRef, useState } from 'react';
import type { ChatMessage, FileTransferUpdate } from '../lib/meeting';
import { EmojiPicker } from './EmojiPicker';
import { Icon } from './Icon';

interface Props {
  selfId: string;
  messages: ChatMessage[];
  files: FileTransferUpdate[];
  imageUrls: Map<string, string>;
  pendingFiles: File[];
  setPendingFiles: (updater: (prev: File[]) => File[]) => void;
  onSend: (text: string) => void;
  onSendFile: (file: File) => void;
  onScreenshot: () => void;
  onDownload: (id: string) => void;
  onPreviewImage: (url: string) => void;
}

export function ChatPanel({
  selfId, messages, files, imageUrls,
  pendingFiles, setPendingFiles,
  onSend, onSendFile, onScreenshot, onDownload, onPreviewImage,
}: Props) {
  const [draft, setDraft] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [pendingPreviews, setPendingPreviews] = useState<string[]>([]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, files]);

  // Generate object URLs for pending image previews
  useEffect(() => {
    const urls = pendingFiles.map((f) =>
      f.type.startsWith('image/') ? URL.createObjectURL(f) : '',
    );
    setPendingPreviews(urls);
    return () => urls.forEach((u) => u && URL.revokeObjectURL(u));
  }, [pendingFiles]);

  const send = () => {
    const text = draft.trim();
    const hasFiles = pendingFiles.length > 0;
    if (!text && !hasFiles) return;
    for (const f of pendingFiles) onSendFile(f);
    if (text) onSend(text);
    setDraft('');
    setPendingFiles(() => []);
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    for (const item of Array.from(e.clipboardData.items)) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          const ext = file.type.split('/')[1] || 'png';
          const renamed = new File([file], `pasted-${Date.now()}.${ext}`, { type: file.type });
          setPendingFiles((prev) => [...prev, renamed]);
          return;
        }
      }
    }
  };

  // Merge messages and file events in time order
  const items: Array<
    | { ts: number; kind: 'msg'; msg: ChatMessage }
    | { ts: number; kind: 'file'; file: FileTransferUpdate }
  > = [
    ...messages.map((m) => ({ ts: m.ts, kind: 'msg' as const, msg: m })),
    ...files.map((f) => ({ ts: Date.now() - (1 - f.progress) * 1000, kind: 'file' as const, file: f })),
  ].sort((a, b) => a.ts - b.ts);

  return (
    <>
      <div className="chat-messages">
        {items.length === 0 && (
          <div style={{ color: 'var(--t-3)', textAlign: 'center', marginTop: 20, fontSize: 12 }}>
            还没有消息，发条招呼吧 👋
          </div>
        )}
        {items.map((it, i) => it.kind === 'msg' ? (
          <div key={`m${i}`} className="chat-msg">
            <span className="from">{it.msg.from === selfId ? '我' : it.msg.fromName}</span>
            <span className="ts">{new Date(it.msg.ts).toLocaleTimeString('zh-CN', { hour12: false })}</span>
            <div className="text">{it.msg.text}</div>
          </div>
        ) : (
          <FileMsg
            key={`f${i}`}
            file={it.file}
            self={it.file.from === selfId}
            imageUrl={imageUrls.get(it.file.id)}
            onDownload={onDownload}
            onPreview={onPreviewImage}
          />
        ))}
        <div ref={endRef} />
      </div>

      <div className="chat-composer">
        {pendingFiles.length > 0 && (
          <div className="chat-attachments">
            {pendingFiles.map((f, i) => (
              <div key={i} style={{
                position: 'relative',
                background: '#fff', border: '1px solid var(--b-1)',
                borderRadius: 6, padding: 4,
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 12, maxWidth: 200,
              }}>
                {pendingPreviews[i] ? (
                  <img src={pendingPreviews[i]} alt={f.name} style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 4 }} />
                ) : (
                  <span style={{ padding: '0 4px' }}><Icon name="folder" /></span>
                )}
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                <button
                  className="ghost icon-btn"
                  onClick={() => setPendingFiles((prev) => prev.filter((_, j) => j !== i))}
                  style={{ padding: 2 }}
                  title="移除"
                >
                  <Icon name="close" size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKey}
          onPaste={handlePaste}
          placeholder="输入消息（Enter 发送，Shift+Enter 换行），或粘贴图片…"
          rows={3}
        />

        <div className="chat-toolbar">
          {showEmoji && (
            <EmojiPicker
              onPick={(e) => setDraft((d) => d + e)}
              onClose={() => setShowEmoji(false)}
            />
          )}
          <button className="ghost icon-btn" onClick={() => setShowEmoji((v) => !v)} title="表情"><Icon name="smile" size={20} /></button>
          <button className="ghost icon-btn" onClick={() => fileRef.current?.click()} title="附加文件"><Icon name="folder" size={20} /></button>
          <button className="ghost icon-btn" onClick={onScreenshot} title="截图"><Icon name="scissors" size={20} /></button>

          <span style={{ flex: 1 }} />

          <span className="send-divider" />
          <button
            className="primary"
            onClick={send}
            disabled={!draft.trim() && pendingFiles.length === 0}
          >
            发送
          </button>
        </div>

        <input
          ref={fileRef}
          type="file"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) setPendingFiles((prev) => [...prev, f]);
            e.target.value = '';
          }}
        />
      </div>
    </>
  );
}

function FileMsg({
  file, self, imageUrl, onDownload, onPreview,
}: {
  file: FileTransferUpdate;
  self: boolean;
  imageUrl?: string;
  onDownload: (id: string) => void;
  onPreview: (url: string) => void;
}) {
  const isImage = file.name.match(/\.(png|jpe?g|gif|webp|bmp|svg)$/i);
  const showImage = isImage && file.state === 'done' && imageUrl;

  return (
    <div className="chat-msg">
      <span className="from">{self ? '我' : file.fromName}</span>
      <span className="ts">{isImage ? '📷' : '📎'} {file.direction === 'in' ? '发来' : '发送'}{isImage ? '图片' : '文件'}</span>

      {showImage ? (
        <img
          src={imageUrl}
          alt={file.name}
          onClick={() => onPreview(imageUrl)}
          style={{
            marginTop: 4, maxWidth: '100%', maxHeight: 200,
            borderRadius: 6, cursor: 'pointer', display: 'block',
            border: '1px solid var(--b-1)',
          }}
        />
      ) : (
        <div style={{
          marginTop: 4, padding: 8, background: '#f6f8fa',
          borderRadius: 6, fontSize: 13,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ flex: 1, wordBreak: 'break-all' }}>{file.name}</span>
            <span style={{ color: 'var(--t-3)', fontSize: 11 }}>{formatSize(file.size)}</span>
          </div>
          {file.state === 'progress' && (
            <div style={{ marginTop: 6, height: 4, background: '#d0d7de', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{
                width: `${Math.round(file.progress * 100)}%`,
                height: '100%', background: 'var(--brand)',
                transition: 'width 0.2s',
              }} />
            </div>
          )}
          {file.state === 'done' && file.direction === 'in' && !isImage && (
            <button
              className="primary"
              style={{ marginTop: 6, width: '100%', justifyContent: 'center' }}
              onClick={() => onDownload(file.id)}
            >⬇ 下载</button>
          )}
          {file.state === 'done' && file.direction === 'out' && (
            <div style={{ marginTop: 4, color: 'var(--success)', fontSize: 12 }}>✓ 已发送</div>
          )}
        </div>
      )}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
