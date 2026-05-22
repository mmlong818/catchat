import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Avatar } from './Avatar';
import {
  type Avatar as AvatarT,
  PRESET_AVATARS,
  letterAvatars,
} from '../lib/avatars';

interface Props {
  name: string;
  current: AvatarT | null;
  onChange: (a: AvatarT) => void;
}

export function AvatarPicker({ name, current, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleUpload = (file: File) => {
    if (file.size > 500_000) {
      alert('图片过大，请选择小于 500KB 的图片');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      // resize to 128×128 to keep dataURL small
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 128; canvas.height = 128;
        const ctx = canvas.getContext('2d')!;
        const min = Math.min(img.width, img.height);
        const sx = (img.width - min) / 2;
        const sy = (img.height - min) / 2;
        ctx.drawImage(img, sx, sy, min, min, 0, 0, 128, 128);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        onChange({ kind: 'image', value: dataUrl });
        setOpen(false);
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };

  const choices: AvatarT[] = [...letterAvatars(name), ...PRESET_AVATARS];

  return (
    <>
      <button type="button" className="ghost" onClick={() => setOpen(true)} style={{ padding: 2, borderRadius: '50%' }}>
        <Avatar avatar={current} name={name} size="lg" />
      </button>

      {open && createPortal(
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <h3>选择头像</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 16 }}>
              {choices.map((a, i) => (
                <button
                  key={i}
                  type="button"
                  className="ghost"
                  style={{ padding: 0, borderRadius: '50%' }}
                  onClick={() => { onChange(a); setOpen(false); }}
                >
                  <Avatar avatar={a} name={name} size="lg" />
                </button>
              ))}
            </div>
            <div className="actions">
              <button onClick={() => setOpen(false)}>取消</button>
              <button className="primary" onClick={() => fileRef.current?.click()}>上传图片…</button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleUpload(file);
              }}
            />
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
