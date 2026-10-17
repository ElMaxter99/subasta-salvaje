import { getSupabaseAdmin } from '@/lib/db/supabase';
import { getMailer } from '@/lib/mail';
import { siteUrl } from '@/lib/seo/site';
import { adminFromSupabase, type AuthMailDeps } from './auth-mail';

/** Dependencias reales (solo servidor): admin de Supabase, Resend si está configurado y origen público de confianza. */
export function getAuthMailDeps(): AuthMailDeps {
  return { admin: adminFromSupabase(getSupabaseAdmin() as never), mailer: getMailer(), siteUrl: siteUrl().origin };
}
