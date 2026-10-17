import { describe, expect, it } from 'vitest';
import { analyticsDisabled, sanitizeAnalyticsUrl } from '@/lib/analytics';

describe('analítica: qué se envía', () => {
  it('sustituye el código de la partida y quita consulta y fragmento', () => {
    expect(sanitizeAnalyticsUrl('https://app.com/game/ABC123/play?token=zzz#x')).toBe('https://app.com/game/[code]/play');
    expect(sanitizeAnalyticsUrl('/game/ABC123/screen')).toBe('/game/[code]/screen');
    expect(sanitizeAnalyticsUrl('/game/ABC123')).toBe('/game/[code]');
    expect(sanitizeAnalyticsUrl('https://app.com/auth/callback?token_hash=secreto&type=recovery')).toBe('https://app.com/auth/callback');
    expect(sanitizeAnalyticsUrl('/login?next=/game/ABC123/host')).toBe('/login');
    expect(sanitizeAnalyticsUrl('/')).toBe('/');
  });
  it('no mide el panel de administración ni el segundo factor', () => {
    for (const p of ['/admin', '/admin/ia', 'https://app.com/admin/usuarios?x=1', '/seguridad-admin']) expect(sanitizeAnalyticsUrl(p)).toBeNull();
    expect(sanitizeAnalyticsUrl('/administrador')).toBe('/administrador');
  });
  it('se puede desactivar por variable', () => {
    expect(analyticsDisabled({})).toBe(false);
    expect(analyticsDisabled({ NEXT_PUBLIC_DISABLE_ANALYTICS: 'true' })).toBe(true);
  });
});
