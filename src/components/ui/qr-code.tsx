'use client';

import { useEffect, useState } from 'react';

/** QR generado en el navegador (sin servicios externos). `value` suele ser la URL de unión de los jugadores. */
export function QrCode({ value, size = 192, className = '', label = 'Código QR para unirse' }: { value: string; size?: number; className?: string; label?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void import('qrcode').then(({ default: QR }) =>
      QR.toDataURL(value, { margin: 1, width: size * 2, color: { dark: '#050816', light: '#ffffff' } }).then((url) => !cancelled && setSrc(url)),
    );
    return () => {
      cancelled = true;
    };
  }, [value, size]);
  return (
    <div className={`overflow-hidden rounded-2xl bg-white p-2 ${className}`} style={{ width: size, height: size }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src ? <img src={src} alt={`${label}: ${value}`} width={size} height={size} className="size-full" /> : null}
    </div>
  );
}

/** URL absoluta para que los jugadores se unan (sólo en el navegador). */
export function joinUrl(roomCode: string): string {
  return `${window.location.origin}/game/${roomCode}/play`;
}
