'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from './button';

interface Props {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  variant?: 'primary' | 'danger' | 'success';
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Diálogo modal accesible (usa <dialog>): confirma acciones irreversibles como adjudicar. */
export function ConfirmDialog({ open, title, children, confirmLabel, cancelLabel = 'Cancelar', variant = 'primary', loading, onConfirm, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        if (!loading) onCancel();
      }}
      onClick={(e) => e.target === ref.current && !loading && onCancel()}
      className="m-auto w-[min(92vw,30rem)] rounded-3xl border border-white/15 bg-night-800 p-0 text-white shadow-2xl backdrop:bg-black/70 backdrop:backdrop-blur-sm"
    >
      <div className="space-y-4 p-6">
        <h2 className="font-display text-2xl">{title}</h2>
        <div className="text-base text-white/80">{children}</div>
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button variant="ghost" size="lg" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={variant} size="lg" onClick={onConfirm} loading={loading} autoFocus>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
