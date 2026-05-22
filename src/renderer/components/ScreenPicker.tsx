import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface Source {
  id: string;
  name: string;
  thumbnail: string;
  isScreen: boolean;
}

interface Props {
  onPick: (sourceId: string, name: string, withAudio: boolean) => void;
  onCancel: () => void;
}

export function ScreenPicker({ onPick, onCancel }: Props) {
  const [sources, setSources] = useState<Source[]>([]);
  const [filter, setFilter] = useState<'all' | 'screen' | 'window'>('all');
  const [withAudio, setWithAudio] = useState(false);

  useEffect(() => {
    window.voiceMeet.screen.getSources().then(setSources);
  }, []);

  const filtered = sources.filter((s) =>
    filter === 'all' ? true : filter === 'screen' ? s.isScreen : !s.isScreen,
  );

  return createPortal(
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 720, maxWidth: '90vw' }}>
        <h3>选择要共享的内容</h3>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button className={filter === 'all' ? 'primary' : ''} onClick={() => setFilter('all')}>全部</button>
          <button className={filter === 'screen' ? 'primary' : ''} onClick={() => setFilter('screen')}>整个屏幕</button>
          <button className={filter === 'window' ? 'primary' : ''} onClick={() => setFilter('window')}>窗口</button>
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: 12,
          maxHeight: '60vh',
          overflowY: 'auto',
        }}>
          {filtered.map((s) => (
            <button
              key={s.id}
              className="ghost"
              onClick={() => onPick(s.id, s.name, withAudio && s.isScreen)}
              style={{
                padding: 0,
                height: 'auto',
                flexDirection: 'column',
                border: '1px solid var(--b-1)',
                borderRadius: 'var(--r-2)',
                overflow: 'hidden',
                background: '#fff',
                gap: 0,
                width: '100%',
              }}
            >
              <img
                src={s.thumbnail}
                alt={s.name}
                style={{
                  width: '100%',
                  display: 'block',
                  aspectRatio: '16/9',
                  objectFit: 'cover',
                  background: 'var(--bg-soft)',
                }}
              />
              <div style={{
                padding: '8px 10px',
                fontSize: 12,
                width: '100%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                color: 'var(--t-2)',
                textAlign: 'left',
              }}>
                {s.isScreen ? '🖥️ ' : '🪟 '}{s.name}
              </div>
            </button>
          ))}
          {filtered.length === 0 && (
            <div style={{ color: 'var(--t-3)', gridColumn: '1 / -1', textAlign: 'center', padding: 24 }}>
              没有可共享的内容
            </div>
          )}
        </div>
        <div style={{
          marginTop: 16, padding: '10px 12px',
          background: 'var(--bg-soft)', borderRadius: 'var(--r-1)',
          display: 'flex', alignItems: 'center', gap: 10,
          fontSize: 13,
        }}>
          <input
            type="checkbox"
            id="share-audio"
            checked={withAudio}
            onChange={(e) => setWithAudio(e.target.checked)}
            style={{ width: 16, height: 16, margin: 0 }}
          />
          <label htmlFor="share-audio" style={{ margin: 0, cursor: 'pointer', fontWeight: 400, color: 'var(--t-2)' }}>
            同时共享系统声音 <span style={{ color: 'var(--t-3)', fontSize: 11 }}>（仅在选择「整个屏幕」时可用）</span>
          </label>
        </div>
        <div className="actions" style={{ marginTop: 16 }}>
          <button onClick={onCancel}>取消</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
