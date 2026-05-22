import { ReactNode } from 'react';

interface Props {
  title: string;
  body?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({ title, body, confirmText = '确定', cancelText = '取消', danger, onConfirm, onCancel }: Props) {
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {body && <p>{body}</p>}
        <div className="actions">
          <button onClick={onCancel}>{cancelText}</button>
          <button className={danger ? 'danger' : 'primary'} onClick={onConfirm}>{confirmText}</button>
        </div>
      </div>
    </div>
  );
}
