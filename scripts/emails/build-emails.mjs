// Genera las plantillas de correo de Supabase Auth (plan B: pegarlas en su panel) a partir de la MISMA fuente que usa la app para
// enviar sus propios correos con Resend: src/lib/mail/templates.ts. Uso:
//   npm run emails:build            → escribe supabase/templates/*.html (con variables de Supabase: {{ .SiteURL }}…)
//   npm run emails:build -- --preview → además escribe .email-preview/*.html con datos de ejemplo (incluye la invitación de la app)
// Si la app envía los correos con Resend (RESEND_API_KEY + MAIL_FROM), estas plantillas de Supabase solo son un respaldo.
import { mkdirSync, writeFileSync } from 'node:fs';
import { MAIL_KINDS, SUPABASE_KINDS, renderMail } from '../../src/lib/mail/templates.ts';

const OUT = 'supabase/templates';
const PREVIEW = '.email-preview';
const preview = process.argv.includes('--preview');

const GO = { siteUrl: '{{ .SiteURL }}', tokenHash: '{{ .TokenHash }}', email: '{{ .Email }}', newEmail: '{{ .NewEmail }}', token: '{{ .Token }}' };
const SAMPLE = { siteUrl: '../public', tokenHash: 'EJEMPLO_TOKEN', email: 'anfitrion@ejemplo.com', newEmail: 'nuevo@ejemplo.com', token: '482915' };

mkdirSync(OUT, { recursive: true });
if (preview) mkdirSync(PREVIEW, { recursive: true });
const subjects = {};
for (const kind of SUPABASE_KINDS) {
  const r = renderMail(kind, GO);
  writeFileSync(`${OUT}/${kind}.html`, r.html);
  subjects[kind] = r.subject;
}
if (preview) for (const kind of MAIL_KINDS) writeFileSync(`${PREVIEW}/${kind}.html`, renderMail(kind, SAMPLE).html);
writeFileSync(`${OUT}/subjects.json`, JSON.stringify(subjects, null, 2) + '\n');
console.log(`✔ ${SUPABASE_KINDS.length} plantillas en ${OUT}/${preview ? ` y vista previa (${MAIL_KINDS.length}) en ${PREVIEW}/` : ''}`);
