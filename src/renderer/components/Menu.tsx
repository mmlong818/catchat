import { useEffect, useRef, useState, ReactNode } from 'react';

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
}

interface Props {
  items: MenuItem[];
  trigger: (open: () => void) => ReactNode;
  position?: 'top' | 'bottom';
}

export function Menu({ items, trigger, position = 'top' }: Props) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div ref={wrapperRef} style={{ position: 'relative', display: 'inline-flex' }}>
      {trigger(() => setOpen((v) => !v))}
      {open && (
        <div
          style={{
            position: 'absolute',
            [position === 'top' ? 'bottom' : 'top']: 'calc(100% + 8px)',
            right: 0,
            background: 'var(--bg-elev-solid)',
            border: '1px solid var(--b-1)',
            borderRadius: 'var(--r-2)',
            boxShadow: 'var(--sh-3)',
            minWidth: 180,
            padding: 4,
            zIndex: 50,
            animation: 'fadeUp var(--d-base) var(--ease-out)',
          }}
        >
          {items.map((it, i) => (
            <button
              key={i}
              onClick={() => { it.onClick(); setOpen(false); }}
              className="menu-item"
              data-danger={it.danger || undefined}
            >
              {it.icon}
              <span>{it.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
