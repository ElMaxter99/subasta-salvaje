import { describe, expect, it, vi } from 'vitest';
import { createResendMailer, MailError } from '@/lib/mail/resend';
import { getMailer, mailStatus } from '@/lib/mail';
import { renderMail } from '@/lib/mail/templates';
import { redactSecrets } from '@/lib/security/redact';
import { prepareRecovery, sendAppInvite, signUpWithEmail, type AuthAdmin } from '@/lib/services/auth-mail';
import type { Mailer } from '@/lib/mail/resend';

const SITE = 'https://app.example.com/';
const KEY = ['re', 'abcdefgh', '1234567890abcdefghij'].join('_'); // clave FALSA, partida para no activar el escáner de secretos

function fakes(over: Partial<AuthAdmin> = {}) {
  const sent: { to: string; subject: string; html: string; text: string }[] = [];
  const mailer: Mailer = { send: async (m) => void sent.push(m) };
  const admin: AuthAdmin = {
    createUser: vi.fn(async () => ({ error: null })),
    generateLink: vi.fn(async () => ({ data: { properties: { hashed_token: 'HASH123' } }, error: null })),
    ...over,
  };
  return { sent, mailer, admin };
}

describe('Resend', () => {
  it('envía con Bearer, remitente y reply_to', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    await createResendMailer({ apiKey: KEY, from: 'A <a@x.com>', replyTo: 'r@x.com', fetchImpl: fetchImpl as never }).send({ to: 'u@x.com', subject: 's', html: '<p>h</p>', text: 't' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(init.body as string)).toMatchObject({ from: 'A <a@x.com>', to: ['u@x.com'], reply_to: 'r@x.com' });
  });
  it('un error no filtra la clave y marca reintentable', async () => {
    const fetchImpl = vi.fn(async () => new Response(`bad ${KEY}`, { status: 503 }));
    const err = await createResendMailer({ apiKey: KEY, from: 'a@x.com', fetchImpl: fetchImpl as never }).send({ to: 'u@x.com', subject: 's', html: 'h', text: 't' }).catch((e) => e);
    expect(err).toBeInstanceOf(MailError);
    expect(err.retryable).toBe(true);
    expect(err.message).not.toContain(KEY);
  });
  it('configuración por entorno', () => {
    expect(getMailer({} as never)).toBeNull();
    expect(mailStatus({ RESEND_API_KEY: KEY } as never).missing).toEqual(['MAIL_FROM']);
    expect(mailStatus({ RESEND_API_KEY: KEY, MAIL_FROM: 'App <no-reply@x.com>' } as never).configured).toBe(true);
    expect(mailStatus({ RESEND_API_KEY: KEY, MAIL_FROM: 'sin-arroba' } as never).configured).toBe(false);
  });
  it('redacta claves re_', () => {
    expect(redactSecrets(`x ${KEY} y`, {} as never)).not.toContain(KEY);
  });
});

describe('auth-mail', () => {
  it('registro con correo propio: crea sin confirmar y envía el enlace', async () => {
    const f = fakes();
    const r = await signUpWithEmail('u@x.com', 'password1', { admin: f.admin, mailer: f.mailer, siteUrl: SITE });
    expect(r.status).toBe('confirmation_sent');
    expect(f.admin.createUser).not.toHaveBeenCalled();
    expect(f.sent).toHaveLength(0); // el envío se difiere (segundo plano)
    await (r as { send: () => Promise<void> }).send();
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0]!.html).toContain('https://app.example.com/auth/callback?token_hash=HASH123&type=signup');
  });
  it('registro con correo propio no revela cuentas existentes', async () => {
    const f = fakes({ generateLink: async () => ({ data: null, error: { message: 'User already registered' } }) });
    const r = await signUpWithEmail('u@x.com', 'password1', { admin: f.admin, mailer: f.mailer, siteUrl: SITE });
    expect(r).toEqual({ status: 'confirmation_sent' }); // sin `send`: nada que enviar
    expect(f.sent).toHaveLength(0);
  });
  it('registro sin correo propio: createUser confirmado', async () => {
    const f = fakes();
    expect(await signUpWithEmail('u@x.com', 'password1', { admin: f.admin, mailer: null, siteUrl: SITE })).toEqual({ status: 'created' });
    expect(f.admin.createUser).toHaveBeenCalledWith({ email: 'u@x.com', password: 'password1', email_confirm: true });
  });
  it('recuperación: sin mailer no la gestiona; con mailer difiere el envío; cuenta inexistente no envía', async () => {
    const f = fakes();
    expect((await prepareRecovery('u@x.com', { admin: f.admin, mailer: null, siteUrl: SITE })).handled).toBe(false);
    const r = await prepareRecovery('u@x.com', { admin: f.admin, mailer: f.mailer, siteUrl: SITE });
    expect(r.handled).toBe(true);
    expect(f.sent).toHaveLength(0);
    await r.send!();
    expect(f.sent[0]!.html).toContain('type=recovery');
    const g = fakes({ generateLink: async () => ({ data: null, error: { message: 'not found' } }) });
    const none = await prepareRecovery('n@x.com', { admin: g.admin, mailer: g.mailer, siteUrl: SITE });
    expect(none).toEqual({ handled: true });
    expect(g.sent).toHaveLength(0);
  });
  it('invitación de la app', async () => {
    const f = fakes();
    await sendAppInvite('u@x.com', { admin: f.admin, mailer: f.mailer, siteUrl: SITE });
    expect(f.sent[0]!.html).toContain('https://app.example.com/login?mode=signup');
    await expect(sendAppInvite('u@x.com', { admin: f.admin, mailer: null, siteUrl: SITE })).rejects.toThrow();
  });
  it('plantilla escapa valores externos', () => {
    const m = renderMail('app_invite', { siteUrl: 'https://a.com', email: '<b>x</b>@y.com' });
    expect(m.html).not.toContain('<b>x</b>');
  });
});
