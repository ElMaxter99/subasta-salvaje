'use client';

import { useState } from 'react';
import { Check, Copy, ExternalLink, Tv } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';

export function TvLinks({ roomCode }: { roomCode: string }) {
  const [copied, setCopied] = useState(false);
  const toast = useToast();
  const url = () => `${window.location.origin}/game/${roomCode}/screen`;

  async function copy() {
    const text = url();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Respaldo para contextos sin Clipboard API
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      if (!ok) {
        toast.error(`No se pudo copiar. Enlace: ${text}`);
        return;
      }
    }
    setCopied(true);
    toast.success('Enlace de la pantalla de TV copiado');
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Pantalla de TV">
      <span className="flex items-center gap-1.5 text-sm font-bold text-violet-soft">
        <Tv className="size-4" aria-hidden /> Pantalla de TV
      </span>
      <Button size="sm" variant="secondary" onClick={copy}>
        {copied ? <Check className="size-4 text-teal" aria-hidden /> : <Copy className="size-4" aria-hidden />}
        {copied ? 'Copiado' : 'Copiar enlace'}
      </Button>
      <Button size="sm" variant="secondary" onClick={() => window.open(url(), '_blank', 'noopener')}>
        <ExternalLink className="size-4" aria-hidden /> Abrir en pestaña nueva
      </Button>
    </div>
  );
}
