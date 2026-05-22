import { useState } from 'react';
import { EMOJI_GROUPS } from '../lib/emoji';

interface Props {
  onPick: (emoji: string) => void;
  onClose: () => void;
}

export function EmojiPicker({ onPick, onClose }: Props) {
  const [group, setGroup] = useState(0);
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 56, right: 10,
        background: '#fff', border: '1px solid var(--b-1)', borderRadius: 8,
        boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
        width: 280, zIndex: 20,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ display: 'flex', borderBottom: '1px solid var(--b-1)' }}>
        {EMOJI_GROUPS.map((g, i) => (
          <button
            key={g.name}
            className="ghost"
            onClick={() => setGroup(i)}
            style={{ flex: 1, borderRadius: 0, fontSize: 12, fontWeight: i === group ? 600 : 400, padding: '8px 4px' }}
          >
            {g.name}
          </button>
        ))}
        <button className="ghost" onClick={onClose} style={{ borderRadius: 0, padding: '8px 10px' }}>✕</button>
      </div>
      <div style={{ padding: 8, display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 2, maxHeight: 200, overflowY: 'auto' }}>
        {EMOJI_GROUPS[group].emojis.map((e) => (
          <button
            key={e}
            className="ghost"
            onClick={() => onPick(e)}
            style={{ fontSize: 18, padding: 4, justifyContent: 'center' }}
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}
