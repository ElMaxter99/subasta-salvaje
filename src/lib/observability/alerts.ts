import { getMailer } from '@/lib/mail';
import { escapeHtml } from '@/lib/mail/templates';
import { superadminEmails } from '@/lib/auth/host';
import { siteUrl } from '@/lib/seo/site';

type DbLike = { rpc<T = unknown>(fn: string, params: Record<string, unknown>): Promise<T> };
export interface ObsAlert { kind: 'spike' | 'new_error'; [k: string]: unknown }

/** Mínimo de horas entre dos correos-resumen (anti-spam). */
export const ALERT_MIN_HOURS = 6;

/**
 * Correo-resumen OPCIONAL a los superadmins. Solo se envía si: el interruptor de Ajustes está activo (desactivado por defecto), hay Resend
 * configurado (RESEND_API_KEY + MAIL_FROM), hay correos en SUPERADMIN_EMAILS, hay una alerta real y no se envió otro en las últimas
 * ALERT_MIN_HOURS horas (reserva atómica en SQL). Sin Resend no se envía nada. Contiene solo recuentos, ruta y código: sin mensajes ni datos de usuarios.
 * Devuelve cuántos correos salieron. Nunca lanza.
 */
export async function maybeSendAlert(db: DbLike, env: NodeJS.ProcessEnv = process.env): Promise<number> {
  try {
    const mailer = getMailer(env);
    const to = superadminEmails(env);
    if (!mailer || to.length === 0) return 0;
    const ov = await db.rpc<{ alerts: ObsAlert[] }>('ss_obs_overview', {});
    if (!ov.alerts.length) return 0;
    const claim = await db.rpc<{ send: boolean }>('ss_obs_alert_claim', { min_hours: ALERT_MIN_HOURS });
    if (!claim.send) return 0;
    const lines: string[] = [];
    for (const a of ov.alerts) {
      if (a.kind === 'spike') lines.push(`Pico de errores: ${String(a.errors_last_hour)} en la última hora (media habitual ${String(a.avg_per_hour)} por hora).`);
      if (a.kind === 'new_error') {
        for (const e of (a.errors as { route: string; code: string }[]).slice(0, 5)) lines.push(`Error grave nuevo: ${e.code} en ${e.route || '(sin ruta)'}.`);
      }
    }
    const link = `${siteUrl().origin}/admin/observabilidad`;
    const text = `${lines.join('\n')}\n\nDetalle: ${link}\n\n(Resumen automático de Subasta Salvaje. Se envía como mucho uno cada ${ALERT_MIN_HOURS} horas; se desactiva en Superadmin → Ajustes.)`;
    const html = `<p>${lines.map(escapeHtml).join('<br>')}</p><p><a href="${escapeHtml(link)}">Abrir la observabilidad</a></p><p style="color:#666;font-size:12px">Resumen automático. Como mucho uno cada ${ALERT_MIN_HOURS} horas; se desactiva en Superadmin → Ajustes.</p>`;
    let sent = 0;
    for (const addr of to.slice(0, 5)) {
      try {
        await mailer.send({ to: addr, subject: 'Subasta Salvaje · alerta de errores', html, text });
        sent++;
      } catch {
        /* un destinatario que falla no impide los demás */
      }
    }
    return sent;
  } catch {
    return 0;
  }
}
