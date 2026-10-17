import { createResendMailer, type Mailer } from './resend';

export type { Mailer, MailMessage } from './resend';
export { MailError } from './resend';

/** Remitente válido: «correo@dominio» o «Nombre <correo@dominio>». */
const FROM_RE = /^(?:[^<>\r\n]+<)?[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>?$/;

export function mailFrom(env: NodeJS.ProcessEnv = process.env): string | null {
  const v = env.MAIL_FROM?.trim();
  return v && FROM_RE.test(v) ? v : null;
}

/** Devuelve el enviador de correo o null si falta RESEND_API_KEY / MAIL_FROM (entonces la app no envía correos propios). */
export function getMailer(env: NodeJS.ProcessEnv = process.env): Mailer | null {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = mailFrom(env);
  if (!apiKey || !from) return null;
  return createResendMailer({ apiKey, from, replyTo: env.MAIL_REPLY_TO?.trim() || null });
}

export function mailStatus(env: NodeJS.ProcessEnv = process.env): { configured: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!env.RESEND_API_KEY?.trim()) missing.push('RESEND_API_KEY');
  if (!mailFrom(env)) missing.push('MAIL_FROM');
  return { configured: missing.length === 0, missing };
}
