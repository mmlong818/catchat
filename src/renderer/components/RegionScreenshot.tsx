import { useEffect, useRef, useState } from 'react';

interface Props {
  bgDataUrl: string;
  realWidth: number;
  realHeight: number;
  onConfirm: (cropped: File) => void;
  onCancel: () => void;
}

interface Rect { x: number; y: number; w: number; h: number }

export function RegionScreenshot({ bgDataUrl, realWidth, realHeight, onConfirm, onCancel }: Props) {
  const [rect, setRect] = useState<Rect | null>(null);
  const [dragging, setDragging] = useState(false);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter' && rect && rect.w > 5 && rect.h > 5) finalize();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rect]);

  const onMouseDown = (e: React.MouseEvent) => {
    startRef.current = { x: e.clientX, y: e.clientY };
    setRect({ x: e.clientX, y: e.clientY, w: 0, h: 0 });
    setDragging(true);
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragging || !startRef.current) return;
    const sx = startRef.current.x;
    const sy = startRef.current.y;
    setRect({
      x: Math.min(sx, e.clientX),
      y: Math.min(sy, e.clientY),
      w: Math.abs(e.clientX - sx),
      h: Math.abs(e.clientY - sy),
    });
  };

  const onMouseUp = () => {
    setDragging(false);
  };

  const finalize = async () => {
    if (!rect) return;
    // Map screen coordinates to source image coordinates
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const scaleX = realWidth / vw;
    const scaleY = realHeight / vh;
    const cropX = Math.round(rect.x * scaleX);
    const cropY = Math.round(rect.y * scaleY);
    const cropW = Math.max(1, Math.round(rect.w * scaleX));
    const cropH = Math.max(1, Math.round(rect.h * scaleY));

    const img = new Image();
    img.src = bgDataUrl;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = cropW;
    canvas.height = cropH;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
    const blob = await new Promise<Blob>((res, rej) =>
      canvas.toBlob((b) => b ? res(b) : rej(new Error('toBlob failed')), 'image/png'),
    );
    onConfirm(new File([blob], `screenshot-${Date.now()}.png`, { type: 'image/png' }));
  };

  return (
    <div
      className="region-overlay"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
    >
      <div className="bg" style={{ backgroundImage: `url(${bgDataUrl})` }} />
      {!rect && (
        <div className="hint">拖动鼠标框选截图区域 · Esc 取消</div>
      )}
      {rect && (
        <div
          className="selection"
          style={{
            left: rect.x, top: rect.y, width: rect.w, height: rect.h,
            backgroundImage: `url(${bgDataUrl})`,
            backgroundPosition: `-${rect.x}px -${rect.y}px`,
            backgroundSize: `${window.innerWidth}px ${window.innerHeight}px`,
          }}
        />
      )}
      {rect && !dragging && rect.w > 5 && rect.h > 5 && (
        <div
          className="controls"
          style={{
            left: Math.max(0, rect.x + rect.w - 160),
            top: rect.y + rect.h + 8,
          }}
        >
          <button onClick={onCancel}>取消</button>
          <button className="primary" onClick={finalize}>发送</button>
        </div>
      )}
    </div>
  );
}
