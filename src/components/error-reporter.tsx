'use client';

import { useEffect } from 'react';
import { reportClientError } from '@/lib/observability/client';

/** Captura `window.onerror` y las promesas rechazadas sin tratar y las manda a /api/telemetry/error (sin cookies ni almacenamiento). No pinta nada. */
export function ErrorReporter() {
  useEffect(() => {
    const onError = (ev: ErrorEvent) => reportClientError('error', ev.error ?? ev.message);
    const onRejection = (ev: PromiseRejectionEvent) => reportClientError('unhandledrejection', ev.reason);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);
  return null;
}
