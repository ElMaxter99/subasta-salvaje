import { DomainError } from '@/lib/domain/errors';
import { redactSecrets } from '@/lib/security/redact';
import { renderMail } from '@/lib/mail/templates';
import type { Mailer } from '@/lib/mail/resend';

/** Parte de la API de administración de Supabase Auth que usamos (inyectable en tests). */
export interface AuthAdmin {
  createUser(a: { email: string; password: string; email_confirm: boolean }): Promise<{ error: { message: string } | null }>;
  generateLink(a: { type: 'signup' | 'recovery'; email: string; password?: string }): Promise<{ data: { properties?: { hashed_token?: string } } | null; error: { message: string } | null }>;
}

export interface AuthMailDeps {
  admin: AuthAdmin;
  mailer: Mailer | null;
  /** Origen público de confianza (nunca de cabeceras de la petición). */
  siteUrl: string;
}

export type SignUpResult = { status: 'created' } | { status: 'confirmation_sent' };

const trim = (u: string) => u.replace(/\/+$/, '');

/**
 * Alta de anfitrión SIN pasar por el registro público de Supabase (se usa la API de administración con la clave de servicio).
 *  · Con correo propio (Resend): crea la cuenta sin confirmar y envía el enlace de confirmación con la marca de la app.
 *    Responde igual exista o no la cuenta (no revela qué correos están registrados).
 *  · Sin correo propio: crea la cuenta ya confirmada (solo se llega aquí si el correo está invitado o el registro está abierto);
 *    no se puede comprobar que el correo sea de quien se registra.
 */
export async function signUpWithEmail(email: string, password: string, deps: AuthMailDeps): Promise<SignUpResult> {
  if (!deps.mailer) {
    const { error } = await deps.admin.createUser({ email, password, email_confirm: true });
    if (error) {
      if (/already|registered|exists/i.test(error.message)) throw new DomainError('invalid_input', 'No se pudo crear la cuenta con esos datos. Si ya tienes una, inicia sesión o recupera la contraseña.', 400);
      throw new DomainError('invalid_input', redactSecrets(error.message), 400);
    }
    return { status: 'created' };
  }
  const { data, error } = await deps.admin.generateLink({ type: 'signup', email, password });
  const hash = data?.properties?.hashed_token;
  if (error || !hash) {
    // Cuenta ya existente u otro fallo: misma respuesta. Una contraseña débil sí se avisa.
    if (error && /password/i.test(error.message)) throw new DomainError('invalid_input', redactSecrets(error.message), 400);
    return { status: 'confirmation_sent' };
  }
  const mail = renderMail('confirmation', { siteUrl: trim(deps.siteUrl), tokenHash: hash, email });
  await sendOrFail(deps.mailer, email, mail);
  return { status: 'confirmation_sent' };
}

/** Correo de recuperación de contraseña. Devuelve false si no hay correo propio (el llamador usa el de Supabase). */
export async function sendRecovery(email: string, deps: AuthMailDeps): Promise<boolean> {
  if (!deps.mailer) return false;
  const { data, error } = await deps.admin.generateLink({ type: 'recovery', email });
  const hash = data?.properties?.hashed_token;
  if (error || !hash) return true; // cuenta inexistente: no se revela
  await sendOrFail(deps.mailer, email, renderMail('recovery', { siteUrl: trim(deps.siteUrl), tokenHash: hash, email }));
  return true;
}

/** Invitación del superadmin: avisa de que ya puede crear su cuenta. */
export async function sendAppInvite(email: string, deps: AuthMailDeps): Promise<void> {
  if (!deps.mailer) throw new DomainError('invalid_input', 'El envío de correos no está configurado (RESEND_API_KEY y MAIL_FROM).', 400);
  await sendOrFail(deps.mailer, email, renderMail('app_invite', { siteUrl: trim(deps.siteUrl), email }));
}

async function sendOrFail(mailer: Mailer, to: string, mail: { subject: string; html: string; text: string }): Promise<void> {
  try {
    await mailer.send({ to, ...mail });
  } catch (e) {
    console.error('[mail] envío fallido:', redactSecrets((e as Error).message));
    throw new DomainError('invalid_input', 'No se pudo enviar el correo ahora mismo. Inténtalo de nuevo en unos minutos.', 502);
  }
}

/** Adaptador real: la API de administración de supabase-js. */
export function adminFromSupabase(client: { auth: { admin: { createUser: (a: never) => Promise<{ error: { message: string } | null }>; generateLink: (a: never) => Promise<{ data: unknown; error: { message: string } | null }> } } }): AuthAdmin {
  return {
    createUser: (a) => client.auth.admin.createUser(a as never),
    generateLink: async (a) => {
      const r = await client.auth.admin.generateLink(a as never);
      return { data: r.data as { properties?: { hashed_token?: string } } | null, error: r.error };
    },
  };
}
