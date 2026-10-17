import { redactSecrets } from '@/lib/security/redact';

/** Cliente mínimo de la API REST de Resend (POST https://api.resend.com/emails). Sin dependencias nuevas. */
export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface Mailer {
  send(msg: MailMessage): Promise<void>;
}

export class MailError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = 'MailError';
  }
}

export interface ResendOptions {
  apiKey: string;
  from: string;
  replyTo?: string | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export function createResendMailer(opts: ResendOptions): Mailer {
  const doFetch = opts.fetchImpl ?? fetch;
  return {
    async send(msg) {
      let res: Response;
      try {
        res = await doFetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: opts.from, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text, ...(opts.replyTo ? { reply_to: opts.replyTo } : {}) }),
          signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
        });
      } catch (e) {
        throw new MailError(`No se pudo contactar con Resend: ${redactSecrets((e as Error).message)}`, true);
      }
      if (res.ok) return;
      const detail = redactSecrets((await res.text().catch(() => '')).slice(0, 300));
      throw new MailError(`Resend ${res.status}: ${detail}`, res.status === 429 || res.status >= 500);
    },
  };
}
