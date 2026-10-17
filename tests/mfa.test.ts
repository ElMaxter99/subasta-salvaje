import { describe, expect, it } from 'vitest';
import { mfaPendingFor, superadminMfaRequired } from '@/lib/auth/host';

describe('MFA del superadmin', () => {
  it('es opt-in', () => {
    expect(superadminMfaRequired({} as never)).toBe(false);
    expect(superadminMfaRequired({ SUPERADMIN_REQUIRE_MFA: 'true' } as never)).toBe(true);
    expect(superadminMfaRequired({ SUPERADMIN_REQUIRE_MFA: 'no' } as never)).toBe(false);
  });
  it('aal2 = nada pendiente; con factor sin verificar en esta sesión = verify; sin factor = enroll', () => {
    expect(mfaPendingFor({ currentLevel: 'aal2', nextLevel: 'aal2' })).toBeNull();
    expect(mfaPendingFor({ currentLevel: 'aal1', nextLevel: 'aal2' })).toBe('verify');
    expect(mfaPendingFor({ currentLevel: 'aal1', nextLevel: 'aal1' })).toBe('enroll');
  });
  it('si Supabase no responde, falla cerrado (pide enrolar, no concede poderes)', () => {
    expect(mfaPendingFor(null)).toBe('enroll');
  });
});
