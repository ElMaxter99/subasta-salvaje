'use client';

import { Analytics } from '@vercel/analytics/next';
import { sanitizeAnalyticsUrl } from '@/lib/analytics';

/** Vercel Web Analytics (sin cookies). Solo mide en producción; respeta «No rastrear» y quita códigos de partida y consultas de las URLs. */
export function SiteAnalytics() {
  return (
    <Analytics
      beforeSend={(event) => {
        const dnt = typeof navigator !== 'undefined' && (navigator.doNotTrack === '1' || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true);
        if (dnt) return null;
        const url = sanitizeAnalyticsUrl(event.url);
        return url ? { ...event, url } : null;
      }}
    />
  );
}
