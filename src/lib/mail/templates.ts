/**
 * Correos de la app con la identidad de marca (HTML con tablas y estilos en línea, compatible con clientes de correo).
 * UNA sola fuente para dos usos:
 *  · en tiempo de ejecución, `renderMail()` con datos reales (los envía la app con Resend);
 *  · `scripts/emails/build-emails.mjs` las vuelve a generar con variables de Supabase ({{ .SiteURL }}…) para pegarlas en su panel (plan B).
 * Sin importaciones (lo carga Node directamente desde el script).
 */
export type MailKind = 'confirmation' | 'invite' | 'magic_link' | 'recovery' | 'email_change' | 'reauthentication' | 'app_invite';

export interface MailVars {
  /** Origen público de la app (p. ej. https://subasta-salvaje.vercel.app), sin barra final. */
  siteUrl: string;
  /** `hashed_token` de Supabase (generateLink) para los enlaces de /auth/callback. */
  tokenHash?: string;
  email?: string;
  newEmail?: string;
  /** Código de un solo uso (reautenticación). */
  token?: string;
}

export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
}

const C = { night: '#050816', card: '#111a35', line: '#2a3a6e', gold: '#fbbf24', goldDark: '#b45309', text: '#e8ecff', muted: '#aab4d6', violet: '#c4b5fd' };
const FONT = "'Trebuchet MS','Segoe UI',Arial,sans-serif";
const IGNORE = 'Si no has sido tú, puedes ignorar este correo con tranquilidad: no se hará ningún cambio.';

/** Escapa texto que viene de fuera (correos) antes de meterlo en HTML. */
export const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

interface Spec {
  subject: string;
  preheader: string;
  title: string;
  intro: string;
  button?: { label: string; url: string };
  outro?: string;
  small: string;
  code?: string;
  /** Texto plano equivalente del `intro` si lleva HTML. */
  introText?: string;
}

function layout(siteUrl: string, s: Spec): string {
  const { preheader, title, intro, button, outro, small, code } = s;
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background:${C.night};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.night};">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.night}" style="background:${C.night};">
<tr><td align="center" style="padding:28px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
    <tr><td align="center" style="padding:0 0 18px;">
      <a href="${siteUrl}" style="text-decoration:none;"><img src="${siteUrl}/assets/brand/email-logo.png" width="200" alt="Subasta Salvaje" style="display:block;border:0;height:auto;max-width:200px;"></a>
    </td></tr>
    <tr><td bgcolor="${C.card}" style="background:${C.card};border:1px solid ${C.line};border-radius:20px;padding:28px 26px;font-family:${FONT};color:${C.text};">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td width="72" valign="middle" style="padding-right:14px;"><img src="${siteUrl}/assets/brand/email-head.png" width="64" alt="" style="display:block;border:0;height:auto;"></td>
        <td valign="middle"><h1 style="margin:0;font-family:${FONT};font-size:24px;line-height:1.2;color:#ffffff;font-weight:800;">${title}</h1></td>
      </tr></table>
      <p style="margin:20px 0 0;font-size:16px;line-height:1.55;color:${C.text};">${intro}</p>
      ${code ? `<p style="margin:22px 0 0;text-align:center;"><span style="display:inline-block;background:${C.night};border:2px dashed ${C.gold};border-radius:14px;padding:12px 22px;font-size:30px;letter-spacing:6px;font-weight:800;color:${C.gold};">${code}</span></p>` : ''}
      ${button ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px auto 0;"><tr><td align="center" bgcolor="${C.gold}" style="background:${C.gold};border-radius:14px;border-bottom:4px solid ${C.goldDark};">
        <a href="${button.url}" style="display:inline-block;padding:14px 30px;font-family:${FONT};font-size:18px;font-weight:800;color:${C.night};text-decoration:none;">${button.label}</a>
      </td></tr></table>
      <p style="margin:18px 0 0;font-size:13px;line-height:1.5;color:${C.muted};">¿El botón no funciona? Copia y pega este enlace en tu navegador:<br><a href="${button.url}" style="color:${C.violet};word-break:break-all;">${button.url}</a></p>` : ''}
      ${outro ? `<p style="margin:22px 0 0;font-size:15px;line-height:1.55;color:${C.text};">${outro}</p>` : ''}
    </td></tr>
    <tr><td align="center" style="padding:18px 8px 0;font-family:${FONT};font-size:12px;line-height:1.5;color:${C.muted};">
      ${small}<br>Subasta Salvaje · subastas creativas para noches de juegos
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>
`;
}

function plain(s: Spec): string {
  const strip = (h: string) => h.replace(/<[^>]+>/g, '');
  return [s.title, '', s.introText ?? strip(s.intro), s.code ? `\n${s.code}\n` : '', s.button ? `${s.button.label}: ${s.button.url}` : '', s.outro ? `\n${strip(s.outro)}` : '', `\n${strip(s.small)}`, 'Subasta Salvaje · subastas creativas para noches de juegos']
    .filter((x) => x !== '')
    .join('\n');
}

