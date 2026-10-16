// Genera las plantillas de correo de Supabase Auth con la identidad de la app (HTML con estilos en línea y tablas, compatible con
// clientes de correo). Uso:
//   npm run emails:build            → escribe supabase/templates/*.html (con variables de Supabase: {{ .ConfirmationURL }}…)
//   npm run emails:build -- --preview → además escribe .email-preview/*.html con datos de ejemplo para abrirlas en el navegador
// Los correos de autenticación los envía SUPABASE (no la app): pega cada plantilla en Authentication → Email Templates.
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = 'supabase/templates';
const PREVIEW = '.email-preview';
const preview = process.argv.includes('--preview');

const C = { night: '#050816', card: '#111a35', line: '#2a3a6e', gold: '#fbbf24', goldDark: '#b45309', text: '#e8ecff', muted: '#aab4d6', violet: '#c4b5fd' };
const FONT = "'Trebuchet MS','Segoe UI',Arial,sans-serif";

const layout = ({ preheader, title, intro, button, outro, small, code }) => `<!doctype html>
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
      <a href="{{ .SiteURL }}" style="text-decoration:none;"><img src="{{ .SiteURL }}/assets/brand/email-logo.png" width="200" alt="Subasta Salvaje" style="display:block;border:0;height:auto;max-width:200px;"></a>
    </td></tr>
    <tr><td bgcolor="${C.card}" style="background:${C.card};border:1px solid ${C.line};border-radius:20px;padding:28px 26px;font-family:${FONT};color:${C.text};">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td width="72" valign="middle" style="padding-right:14px;"><img src="{{ .SiteURL }}/assets/brand/email-head.png" width="64" alt="" style="display:block;border:0;height:auto;"></td>
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

const link = (type, next) => `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=${type}&next=${next}`;
const IGNORE = 'Si no has sido tú, puedes ignorar este correo con tranquilidad: no se hará ningún cambio.';

const TEMPLATES = {
  confirmation: {
    subject: 'Confirma tu correo en Subasta Salvaje',
    html: layout({ preheader: 'Un clic y ya puedes crear tu primera partida.', title: '¡Bienvenido a Subasta Salvaje!', intro: 'Gracias por crear tu cuenta de anfitrión. Confirma tu correo electrónico para empezar a montar subastas con tus amigos.', button: { label: 'Confirmar mi correo', url: link('signup', '/') }, outro: 'Después podrás crear tu primera partida: tú diriges la subasta, la tele muestra el espectáculo y los demás pujan.', small: IGNORE }),
  },
  invite: {
    subject: 'Te han invitado a Subasta Salvaje',
    html: layout({ preheader: 'Alguien quiere que organices subastas con él.', title: '¡Te han invitado!', intro: 'Te han invitado a Subasta Salvaje, el juego de subastas creativas multijugador. Acepta la invitación para crear tu cuenta de anfitrión.', button: { label: 'Aceptar la invitación', url: link('invite', '/reset-password') }, outro: 'Al aceptar, elegirás tu contraseña.', small: 'Si no esperabas esta invitación, puedes ignorarla.' }),
  },
  magic_link: {
    subject: 'Tu enlace para entrar en Subasta Salvaje',
    html: layout({ preheader: 'Entra con un solo clic.', title: 'Entra con un solo clic', intro: 'Pulsa el botón para iniciar sesión en Subasta Salvaje. El enlace es de un solo uso y caduca en poco tiempo.', button: { label: 'Entrar en Subasta Salvaje', url: link('magiclink', '/') }, small: IGNORE }),
  },
  recovery: {
    subject: 'Recupera tu contraseña de Subasta Salvaje',
    html: layout({ preheader: 'Elige una contraseña nueva en un minuto.', title: '¿Has olvidado tu contraseña?', intro: 'Hemos recibido una solicitud para cambiar la contraseña de tu cuenta. Pulsa el botón y elige una nueva. El enlace es de un solo uso y caduca en poco tiempo.', button: { label: 'Elegir una contraseña nueva', url: link('recovery', '/reset-password') }, outro: 'Tus partidas y tus datos siguen intactos: solo cambia la contraseña.', small: IGNORE }),
  },
  email_change: {
    subject: 'Confirma tu nuevo correo en Subasta Salvaje',
    html: layout({ preheader: 'Confirma el cambio de correo de tu cuenta.', title: 'Confirma tu nuevo correo', intro: 'Has pedido cambiar el correo de tu cuenta de <b style="color:#ffffff;">{{ .Email }}</b> a <b style="color:#ffffff;">{{ .NewEmail }}</b>. Confirma el cambio para empezar a usar el nuevo.', button: { label: 'Confirmar el cambio', url: link('email_change', '/') }, small: IGNORE }),
  },
  reauthentication: {
    subject: 'Tu código de confirmación de Subasta Salvaje',
    html: layout({ preheader: 'Tu código de confirmación.', title: 'Confirma que eres tú', intro: 'Para continuar con esta operación sensible, introduce este código en Subasta Salvaje:', code: '{{ .Token }}', outro: 'El código caduca en pocos minutos. No lo compartas con nadie.', small: IGNORE }),
  },
};

const SAMPLE = {
  '{{ .SiteURL }}': '..',
  '{{ .TokenHash }}': 'EJEMPLO_TOKEN',
  '{{ .Email }}': 'anfitrion@ejemplo.com',
  '{{ .NewEmail }}': 'nuevo@ejemplo.com',
  '{{ .Token }}': '482915',
};

mkdirSync(OUT, { recursive: true });
if (preview) mkdirSync(PREVIEW, { recursive: true });
const index = [];
for (const [name, t] of Object.entries(TEMPLATES)) {
  writeFileSync(`${OUT}/${name}.html`, t.html);
  index.push({ name, subject: t.subject });
  if (preview) {
    let h = t.html;
    for (const [k, v] of Object.entries(SAMPLE)) h = h.split(k).join(name === 'x' ? k : v);
    // la vista previa carga las imágenes desde public/ (ruta relativa desde .email-preview)
    h = h.split('../assets/brand/').join('../public/assets/brand/');
    writeFileSync(`${PREVIEW}/${name}.html`, h);
  }
}
writeFileSync(`${OUT}/subjects.json`, JSON.stringify(Object.fromEntries(index.map((i) => [i.name, i.subject])), null, 2) + '\n');
console.log(`✔ ${index.length} plantillas en ${OUT}/${preview ? ` y vista previa en ${PREVIEW}/` : ''}`);
