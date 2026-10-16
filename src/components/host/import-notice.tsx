'use client';

import { useEffect } from 'react';
import { useToast } from '@/components/ui/toast';

/** Avisa (una sola vez) de las fotos de la plantilla que no se pudieron descargar al crear esta partida. */
export function ImportNotice({ roomCode }: { roomCode: string }) {
  const toast = useToast();
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem('ss_import_notice');
      if (!raw) return;
      const n = JSON.parse(raw) as { code: string; imported: number; failed: { name: string; reason: string }[] };
      if (n.code !== roomCode) return;
      window.sessionStorage.removeItem('ss_import_notice');
      const list = n.failed.slice(0, 3).map((f) => `${f.name} (${f.reason})`).join(', ');
      toast.error(`${n.failed.length} ${n.failed.length === 1 ? 'foto' : 'fotos'} de la plantilla no se ${n.failed.length === 1 ? 'pudo' : 'pudieron'} descargar: ${list}${n.failed.length > 3 ? '…' : ''}. Puedes subirlas a mano en Catálogo.`);
    } catch {
      /* sin almacenamiento */
    }
  }, [roomCode, toast]);
  return null;
}