const link = (v: MailVars, type: string, next: string) => `${v.siteUrl}/auth/callback?token_hash=${v.tokenHash ?? ''}&type=${type}&next=${next}`;

function spec(kind: MailKind, v: MailVars): Spec {
  const email = escapeHtml(v.email ?? '');
  const newEmail = escapeHtml(v.newEmail ?? '');
  switch (kind) {
    case 'confirmation':
      return { subject: 'Confirma tu correo en Subasta Salvaje', preheader: 'Un clic y ya puedes crear tu primera partida.', title: '¡Bienvenido a Subasta Salvaje!', intro: 'Gracias por crear tu cuenta de anfitrión. Confirma tu correo electrónico para empezar a montar subastas con tus amigos.', button: { label: 'Confirmar mi correo', url: link(v, 'signup', '/') }, outro: 'Después podrás crear tu primera partida: tú diriges la subasta, la tele muestra el espectáculo y los demás pujan.', small: IGNORE };
    case 'invite':
      return { subject: 'Te han invitado a Subasta Salvaje', preheader: 'Alguien quiere que organices subastas con él.', title: '¡Te han invitado!', intro: 'Te han invitado a Subasta Salvaje, el juego de subastas creativas multijugador. Acepta la invitación para crear tu cuenta de anfitrión.', button: { label: 'Aceptar la invitación', url: link(v, 'invite', '/reset-password') }, outro: 'Al aceptar, elegirás tu contraseña.', small: 'Si no esperabas esta invitación, puedes ignorarla.' };
    case 'app_invite':
      return { subject: 'Te han invitado a organizar subastas en Subasta Salvaje', preheader: 'Crea tu cuenta de anfitrión con este mismo correo.', title: '¡Te han invitado!', intro: 'Te han dado acceso para organizar partidas en Subasta Salvaje, el juego de subastas creativas multijugador. Crea tu cuenta de anfitrión usando <b style="color:#ffffff;">este mismo correo</b>.', button: { label: 'Crear mi cuenta', url: `${v.siteUrl}/login?mode=signup` }, outro: 'Después de crear la cuenta te pediremos confirmar el correo con un enlace.', small: 'Si no esperabas esta invitación, puedes ignorarla: no se crea ninguna cuenta hasta que tú lo hagas.' };
    case 'magic_link':
      return { subject: 'Tu enlace para entrar en Subasta Salvaje', preheader: 'Entra con un solo clic.', title: 'Entra con un solo clic', intro: 'Pulsa el botón para iniciar sesión en Subasta Salvaje. El enlace es de un solo uso y caduca en poco tiempo.', button: { label: 'Entrar en Subasta Salvaje', url: link(v, 'magiclink', '/') }, small: IGNORE };
    case 'recovery':
      return { subject: 'Recupera tu contraseña de Subasta Salvaje', preheader: 'Elige una contraseña nueva en un minuto.', title: '¿Has olvidado tu contraseña?', intro: 'Hemos recibido una solicitud para cambiar la contraseña de tu cuenta. Pulsa el botón y elige una nueva. El enlace es de un solo uso y caduca en poco tiempo.', button: { label: 'Elegir una contraseña nueva', url: link(v, 'recovery', '/reset-password') }, outro: 'Tus partidas y tus datos siguen intactos: solo cambia la contraseña.', small: IGNORE };
    case 'email_change':
      return { subject: 'Confirma tu nuevo correo en Subasta Salvaje', preheader: 'Confirma el cambio de correo de tu cuenta.', title: 'Confirma tu nuevo correo', intro: `Has pedido cambiar el correo de tu cuenta de <b style="color:#ffffff;">${email}</b> a <b style="color:#ffffff;">${newEmail}</b>. Confirma el cambio para empezar a usar el nuevo.`, button: { label: 'Confirmar el cambio', url: link(v, 'email_change', '/') }, small: IGNORE };
    case 'reauthentication':
      return { subject: 'Tu código de confirmación de Subasta Salvaje', preheader: 'Tu código de confirmación.', title: 'Confirma que eres tú', intro: 'Para continuar con esta operación sensible, introduce este código en Subasta Salvaje:', code: escapeHtml(v.token ?? ''), outro: 'El código caduca en pocos minutos. No lo compartas con nadie.', small: IGNORE };
  }
}

export const MAIL_KINDS: readonly MailKind[] = ['confirmation', 'invite', 'app_invite', 'magic_link', 'recovery', 'email_change', 'reauthentication'];
/** Plantillas que usa Supabase (las que se pegan en su panel como plan B). */
export const SUPABASE_KINDS: readonly MailKind[] = ['confirmation', 'invite', 'magic_link', 'recovery', 'email_change', 'reauthentication'];

export function renderMail(kind: MailKind, vars: MailVars): RenderedMail {
  const s = spec(kind, vars);
  return { subject: s.subject, html: layout(vars.siteUrl, s), text: plain(s) };
}
